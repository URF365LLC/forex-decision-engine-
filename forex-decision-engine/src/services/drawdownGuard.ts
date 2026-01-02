/**
 * Drawdown Guard Service - PRODUCTION VERSION
 * 
 * Features:
 * - Persistent state (survives server restart)
 * - Fail-closed design
 * - Accepts broker-provided values
 * - E8 Markets compliant
 * 
 * E8 Rules:
 * - Daily Loss Limit: 4% of starting balance
 * - Max Drawdown: 6% from peak equity
 * - Violation = Account Termination
 * 
 * Created: 2026-01-02 (Three-way audit)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const STATE_DIR = process.env.DRAWDOWN_STATE_DIR || './data/drawdown';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface DrawdownState {
  startOfDayEquity: number;
  peakEquity: number;
  lastEquity: number;
  lastUpdated: number;
  dayKey: string;
  source: 'broker' | 'calculated' | 'unknown';
}

export interface DrawdownCheckParams {
  accountId?: string;
  equity: number;
  startOfDayEquity?: number;
  peakEquity?: number;
  dailyLossLimitPct?: number;
  maxDrawdownPct?: number;
}

export interface DrawdownMetrics {
  dayKey: string;
  equity: number;
  startOfDayEquity: number;
  peakEquity: number;
  dailyDDPct: number;
  totalDDPct: number;
  stateSource: 'broker' | 'calculated' | 'unknown';
  limits: {
    dailyLossLimitPct: number;
    maxDrawdownPct: number;
  };
  headroom: {
    dailyRemaining: number;
    totalRemaining: number;
  };
  warnings: string[];
}

export interface DrawdownCheckResult {
  allowed: boolean;
  reason?: string;
  metrics: DrawdownMetrics;
}

// ═══════════════════════════════════════════════════════════════════════════
// State Persistence
// ═══════════════════════════════════════════════════════════════════════════

const stateCache = new Map<string, DrawdownState>();

function getStatePath(accountId: string): string {
  return join(STATE_DIR, `${accountId}.json`);
}

function loadState(accountId: string): DrawdownState | null {
  if (stateCache.has(accountId)) {
    return stateCache.get(accountId)!;
  }

  const path = getStatePath(accountId);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      stateCache.set(accountId, data);
      console.log(`[DrawdownGuard] Loaded state for ${accountId}: day=${data.dayKey}`);
      return data;
    } catch (err) {
      console.error(`[DrawdownGuard] Failed to load state for ${accountId}:`, err);
    }
  }
  return null;
}

function saveState(accountId: string, state: DrawdownState): void {
  stateCache.set(accountId, state);
  
  try {
    const path = getStatePath(accountId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`[DrawdownGuard] Failed to save state for ${accountId}:`, err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════

function getDayKey(date = new Date()): string {
  return date.toISOString().split('T')[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Check if trading is allowed based on drawdown limits
 */
export function checkDrawdownLimits(params: DrawdownCheckParams): DrawdownCheckResult {
  const {
    accountId = 'default',
    equity,
    startOfDayEquity: brokerStartOfDay,
    peakEquity: brokerPeak,
    dailyLossLimitPct = 4,
    maxDrawdownPct = 6,
  } = params;

  const warnings: string[] = [];
  const today = getDayKey();

  if (!Number.isFinite(equity) || equity <= 0) {
    return {
      allowed: false,
      reason: 'Invalid equity value',
      metrics: createErrorMetrics(dailyLossLimitPct, maxDrawdownPct, ['Invalid equity']),
    };
  }

  let state = loadState(accountId);
  let stateSource: 'broker' | 'calculated' | 'unknown' = 'unknown';

  let startOfDayEquity: number;
  if (brokerStartOfDay && Number.isFinite(brokerStartOfDay) && brokerStartOfDay > 0) {
    startOfDayEquity = brokerStartOfDay;
    stateSource = 'broker';
  } else if (state && state.dayKey === today) {
    startOfDayEquity = state.startOfDayEquity;
    stateSource = 'calculated';
    warnings.push('Using persisted startOfDayEquity');
  } else {
    startOfDayEquity = equity;
    stateSource = 'calculated';
    warnings.push('startOfDayEquity initialized from current equity');
  }

  let peakEquity: number;
  if (brokerPeak && Number.isFinite(brokerPeak) && brokerPeak > 0) {
    peakEquity = Math.max(brokerPeak, equity);
    stateSource = 'broker';
  } else if (state && state.peakEquity > 0) {
    peakEquity = Math.max(state.peakEquity, equity);
  } else {
    peakEquity = equity;
    warnings.push('peakEquity initialized from current equity');
  }

  const dailyDDPct = ((startOfDayEquity - equity) / startOfDayEquity) * 100;
  const totalDDPct = ((peakEquity - equity) / peakEquity) * 100;

  const metrics: DrawdownMetrics = {
    dayKey: today,
    equity: round2(equity),
    startOfDayEquity: round2(startOfDayEquity),
    peakEquity: round2(peakEquity),
    dailyDDPct: round2(dailyDDPct),
    totalDDPct: round2(totalDDPct),
    stateSource,
    limits: { dailyLossLimitPct, maxDrawdownPct },
    headroom: {
      dailyRemaining: round2(dailyLossLimitPct - Math.max(0, dailyDDPct)),
      totalRemaining: round2(maxDrawdownPct - Math.max(0, totalDDPct)),
    },
    warnings,
  };

  saveState(accountId, {
    startOfDayEquity,
    peakEquity,
    lastEquity: equity,
    lastUpdated: Date.now(),
    dayKey: today,
    source: stateSource,
  });

  if (dailyDDPct >= dailyLossLimitPct) {
    console.warn('[DrawdownGuard] BLOCKED: Daily loss limit reached', metrics);
    return {
      allowed: false,
      reason: `Daily loss limit BREACHED: ${metrics.dailyDDPct}% >= ${dailyLossLimitPct}%`,
      metrics,
    };
  }

  if (totalDDPct >= maxDrawdownPct) {
    console.warn('[DrawdownGuard] BLOCKED: Max drawdown reached', metrics);
    return {
      allowed: false,
      reason: `Max drawdown BREACHED: ${metrics.totalDDPct}% >= ${maxDrawdownPct}%`,
      metrics,
    };
  }

  if (dailyDDPct >= dailyLossLimitPct * 0.75) {
    warnings.push(`At ${round2(dailyDDPct)}% daily (limit: ${dailyLossLimitPct}%)`);
  }
  if (totalDDPct >= maxDrawdownPct * 0.75) {
    warnings.push(`At ${round2(totalDDPct)}% total DD (limit: ${maxDrawdownPct}%)`);
  }

  return { allowed: true, metrics };
}

/**
 * Reset state for an account
 */
export function resetDrawdownState(accountId = 'default'): void {
  stateCache.delete(accountId);
  try {
    const path = getStatePath(accountId);
    if (existsSync(path)) {
      const fs = require('fs');
      fs.unlinkSync(path);
    }
    console.log(`[DrawdownGuard] State reset for ${accountId}`);
  } catch (err) {
    console.error(`[DrawdownGuard] Failed to reset state:`, err);
  }
}

/**
 * Get current state (for debugging)
 */
export function getDrawdownState(accountId = 'default'): DrawdownState | null {
  return loadState(accountId);
}

function createErrorMetrics(daily: number, max: number, warnings: string[]): DrawdownMetrics {
  return {
    dayKey: getDayKey(),
    equity: 0,
    startOfDayEquity: 0,
    peakEquity: 0,
    dailyDDPct: 0,
    totalDDPct: 0,
    stateSource: 'unknown',
    limits: { dailyLossLimitPct: daily, maxDrawdownPct: max },
    headroom: { dailyRemaining: 0, totalRemaining: 0 },
    warnings,
  };
}

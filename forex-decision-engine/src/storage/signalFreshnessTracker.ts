/**
 * Signal Freshness Tracker
 * Tracks first detection time for active signals
 * Separate from signalStore.ts which handles historical persistence
 */

import { createLogger } from '../services/logger.js';

const logger = createLogger('SignalFreshnessTracker');

export interface TrackedSignal {
  key: string;
  symbol: string;
  strategyId: string;
  direction: 'long' | 'short';
  firstDetected: string;
  lastSeen: string;
}

const signalTracker = new Map<string, TrackedSignal>();

/**
 * Generate signal key using :: delimiter (safe for symbols like US_500)
 */
function getSignalKey(symbol: string, strategyId: string, direction: string): string {
  return `${symbol.toUpperCase()}::${strategyId.toLowerCase()}::${direction.toLowerCase()}`;
}

/**
 * Track a signal and return its tracking info
 * - Same signal exists: preserve original firstDetected, update lastSeen
 * - Direction flip: delete old, create new with current timestamp
 * - New signal: create with current timestamp
 */
export function trackSignal(
  symbol: string,
  strategyId: string,
  direction: 'long' | 'short'
): TrackedSignal {
  const key = getSignalKey(symbol, strategyId, direction);
  const now = new Date().toISOString();
  
  const existing = signalTracker.get(key);
  
  if (existing) {
    existing.lastSeen = now;
    logger.debug(`Signal persisted: ${key} (first: ${existing.firstDetected})`);
    return existing;
  }
  
  const oppositeDir = direction === 'long' ? 'short' : 'long';
  const oppositeKey = getSignalKey(symbol, strategyId, oppositeDir);
  if (signalTracker.has(oppositeKey)) {
    signalTracker.delete(oppositeKey);
    logger.info(`Signal flipped: ${symbol} ${strategyId} ${oppositeDir} → ${direction}`);
  }
  
  const newSignal: TrackedSignal = {
    key,
    symbol,
    strategyId,
    direction,
    firstDetected: now,
    lastSeen: now,
  };
  
  signalTracker.set(key, newSignal);
  logger.debug(`New signal tracked: ${key}`);
  
  return newSignal;
}

/**
 * Check if this is a NEW signal (not seen before)
 * Used for alerting - only alert on first detection
 */
export function isNewSignal(
  symbol: string,
  strategyId: string,
  direction: 'long' | 'short'
): boolean {
  const key = getSignalKey(symbol, strategyId, direction);
  return !signalTracker.has(key);
}

/**
 * Get first detection time for a signal (if exists)
 */
export function getFirstDetection(
  symbol: string,
  strategyId: string,
  direction: string
): string | null {
  const key = getSignalKey(symbol, strategyId, direction);
  return signalTracker.get(key)?.firstDetected || null;
}

/**
 * Clear stale signals (optional cleanup - default 24 hours)
 */
export function clearStaleSignals(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleared = 0;
  
  for (const [key, signal] of signalTracker.entries()) {
    const age = now - new Date(signal.lastSeen).getTime();
    if (age > maxAgeMs) {
      signalTracker.delete(key);
      cleared++;
    }
  }
  
  if (cleared > 0) {
    logger.info(`Cleared ${cleared} stale signals (>${maxAgeMs}ms old)`);
  }
  
  return cleared;
}

/**
 * Get all active tracked signals (for debugging/status)
 */
export function getAllTrackedSignals(): TrackedSignal[] {
  return Array.from(signalTracker.values());
}

/**
 * Get tracker statistics
 */
export function getTrackerStats(): {
  totalTracked: number;
  byStrategy: Record<string, number>;
} {
  const byStrategy: Record<string, number> = {};
  
  for (const signal of signalTracker.values()) {
    byStrategy[signal.strategyId] = (byStrategy[signal.strategyId] || 0) + 1;
  }
  
  return {
    totalTracked: signalTracker.size,
    byStrategy,
  };
}

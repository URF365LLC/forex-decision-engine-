/**
 * SignalQualityGate V2 - PROP-GRADE PRE-FLIGHT MODULE
 * 
 * Enforces:
 * 1. Closed-bar signals only (REJECT if signal bar not closed)
 * 2. Entry freshness policy (REJECT stale entries)
 * 3. Low volatility rejection (REJECT if ATR < threshold)
 * 4. H4 trend analysis
 * 5. Session quality adjustments
 * 
 * Date: January 2, 2026
 */

import type { Bar } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PreFlightInput {
  symbol: string;
  bars: Bar[];
  interval: 'H1' | 'H4' | 'D1';
  atr: number | null;
  strategyType: 'trend-continuation' | 'mean-reversion' | 'breakout' | 'momentum';
  minBars: number;
  trendBarsH4?: Bar[];
  ema200H4?: number[];
  adxH4?: number[];
}

export interface H4TrendResult {
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  priceVsEma200: number; // percentage
  adxValue: number;
}

export interface PreFlightResult {
  passed: boolean;
  rejectReason?: string;
  warnings: string[];
  confidenceAdjustments: number;
  h4Trend?: H4TrendResult;
}

export interface BBand {
  upper: number;
  middle: number;
  lower: number;
}

export interface Stoch {
  k: number;
  d: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION (Can be overridden for testing)
// ═══════════════════════════════════════════════════════════════════════════

export const GATE_CONFIG = {
  enforceClosedBar: true,
  enforceEntryFreshness: true,
  enforceMinVolatility: true,
  minAtrPercent: 0.05, // 0.05% minimum ATR
  maxEntryBarAgeMs: {
    'H1': 15 * 60 * 1000,   // 15 min max into H1
    'H4': 60 * 60 * 1000,   // 1 hour max into H4
    'D1': 4 * 60 * 60 * 1000, // 4 hours max into D1
  } as Record<string, number>,
};

export function setTestMode(enabled: boolean): void {
  GATE_CONFIG.enforceClosedBar = !enabled;
  GATE_CONFIG.enforceEntryFreshness = !enabled;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function isValidNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function allValidNumbers(...vals: unknown[]): boolean {
  return vals.every(isValidNumber);
}

export function isValidBBand(bb: unknown): bb is BBand {
  if (!bb || typeof bb !== 'object') return false;
  const b = bb as Record<string, unknown>;
  return isValidNumber(b.upper) && isValidNumber(b.middle) && isValidNumber(b.lower);
}

export function isValidStoch(stoch: unknown): stoch is Stoch {
  if (!stoch || typeof stoch !== 'object') return false;
  const s = stoch as Record<string, unknown>;
  return isValidNumber(s.k) && isValidNumber(s.d);
}

// ═══════════════════════════════════════════════════════════════════════════
// H4 TREND ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

function analyzeH4Trend(
  trendBarsH4: Bar[] | undefined,
  ema200H4: number[] | undefined,
  adxH4: number[] | undefined,
): H4TrendResult | undefined {
  if (!trendBarsH4 || trendBarsH4.length < 10) return undefined;
  if (!ema200H4 || ema200H4.length === 0) return undefined;
  if (!adxH4 || adxH4.length === 0) return undefined;
  
  const trendIdx = trendBarsH4.length - 1;
  const trendBar = trendBarsH4[trendIdx];
  const ema200Val = ema200H4[Math.min(trendIdx, ema200H4.length - 1)];
  const adxVal = adxH4[Math.min(trendIdx, adxH4.length - 1)];
  
  if (!isValidNumber(ema200Val) || !isValidNumber(adxVal)) return undefined;
  
  const priceVsEma200 = ((trendBar.close - ema200Val) / ema200Val) * 100;
  
  let direction: 'bullish' | 'bearish' | 'neutral';
  if (priceVsEma200 > 0.5) direction = 'bullish';
  else if (priceVsEma200 < -0.5) direction = 'bearish';
  else direction = 'neutral';
  
  let strength: 'strong' | 'moderate' | 'weak';
  if (adxVal > 30) strength = 'strong';
  else if (adxVal > 20) strength = 'moderate';
  else strength = 'weak';
  
  return { direction, strength, priceVsEma200, adxValue: adxVal };
}

export function isTrendAligned(trend: H4TrendResult, direction: 'long' | 'short'): boolean {
  if (trend.direction === 'neutral') return true; // Neutral is always "aligned"
  if (direction === 'long' && trend.direction === 'bullish') return true;
  if (direction === 'short' && trend.direction === 'bearish') return true;
  return false;
}

export function getTrendConfidenceAdjustment(trend: H4TrendResult, direction: 'long' | 'short'): number {
  if (trend.direction === 'neutral') return 0;
  
  const aligned = isTrendAligned(trend, direction);
  
  if (aligned) {
    // Bonus for trend alignment
    if (trend.strength === 'strong') return 20;
    if (trend.strength === 'moderate') return 15;
    return 10;
  } else {
    // Penalty for counter-trend
    if (trend.strength === 'strong') return -30;
    if (trend.strength === 'moderate') return -20;
    return -10;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BAR CLOSURE CHECK
// ═══════════════════════════════════════════════════════════════════════════

function checkBarClosure(bars: Bar[], interval: string): { signalBarClosed: boolean; rejectReason?: string } {
  if (bars.length < 3) {
    return { signalBarClosed: false, rejectReason: 'Not enough bars' };
  }
  
  const signalBar = bars[bars.length - 2];
  const entryBar = bars[bars.length - 1];
  
  // Signal bar is closed if entry bar has a different timestamp
  // For a properly closed bar, the entry bar should exist and be newer
  const signalTime = signalBar.time ? new Date(signalBar.time).getTime() : 0;
  const entryTime = entryBar.time ? new Date(entryBar.time).getTime() : 0;
  
  const signalBarClosed = entryTime > signalTime;
  
  if (!signalBarClosed && GATE_CONFIG.enforceClosedBar) {
    return { signalBarClosed: false, rejectReason: 'Signal bar not yet closed' };
  }
  
  return { signalBarClosed };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY FRESHNESS CHECK
// ═══════════════════════════════════════════════════════════════════════════

function checkEntryFreshness(bars: Bar[], interval: 'H1' | 'H4' | 'D1'): { rejectReason?: string } {
  if (!GATE_CONFIG.enforceEntryFreshness) return {};
  
  const entryBar = bars[bars.length - 1];
  if (!entryBar.time) return {};
  
  const entryBarTime = new Date(entryBar.time).getTime();
  const now = Date.now();
  const entryBarAgeMs = now - entryBarTime;
  
  const maxAge = GATE_CONFIG.maxEntryBarAgeMs[interval] || GATE_CONFIG.maxEntryBarAgeMs['H1'];
  
  if (entryBarAgeMs > maxAge) {
    const ageMinutes = Math.round(entryBarAgeMs / 60000);
    return { rejectReason: `Entry bar stale: ${ageMinutes}min old (max ${maxAge / 60000}min)` };
  }
  
  return {};
}

// ═══════════════════════════════════════════════════════════════════════════
// VOLATILITY CHECK
// ═══════════════════════════════════════════════════════════════════════════

function checkVolatility(atr: number | null, bars: Bar[]): { isTooLow: boolean; rejectReason?: string } {
  if (!isValidNumber(atr) || bars.length === 0) {
    return { isTooLow: false };
  }
  
  const price = bars[bars.length - 1].close;
  const atrPercent = (atr / price) * 100;
  
  if (atrPercent < GATE_CONFIG.minAtrPercent && GATE_CONFIG.enforceMinVolatility) {
    return { 
      isTooLow: true, 
      rejectReason: `Volatility too low: ATR ${atrPercent.toFixed(3)}% < ${GATE_CONFIG.minAtrPercent}%` 
    };
  }
  
  return { isTooLow: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION QUALITY
// ═══════════════════════════════════════════════════════════════════════════

function getSessionAdjustment(): number {
  const now = new Date();
  const utcHour = now.getUTCHours();
  
  // London/NY overlap (13:00-17:00 UTC) = best liquidity
  if (utcHour >= 13 && utcHour < 17) return 5;
  
  // London session (08:00-16:00 UTC)
  if (utcHour >= 8 && utcHour < 16) return 3;
  
  // NY session (13:00-21:00 UTC)
  if (utcHour >= 13 && utcHour < 21) return 2;
  
  // Asian session (00:00-08:00 UTC) = lower liquidity
  if (utcHour >= 0 && utcHour < 8) return -5;
  
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PRE-FLIGHT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export function runPreFlight(input: PreFlightInput): PreFlightResult {
  const { symbol, bars, interval, atr, minBars, trendBarsH4, ema200H4, adxH4 } = input;
  
  const warnings: string[] = [];
  let confidenceAdjustments = 0;
  
  // 1. Minimum bars check
  if (bars.length < minBars) {
    return {
      passed: false,
      rejectReason: `Insufficient bars: ${bars.length} < ${minBars}`,
      warnings,
      confidenceAdjustments: 0,
    };
  }
  
  // 2. Bar closure check (ENFORCED in V2)
  const barClosure = checkBarClosure(bars, interval);
  if (barClosure.rejectReason) {
    return {
      passed: false,
      rejectReason: barClosure.rejectReason,
      warnings,
      confidenceAdjustments: 0,
    };
  }
  
  // 3. Entry freshness check (ENFORCED in V2)
  const freshness = checkEntryFreshness(bars, interval);
  if (freshness.rejectReason) {
    return {
      passed: false,
      rejectReason: freshness.rejectReason,
      warnings,
      confidenceAdjustments: 0,
    };
  }
  
  // 4. Volatility check (ENFORCED in V2)
  const volatility = checkVolatility(atr, bars);
  if (volatility.rejectReason) {
    return {
      passed: false,
      rejectReason: volatility.rejectReason,
      warnings,
      confidenceAdjustments: 0,
    };
  }
  
  // 5. H4 Trend analysis
  const h4Trend = analyzeH4Trend(trendBarsH4, ema200H4, adxH4);
  if (!h4Trend) {
    warnings.push('H4 trend data unavailable');
  }
  
  // 6. Session quality adjustment
  confidenceAdjustments += getSessionAdjustment();
  
  return {
    passed: true,
    warnings,
    confidenceAdjustments,
    h4Trend,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING HELPER
// ═══════════════════════════════════════════════════════════════════════════

export function logPreFlight(symbol: string, strategyId: string, result: PreFlightResult): void {
  if (!result.passed) {
    console.log(`[${strategyId}] ${symbol} REJECTED: ${result.rejectReason}`);
  }
  if (result.warnings.length > 0) {
    console.log(`[${strategyId}] ${symbol} WARNINGS: ${result.warnings.join(', ')}`);
  }
}

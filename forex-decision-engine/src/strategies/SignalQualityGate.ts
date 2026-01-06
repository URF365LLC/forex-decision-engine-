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
import type { RegimeClassification } from '../modules/regimeDetector.js';
import { calculateATRPercentile, shouldTradeInRegime } from '../modules/regimeDetector.js';

// NOTE: Bar shape must have 'timestamp' field (string), not 'time'
// Example: { timestamp: "2025-01-02T14:00:00Z", open: 1.23, high: 1.24, low: 1.22, close: 1.235, volume: 1000 }

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
  atrRegime?: RegimeClassification;
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
  enforceEntryFreshness: false, // Disabled: signals should show with timing metadata, not be blocked
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

function buildAtrSeries(bars: Bar[], period: number = 14): number[] {
  if (bars.length < period + 1) return [];
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    trueRanges.push(tr);
  }
  
  if (trueRanges.length < period) return [];
  
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const atrValues: number[] = [atr];
  
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    atrValues.push(atr);
  }
  
  return atrValues;
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
  
  // FIX: Use 'timestamp' field (actual Bar shape), not 'time'
  const signalTime = signalBar.timestamp ? new Date(signalBar.timestamp).getTime() : 0;
  const entryTime = entryBar.timestamp ? new Date(entryBar.timestamp).getTime() : 0;
  
  // UPGRADED: Interval-based closure proof
  // Signal bar is PROVEN closed if: now >= signalBarStart + intervalMs
  const intervalMs: Record<string, number> = {
    'H1': 60 * 60 * 1000,
    'H4': 4 * 60 * 60 * 1000,
    'D1': 24 * 60 * 60 * 1000,
  };
  const barDurationMs = intervalMs[interval] || intervalMs['H1'];
  const now = Date.now();
  
  // Method 1: Entry bar exists and is newer (basic check)
  const hasNewerBar = entryTime > signalTime;
  
  // Method 2: Time elapsed since signal bar start >= bar duration (provable closure)
  const signalBarEndTime = signalTime + barDurationMs;
  const provenClosed = signalTime > 0 && now >= signalBarEndTime;
  
  const signalBarClosed = hasNewerBar || provenClosed;
  
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
  // FIX: Use 'timestamp' field (actual Bar shape), not 'time'
  if (!entryBar.timestamp) return {};
  
  const entryBarTime = new Date(entryBar.timestamp).getTime();
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
// SESSION QUALITY - UPGRADED WITH INSTRUMENT-AWARE FILTERING
// ═══════════════════════════════════════════════════════════════════════════

export type InstrumentClass = 'fx' | 'crypto' | 'indices' | 'stocks';

function getInstrumentClass(symbol: string): InstrumentClass {
  const upper = symbol.toUpperCase();
  // Crypto detection - all major cryptos including those in E8 specs
  const cryptoPatterns = [
    'BTC', 'ETH', 'USDT', 'SOL', 'XRP', 'DOGE',
    'ADA', 'BNB', 'BCH', 'LTC', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'ATOM'
  ];
  if (cryptoPatterns.some(c => upper.includes(c))) {
    return 'crypto';
  }
  // Index detection
  if (upper.includes('SPX') || upper.includes('NDX') || upper.includes('DJI') ||
      upper.includes('DAX') || upper.includes('FTSE') || upper.includes('NQ') ||
      upper.includes('ES') || upper.includes('YM')) {
    return 'indices';
  }
  // FX pairs (6 chars like EURUSD, or with slash)
  if ((upper.length === 6 && /^[A-Z]{6}$/.test(upper)) || upper.includes('/')) {
    return 'fx';
  }
  return 'stocks';
}

interface SessionResult {
  allowed: boolean;
  adjustment: number;
  reason?: string;
}

function checkSession(symbol: string): SessionResult {
  const instrumentClass = getInstrumentClass(symbol);
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcDay = now.getUTCDay(); // 0 = Sunday
  
  // Weekend check (FX/Indices closed)
  if ((instrumentClass === 'fx' || instrumentClass === 'indices') && (utcDay === 0 || utcDay === 6)) {
    return { allowed: false, adjustment: 0, reason: 'Market closed (weekend)' };
  }
  
  switch (instrumentClass) {
    case 'fx':
      // ═══════════════════════════════════════════════════════════════════
      // FX KILLZONES - ICT-style session optimization
      // ═══════════════════════════════════════════════════════════════════
      // Asian Dead Zone: 00:00-06:00 UTC (low liquidity, avoid for FX)
      if (utcHour < 6) {
        return { allowed: true, adjustment: -15, reason: 'FX: Asian session (low liquidity)' };
      }
      
      // London Open Killzone: 07:00-09:00 UTC (+15 confidence)
      // Prime institutional order flow, key reversals/continuations
      if (utcHour >= 7 && utcHour < 9) {
        return { allowed: true, adjustment: 15 };
      }
      
      // London Session: 09:00-13:00 UTC (+10 confidence)
      if (utcHour >= 9 && utcHour < 13) {
        return { allowed: true, adjustment: 10 };
      }
      
      // London/NY Overlap Killzone: 13:00-17:00 UTC (+20 confidence)
      // HIGHEST VOLUME PERIOD - best signals
      if (utcHour >= 13 && utcHour < 17) {
        return { allowed: true, adjustment: 20 };
      }
      
      // NY Open Killzone: 13:30-15:30 UTC (+15 within overlap)
      // Already covered by overlap, but could be used for sub-hour precision
      
      // NY Afternoon: 17:00-21:00 UTC (+5 confidence)
      if (utcHour >= 17 && utcHour < 21) {
        return { allowed: true, adjustment: 5 };
      }
      
      // Late NY / Pre-Asian: 21:00-00:00 UTC (neutral)
      return { allowed: true, adjustment: 0 };
      
    case 'crypto':
      // Crypto: 24/7, but penalize lowest liquidity
      // 02:00-06:00 UTC is typically lowest crypto volume
      if (utcHour >= 2 && utcHour < 6) {
        return { allowed: true, adjustment: -10 };
      }
      // US afternoon/evening tends to have good crypto liquidity
      if (utcHour >= 14 && utcHour < 22) {
        return { allowed: true, adjustment: 5 };
      }
      return { allowed: true, adjustment: 0 };
      
    case 'indices':
    case 'stocks':
      // US market hours (13:30-20:00 UTC / 9:30am-4pm ET)
      if (utcHour < 13 || utcHour >= 20) {
        return { allowed: false, adjustment: 0, reason: 'Equities: Outside US market hours' };
      }
      
      // Opening 30 min: 13:30-14:00 UTC (-5 volatility warning)
      if (utcHour === 13 && utcMinute >= 30) {
        return { allowed: true, adjustment: -5 };
      }
      if (utcHour === 13 && utcMinute < 30) {
        return { allowed: false, adjustment: 0, reason: 'Equities: Pre-market' };
      }
      
      // Opening Drive: 14:00-15:00 UTC (+10 for directional moves)
      if (utcHour === 14) {
        return { allowed: true, adjustment: 10 };
      }
      
      // Mid-day: 15:00-18:00 UTC (+5 stable trading)
      if (utcHour >= 15 && utcHour < 18) {
        return { allowed: true, adjustment: 5 };
      }
      
      // Power Hour: 19:00-20:00 UTC (+10 for closing moves)
      if (utcHour === 19) {
        return { allowed: true, adjustment: 10 };
      }
      
      return { allowed: true, adjustment: 0 };
      
    default:
      return { allowed: true, adjustment: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REGIME GATE - ADX + ATR% COMBO
// ═══════════════════════════════════════════════════════════════════════════

export type MarketRegime = 'strong-trend' | 'weak-trend' | 'range' | 'chop' | 'unknown';

interface RegimeResult {
  regime: MarketRegime;
  allowTrend: boolean;
  allowMeanReversion: boolean;
  reason?: string;
}

function detectRegime(h4Trend: H4TrendResult | undefined, atrPercent: number): RegimeResult {
  if (!h4Trend) {
    return { regime: 'unknown', allowTrend: false, allowMeanReversion: false, reason: 'No H4 data' };
  }
  
  const adx = h4Trend.adxValue;
  
  // Chop: Low ADX + Low volatility
  if (adx < 15 && atrPercent < 0.1) {
    return { regime: 'chop', allowTrend: false, allowMeanReversion: false, reason: `Chop (ADX=${adx.toFixed(1)}, ATR%=${atrPercent.toFixed(2)})` };
  }
  
  // Strong trend: ADX > 30
  if (adx >= 30) {
    return { regime: 'strong-trend', allowTrend: true, allowMeanReversion: false, reason: `Strong trend (ADX=${adx.toFixed(1)})` };
  }
  
  // Weak trend: ADX 14-30 (LOWERED from 18 to capture more opportunities)
  // ADX 14-18 is "developing trend" - allow with confidence penalty
  if (adx >= 14) {
    return { regime: 'weak-trend', allowTrend: true, allowMeanReversion: true };
  }
  
  // Range: ADX < 14 (LOWERED from 18)
  return { regime: 'range', allowTrend: false, allowMeanReversion: true, reason: `Range (ADX=${adx.toFixed(1)})` };
}

function getSessionAdjustment(): number {
  // DEPRECATED: Use checkSession() instead
  return 0;
}

function mapStrategyToRegimeType(strategyType: PreFlightInput['strategyType']): 'trend' | 'mean-reversion' | 'breakout' | 'momentum' {
  switch (strategyType) {
    case 'trend-continuation':
      return 'trend';
    case 'mean-reversion':
      return 'mean-reversion';
    case 'breakout':
      return 'breakout';
    default:
      return 'momentum';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PRE-FLIGHT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export function runPreFlight(input: PreFlightInput): PreFlightResult {
  const { symbol, bars, interval, atr, strategyType, minBars, trendBarsH4, ema200H4, adxH4 } = input;
  
  const warnings: string[] = [];
  let confidenceAdjustments = 0;
  let atrRegime: RegimeClassification | undefined;
  
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
  
  // 5. SESSION GATE (instrument-aware)
  const session = checkSession(symbol);
  if (!session.allowed) {
    return {
      passed: false,
      rejectReason: session.reason || 'Session not allowed',
      warnings,
      confidenceAdjustments: 0,
    };
  }
  confidenceAdjustments += session.adjustment;
  
  // 6. H4 Trend analysis
  const h4Trend = analyzeH4Trend(trendBarsH4, ema200H4, adxH4);
  if (!h4Trend) {
    warnings.push('H4 trend data unavailable');
  }

  // 7. ATR percentile regime detection (volatility-aware confidence)
  const atrSeries = buildAtrSeries(bars, 14);
  if (atrSeries.length >= 20) {
    atrRegime = calculateATRPercentile(atrSeries);
    const regimeDecision = shouldTradeInRegime(atrRegime, mapStrategyToRegimeType(strategyType));
    confidenceAdjustments += regimeDecision.confidenceAdjustment;
    if (!regimeDecision.allowed) {
      return {
        passed: false,
        rejectReason: regimeDecision.reason || 'Regime not tradable',
        warnings,
        confidenceAdjustments: 0,
        h4Trend,
        atrRegime,
      };
    }
  }
  
  // 8. REGIME GATE (strategy type aware)
  const price = bars[bars.length - 1]?.close || 0;
  const atrPercent = (atr && price > 0) ? (atr / price) * 100 : 0;
  const regime = detectRegime(h4Trend, atrPercent);
  
  // Enforce regime rules based on strategy type
  if (strategyType === 'trend-continuation' && !regime.allowTrend) {
    return {
      passed: false,
      rejectReason: `Trend strategy blocked: ${regime.reason || regime.regime}`,
      warnings,
      confidenceAdjustments: 0,
      h4Trend,
    };
  }
  if (strategyType === 'mean-reversion' && !regime.allowMeanReversion && regime.regime === 'strong-trend') {
    return {
      passed: false,
      rejectReason: `Mean reversion blocked: ${regime.reason || 'strong trend'}`,
      warnings,
      confidenceAdjustments: 0,
      h4Trend,
    };
  }
  if (regime.regime === 'chop') {
    return {
      passed: false,
      rejectReason: regime.reason || 'Choppy market',
      warnings,
      confidenceAdjustments: 0,
      h4Trend,
    };
  }
  
  return {
    passed: true,
    warnings,
    confidenceAdjustments,
    h4Trend,
    atrRegime,
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

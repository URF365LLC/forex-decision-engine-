/**
 * Signal Quality Gate - V2 (PROP-GRADE ENFORCED)
 * 
 * Unified pre-flight checks for ALL strategies.
 * Call this FIRST in every strategy's analyze() method.
 * 
 * ENFORCEMENT (not warnings):
 * 1. Closed-bar: REJECT if signal bar not closed
 * 2. Entry freshness: REJECT if entry bar is stale (>X minutes into candle)
 * 3. Volatility: REJECT if too low (signals unreliable)
 * 4. Regime: REJECT if strategy-regime mismatch
 * 
 * Created: 2026-01-02 (Three-Way Audit: Claude + ChatGPT + Replit)
 * Updated: 2026-01-02 (ChatGPT V2 audit - enforced closed-bar)
 */

import { Bar } from './types.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('SignalQualityGate');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const GATE_CONFIG = {
  // Entry freshness: reject if entry bar started more than X ms ago
  maxEntryBarAgeMs: {
    '1min': 30 * 1000,      // 30 seconds into 1min bar
    '5min': 2 * 60 * 1000,  // 2 minutes into 5min bar
    '15min': 5 * 60 * 1000, // 5 minutes into 15min bar
    '30min': 10 * 60 * 1000,// 10 minutes into 30min bar
    'H1': 15 * 60 * 1000,   // 15 minutes into H1 bar
    '1h': 15 * 60 * 1000,
    'H4': 60 * 60 * 1000,   // 1 hour into H4 bar
    '4h': 60 * 60 * 1000,
    'D1': 4 * 60 * 60 * 1000, // 4 hours into daily bar
    '1day': 4 * 60 * 60 * 1000,
  } as Record<string, number>,
  
  // Volatility thresholds (ATR as % of price)
  volatility: {
    forex: { min: 0.15, max: 3.0 },
    crypto: { min: 0.5, max: 8.0 },
    indices: { min: 0.3, max: 4.0 },
    metals: { min: 0.2, max: 5.0 },
  } as Record<string, { min: number; max: number }>,
  
  // Enforce closed bar (set to false only for testing)
  enforceClosedBar: true,
  
  // Enforce entry freshness
  enforceEntryFreshness: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPE GUARDS - Use these instead of falsy checks!
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if value is a valid finite number (NOT null, undefined, NaN, Infinity)
 * 
 * CRITICAL: Use this instead of `if (!value)` for indicators!
 * `if (!value)` treats 0 as falsy, killing signals when CCI/RSI/etc = 0
 */
export function isValidNumber(val: unknown): val is number {
  return val !== null && val !== undefined && Number.isFinite(val as number);
}

/**
 * Check if all values are valid finite numbers
 */
export function allValidNumbers(...vals: unknown[]): boolean {
  return vals.every(isValidNumber);
}

/**
 * Check if stochastic object is valid
 */
export function isValidStoch(stoch: unknown): stoch is { k: number; d: number } {
  if (!stoch || typeof stoch !== 'object') return false;
  const s = stoch as { k?: unknown; d?: unknown };
  return isValidNumber(s.k) && isValidNumber(s.d);
}

/**
 * Check if Bollinger Band object is valid
 */
export function isValidBBand(bb: unknown): bb is { upper: number; middle: number; lower: number } {
  if (!bb || typeof bb !== 'object') return false;
  const b = bb as { upper?: unknown; middle?: unknown; lower?: unknown };
  return isValidNumber(b.upper) && isValidNumber(b.middle) && isValidNumber(b.lower);
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERVAL UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const INTERVAL_MS: Record<string, number> = {
  '1min': 60 * 1000,
  '5min': 5 * 60 * 1000,
  '15min': 15 * 60 * 1000,
  '30min': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  'H1': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  'H4': 4 * 60 * 60 * 1000,
  '1day': 24 * 60 * 60 * 1000,
  'D1': 24 * 60 * 60 * 1000,
};

export function getIntervalMs(interval: string): number {
  return INTERVAL_MS[interval] || 60 * 60 * 1000;
}

// ═══════════════════════════════════════════════════════════════════════════
// BAR CLOSURE DETECTION (ENFORCED)
// ═══════════════════════════════════════════════════════════════════════════

export interface BarClosureStatus {
  signalBarClosed: boolean;
  entryBarClosed: boolean;
  entryBarAgeMs: number;
  entryBarFresh: boolean;
  rejectReason?: string;
}

/**
 * Check if signal bar is closed and entry bar is fresh
 * 
 * PROP-GRADE: This now returns a reject reason if conditions not met
 */
export function checkBarClosure(
  bars: Bar[],
  interval: string,
  now?: number // Allow injection for testing
): BarClosureStatus {
  const currentTime = now ?? Date.now();
  
  if (!bars || bars.length < 2) {
    return {
      signalBarClosed: false,
      entryBarClosed: false,
      entryBarAgeMs: 0,
      entryBarFresh: false,
      rejectReason: 'Insufficient bars for closure check',
    };
  }

  const intervalMs = getIntervalMs(interval);
  const maxEntryAge = GATE_CONFIG.maxEntryBarAgeMs[interval] || intervalMs * 0.25;
  
  // Entry bar (last bar)
  const entryBar = bars[bars.length - 1];
  const entryBarStart = new Date(entryBar.datetime).getTime();
  const entryBarEnd = entryBarStart + intervalMs;
  const entryBarClosed = entryBarEnd <= currentTime;
  const entryBarAgeMs = currentTime - entryBarStart;
  const entryBarFresh = entryBarAgeMs <= maxEntryAge;
  
  // Signal bar (second to last)
  const signalBar = bars[bars.length - 2];
  const signalBarStart = new Date(signalBar.datetime).getTime();
  const signalBarEnd = signalBarStart + intervalMs;
  const signalBarClosed = signalBarEnd <= currentTime;

  // Determine reject reason
  let rejectReason: string | undefined;
  
  if (GATE_CONFIG.enforceClosedBar && !signalBarClosed) {
    rejectReason = `Signal bar not closed (ends ${new Date(signalBarEnd).toISOString()})`;
  } else if (GATE_CONFIG.enforceEntryFreshness && !entryBarFresh && !entryBarClosed) {
    const ageMinutes = Math.round(entryBarAgeMs / 60000);
    const maxMinutes = Math.round(maxEntryAge / 60000);
    rejectReason = `Entry bar stale: ${ageMinutes}min old (max ${maxMinutes}min for ${interval})`;
  }

  return {
    signalBarClosed,
    entryBarClosed,
    entryBarAgeMs,
    entryBarFresh,
    rejectReason,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION FILTER
// ═══════════════════════════════════════════════════════════════════════════

export type SessionQuality = 'optimal' | 'good' | 'acceptable' | 'poor';

export interface SessionInfo {
  name: string;
  quality: SessionQuality;
  confidenceAdjustment: number;
}

export function getSessionInfo(symbol: string, utcHour?: number): SessionInfo {
  const hour = utcHour ?? new Date().getUTCHours();
  
  if (hour >= 12 && hour <= 16) {
    return { name: 'London/NY Overlap', quality: 'optimal', confidenceAdjustment: 5 };
  }
  
  if (hour >= 7 && hour <= 16) {
    return { name: 'London', quality: 'good', confidenceAdjustment: 0 };
  }
  
  if (hour >= 12 && hour <= 21) {
    return { name: 'New York', quality: 'good', confidenceAdjustment: 0 };
  }
  
  if (hour >= 0 && hour <= 9) {
    if (symbol.match(/JPY|AUD|NZD/)) {
      return { name: 'Tokyo', quality: 'acceptable', confidenceAdjustment: -5 };
    }
    return { name: 'Asian', quality: 'poor', confidenceAdjustment: -15 };
  }
  
  return { name: 'Off-hours', quality: 'acceptable', confidenceAdjustment: -10 };
}

// ═══════════════════════════════════════════════════════════════════════════
// VOLATILITY GATE (ENFORCED for low volatility)
// ═══════════════════════════════════════════════════════════════════════════

export interface VolatilityCheck {
  atrPercent: number;
  isTooLow: boolean;
  isTooHigh: boolean;
  isAcceptable: boolean;
  confidenceAdjustment: number;
  rejectReason?: string;
}

function getAssetClass(symbol: string): string {
  if (symbol.match(/BTC|ETH|SOL|XRP|ADA|BNB|LTC|BCH/)) return 'crypto';
  if (symbol.match(/XAU|XAG|GOLD|SILVER/)) return 'metals';
  if (symbol.match(/US30|NAS|SPX|DAX|FTSE/)) return 'indices';
  return 'forex';
}

export function checkVolatility(
  atr: number,
  price: number,
  symbol: string
): VolatilityCheck {
  if (!isValidNumber(atr) || !isValidNumber(price) || price <= 0) {
    return {
      atrPercent: 0,
      isTooLow: false,
      isTooHigh: false,
      isAcceptable: false,
      confidenceAdjustment: -20,
      rejectReason: 'Invalid ATR or price for volatility check',
    };
  }

  const assetClass = getAssetClass(symbol);
  const thresholds = GATE_CONFIG.volatility[assetClass] || GATE_CONFIG.volatility.forex;
  const atrPercent = (atr / price) * 100;
  
  const isTooLow = atrPercent < thresholds.min;
  const isTooHigh = atrPercent > thresholds.max;
  const isAcceptable = !isTooLow && !isTooHigh;

  let confidenceAdjustment = 0;
  let rejectReason: string | undefined;
  
  if (isTooLow) {
    // ENFORCE: Low volatility = unreliable signals = REJECT
    rejectReason = `Volatility too low: ATR ${atrPercent.toFixed(3)}% < ${thresholds.min}% (${assetClass})`;
    confidenceAdjustment = -15;
  } else if (isTooHigh) {
    // High volatility = wider stops needed, but don't reject
    confidenceAdjustment = -10;
  } else if (atrPercent >= thresholds.min * 2 && atrPercent <= thresholds.max * 0.7) {
    confidenceAdjustment = 5;
  }

  return { atrPercent, isTooLow, isTooHigh, isAcceptable, confidenceAdjustment, rejectReason };
}

// ═══════════════════════════════════════════════════════════════════════════
// REGIME ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

export type MarketRegime = 'trending-strong' | 'trending' | 'ranging' | 'volatile' | 'unknown';
export type StrategyType = 'mean-reversion' | 'trend-continuation' | 'breakout' | 'momentum';

export interface RegimeAnalysis {
  regime: MarketRegime;
  adxValue?: number;
  atrPercent?: number;
  allowMeanReversion: boolean;
  allowTrendFollowing: boolean;
  confidenceAdjustment: number;
  rejectReason?: string;
}

export function analyzeRegime(
  adx: number | null | undefined,
  atr: number | null | undefined,
  price: number,
  strategyType: StrategyType
): RegimeAnalysis {
  const result: RegimeAnalysis = {
    regime: 'unknown',
    allowMeanReversion: true,
    allowTrendFollowing: true,
    confidenceAdjustment: 0,
  };

  if (isValidNumber(atr) && price > 0) {
    result.atrPercent = (atr / price) * 100;
  }

  if (isValidNumber(adx)) {
    result.adxValue = adx;
    
    if (adx > 35) {
      result.regime = 'trending-strong';
      result.allowMeanReversion = false;
      result.allowTrendFollowing = true;
      result.confidenceAdjustment = 5;
    } else if (adx > 25) {
      result.regime = 'trending';
      result.allowMeanReversion = true;
      result.allowTrendFollowing = true;
      result.confidenceAdjustment = 0;
    } else if (adx < 18) {
      result.regime = 'ranging';
      result.allowMeanReversion = true;
      result.allowTrendFollowing = false;
      result.confidenceAdjustment = -5;
    }
  }

  // ENFORCE: Check strategy-regime compatibility
  if (strategyType === 'mean-reversion' && !result.allowMeanReversion) {
    result.rejectReason = `Mean reversion blocked: ${result.regime} regime (ADX: ${result.adxValue?.toFixed(1)})`;
  } else if (strategyType === 'trend-continuation' && !result.allowTrendFollowing) {
    result.rejectReason = `Trend following blocked: ${result.regime} regime (ADX: ${result.adxValue?.toFixed(1)})`;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// H4 TREND FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════

export interface H4TrendAnalysis {
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  ema200Value: number;
  adxValue?: number;
  priceVsEma: number;
  isValid: boolean;
}

export function analyzeH4Trend(
  trendBarsH4: Bar[] | undefined,
  ema200H4: number[] | undefined,
  adxH4?: number[] | undefined
): H4TrendAnalysis | null {
  if (!trendBarsH4 || trendBarsH4.length < 50) return null;
  if (!ema200H4 || ema200H4.length < 50) return null;
  
  const idx = trendBarsH4.length - 1;
  const bar = trendBarsH4[idx];
  const ema200 = ema200H4[idx];
  
  if (!isValidNumber(ema200)) return null;
  
  const priceVsEma = ((bar.close - ema200) / ema200) * 100;
  
  let direction: 'bullish' | 'bearish' | 'neutral';
  if (priceVsEma > 0.3) direction = 'bullish';
  else if (priceVsEma < -0.3) direction = 'bearish';
  else direction = 'neutral';
  
  let strength: 'strong' | 'moderate' | 'weak' | 'none' = 'none';
  let adxValue: number | undefined;
  
  if (adxH4 && adxH4.length > idx && isValidNumber(adxH4[idx])) {
    adxValue = adxH4[idx];
    if (adxValue > 30) strength = 'strong';
    else if (adxValue > 22) strength = 'moderate';
    else if (adxValue > 15) strength = 'weak';
  }
  
  return {
    direction,
    strength,
    ema200Value: ema200,
    adxValue,
    priceVsEma,
    isValid: true,
  };
}

export function isTrendAligned(
  trend: H4TrendAnalysis,
  tradeDirection: 'long' | 'short'
): boolean {
  if (tradeDirection === 'long') return trend.direction === 'bullish';
  return trend.direction === 'bearish';
}

export function getTrendConfidenceAdjustment(
  trend: H4TrendAnalysis,
  tradeDirection: 'long' | 'short'
): number {
  const aligned = isTrendAligned(trend, tradeDirection);
  
  if (aligned) {
    if (trend.strength === 'strong') return 25;
    if (trend.strength === 'moderate') return 20;
    if (trend.strength === 'weak') return 10;
    return 5;
  } else {
    if (trend.strength === 'strong') return -40;
    if (trend.strength === 'moderate') return -30;
    if (trend.strength === 'weak') return -20;
    return -10;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED PRE-FLIGHT CHECK (ENFORCED)
// ═══════════════════════════════════════════════════════════════════════════

export interface PreFlightParams {
  symbol: string;
  bars: Bar[];
  interval: string;
  atr?: number | null;
  strategyType: StrategyType;
  minBars?: number;
  trendBarsH4?: Bar[];
  ema200H4?: number[];
  adxH4?: number[];
  now?: number; // For testing
}

export interface PreFlightResult {
  passed: boolean;
  rejectReason?: string;
  warnings: string[];
  confidenceAdjustments: number;
  h4Trend: H4TrendAnalysis | null;
  session: SessionInfo;
  volatility?: VolatilityCheck;
  regime: RegimeAnalysis;
  barClosure: BarClosureStatus;
}

/**
 * Run all pre-flight checks for a strategy
 * 
 * PROP-GRADE V2: Now actually ENFORCES requirements, not just warns
 * 
 * REJECTION CONDITIONS:
 * 1. Insufficient bars
 * 2. Signal bar not closed (ENFORCED)
 * 3. Entry bar stale (ENFORCED)
 * 4. Volatility too low (ENFORCED)
 * 5. Strategy-regime mismatch (ENFORCED)
 */
export function runPreFlight(params: PreFlightParams): PreFlightResult {
  const {
    symbol,
    bars,
    interval,
    atr,
    strategyType,
    minBars = 50,
    trendBarsH4,
    ema200H4,
    adxH4,
    now,
  } = params;

  const warnings: string[] = [];
  let rejectReason: string | undefined;
  let confidenceAdjustments = 0;

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 1: Bar count
  // ════════════════════════════════════════════════════════════════════════
  if (!bars || bars.length < minBars) {
    return createFailedResult(`Insufficient bars: ${bars?.length || 0} < ${minBars}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 2: Bar closure (ENFORCED)
  // ════════════════════════════════════════════════════════════════════════
  const barClosure = checkBarClosure(bars, interval, now);
  if (barClosure.rejectReason) {
    return createFailedResult(barClosure.rejectReason, barClosure);
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 3: Current price
  // ════════════════════════════════════════════════════════════════════════
  const currentPrice = bars[bars.length - 1].close;

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 4: Session
  // ════════════════════════════════════════════════════════════════════════
  const session = getSessionInfo(symbol);
  confidenceAdjustments += session.confidenceAdjustment;
  if (session.quality === 'poor') {
    warnings.push(`Poor session: ${session.name}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 5: Volatility (ENFORCED for low volatility)
  // ════════════════════════════════════════════════════════════════════════
  let volatility: VolatilityCheck | undefined;
  if (isValidNumber(atr)) {
    volatility = checkVolatility(atr, currentPrice, symbol);
    confidenceAdjustments += volatility.confidenceAdjustment;
    
    if (volatility.rejectReason) {
      return createFailedResult(volatility.rejectReason, barClosure);
    }
    
    if (volatility.isTooHigh) {
      warnings.push(`High volatility: ${volatility.atrPercent.toFixed(2)}%`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 6: H4 Trend
  // ════════════════════════════════════════════════════════════════════════
  const h4Trend = analyzeH4Trend(trendBarsH4, ema200H4, adxH4);
  if (!h4Trend) {
    warnings.push('H4 trend data unavailable');
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 7: Regime (ENFORCED)
  // ════════════════════════════════════════════════════════════════════════
  const adxForRegime = adxH4 && adxH4.length > 0 ? adxH4[adxH4.length - 1] : null;
  const regime = analyzeRegime(adxForRegime, atr, currentPrice, strategyType);
  confidenceAdjustments += regime.confidenceAdjustment;
  
  if (regime.rejectReason) {
    return createFailedResult(regime.rejectReason, barClosure);
  }

  return {
    passed: true,
    rejectReason: undefined,
    warnings,
    confidenceAdjustments,
    h4Trend,
    session,
    volatility,
    regime,
    barClosure,
  };
}

function createFailedResult(
  reason: string, 
  barClosure?: BarClosureStatus
): PreFlightResult {
  return {
    passed: false,
    rejectReason: reason,
    warnings: [],
    confidenceAdjustments: 0,
    h4Trend: null,
    session: { name: 'Unknown', quality: 'poor', confidenceAdjustment: 0 },
    regime: { 
      regime: 'unknown', 
      allowMeanReversion: true, 
      allowTrendFollowing: true, 
      confidenceAdjustment: 0 
    },
    barClosure: barClosure || { 
      signalBarClosed: false, 
      entryBarClosed: false, 
      entryBarAgeMs: 0, 
      entryBarFresh: false 
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════

export function logPreFlight(symbol: string, strategyId: string, result: PreFlightResult): void {
  if (!result.passed) {
    logger.debug(`[${strategyId}] ${symbol}: REJECTED - ${result.rejectReason}`);
  } else if (result.warnings.length > 0) {
    logger.debug(`[${strategyId}] ${symbol}: PASSED with ${result.warnings.length} warnings`, {
      warnings: result.warnings,
      adjustments: result.confidenceAdjustments,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R:R VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

const MIN_RR_BY_TYPE: Record<StrategyType, number> = {
  'mean-reversion': 1.2,
  'trend-continuation': 1.8,
  'breakout': 2.0,
  'momentum': 1.5,
};

export function calculateEffectiveRR(
  direction: 'long' | 'short',
  entry: number,
  stopLoss: number,
  takeProfit: number,
  spread: number = 0
): { rawRR: number; effectiveRR: number; isValid: boolean; error?: string } {
  // Validate inputs
  if (!isValidNumber(entry) || !isValidNumber(stopLoss) || !isValidNumber(takeProfit)) {
    return { rawRR: 0, effectiveRR: 0, isValid: false, error: 'Invalid price inputs' };
  }
  
  // Validate direction consistency
  if (direction === 'long') {
    if (stopLoss >= entry) {
      return { rawRR: 0, effectiveRR: 0, isValid: false, error: 'Long: SL must be below entry' };
    }
    if (takeProfit <= entry) {
      return { rawRR: 0, effectiveRR: 0, isValid: false, error: 'Long: TP must be above entry' };
    }
  } else {
    if (stopLoss <= entry) {
      return { rawRR: 0, effectiveRR: 0, isValid: false, error: 'Short: SL must be above entry' };
    }
    if (takeProfit >= entry) {
      return { rawRR: 0, effectiveRR: 0, isValid: false, error: 'Short: TP must be below entry' };
    }
  }
  
  const effectiveEntry = direction === 'long' ? entry + spread : entry - spread;
  const risk = Math.abs(effectiveEntry - stopLoss);
  const reward = Math.abs(takeProfit - effectiveEntry);
  
  if (risk <= 0) {
    return { rawRR: 0, effectiveRR: 0, isValid: false, error: 'Risk is zero or negative' };
  }
  
  const rawRR = Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss);
  const effectiveRR = reward / risk;
  
  return {
    rawRR: Math.round(rawRR * 100) / 100,
    effectiveRR: Math.round(effectiveRR * 100) / 100,
    isValid: true,
  };
}

export function validateRR(
  rr: number,
  strategyType: StrategyType
): { valid: boolean; minimum: number; message?: string } {
  const minimum = MIN_RR_BY_TYPE[strategyType];
  const valid = rr >= minimum;
  
  return {
    valid,
    minimum,
    message: valid ? undefined : `R:R ${rr.toFixed(2)} below minimum ${minimum} for ${strategyType}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Temporarily disable enforcement for testing
 */
export function setTestMode(enabled: boolean): void {
  GATE_CONFIG.enforceClosedBar = !enabled;
  GATE_CONFIG.enforceEntryFreshness = !enabled;
}

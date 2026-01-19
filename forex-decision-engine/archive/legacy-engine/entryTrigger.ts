/**
 * Entry Trigger Engine
 * Detects pullback to EMA zone with RSI reset
 * 
 * Rules:
 * - BULLISH ENTRY: Price in EMA20-50 zone, RSI was < 50 and turning up
 * - BEARISH ENTRY: Price in EMA20-50 zone, RSI was > 50 and turning down
 */

import { STRATEGY } from '../config/strategy.js';
import { 
  IndicatorData, 
  getLatestValue, 
  getPreviousValue 
} from './indicatorService.js';
import { TrendDirection } from './trendFilter.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('EntryTrigger');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type EntryStatus = 'ready' | 'building' | 'invalid';

export interface EntryAnalysis {
  status: EntryStatus;
  
  // Component values
  price: number;
  ema20: number;
  ema50: number;
  rsi: number;
  rsiPrevious: number;
  
  // Zone checks
  inPullbackZone: boolean;
  inStrictZone: boolean;      // Price is within strict EMA 20/50 band
  inToleranceZone: boolean;   // Price is in 0.5% tolerance zone (outside strict band)
  pullbackDepth: 'shallow' | 'deep' | 'none';
  
  // RSI checks
  rsiWasReset: boolean;
  rsiTurning: boolean;
  rsiResetStrength: number;
  
  // Entry zone calculation
  entryZoneLow: number;
  entryZoneHigh: number;
  
  // Confidence
  isStrong: boolean;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// ENTRY ANALYSIS
// ═══════════════════════════════════════════════════════════════

export function analyzeEntry(
  data: IndicatorData,
  trendDirection: TrendDirection
): EntryAnalysis {
  const { entry } = STRATEGY;
  
  // Get current values
  const price = data.currentPrice;
  const ema20 = getLatestValue(data.ema20);
  const ema50 = getLatestValue(data.ema50);
  const rsi = getLatestValue(data.rsi);
  const rsiPrevious = getPreviousValue(data.rsi, 1);
  const rsi2Back = getPreviousValue(data.rsi, 2);
  const rsi3Back = getPreviousValue(data.rsi, 3);
  const rsi4Back = getPreviousValue(data.rsi, 4);

  // Handle missing data
  if (ema20 === null || ema50 === null || rsi === null || rsiPrevious === null) {
    logger.warn(`Missing entry data for ${data.symbol}`);
    return createInvalidResult(price, ema20, ema50, rsi, 'Missing indicator data');
  }

  // No entry if no trend
  if (trendDirection === 'none') {
    return createInvalidResult(price, ema20, ema50, rsi, 'No trend established');
  }

  // ═══════════════════════════════════════════════════════════════
  // CHECK PULLBACK ZONE
  // ═══════════════════════════════════════════════════════════════

  const emaHigh = Math.max(ema20, ema50);
  const emaLow = Math.min(ema20, ema50);
  
  let inPullbackZone = false;
  let inStrictZone = false;
  let inToleranceZone = false;
  let pullbackDepth: 'shallow' | 'deep' | 'none' = 'none';
  
  if (trendDirection === 'bullish') {
    // For bullish: price should pull back DOWN to EMA zone
    if (price >= emaLow && price <= emaHigh) {
      inStrictZone = true;
      inPullbackZone = true;
      pullbackDepth = price <= ema50 ? 'deep' : 'shallow';
    } else if (price < emaLow && price >= emaLow * 0.995) {
      // Price overshot below zone (within 0.5% tolerance)
      inToleranceZone = true;
      inPullbackZone = true;
      pullbackDepth = 'deep';
    }
  } else {
    // For bearish: price should pull back UP to EMA zone
    if (price >= emaLow && price <= emaHigh) {
      inStrictZone = true;
      inPullbackZone = true;
      pullbackDepth = price >= ema50 ? 'deep' : 'shallow';
    } else if (price > emaHigh && price <= emaHigh * 1.005) {
      // Price overshot above zone (within 0.5% tolerance)
      inToleranceZone = true;
      inPullbackZone = true;
      pullbackDepth = 'deep';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CHECK RSI RESET
  // ═══════════════════════════════════════════════════════════════

  let rsiWasReset = false;
  let rsiTurning = false;
  let rsiResetStrength = 0;
  
  if (trendDirection === 'bullish') {
    // RSI should have gone below 50 and now turning up
    // Check last 5 bars for RSI reset (captures proper pullback depth)
    const rsiHistory = [rsiPrevious, rsi2Back, rsi3Back, rsi4Back].filter((v): v is number => v !== null);
    const wasBelow50 = rsiHistory.some(v => v < entry.rsi.bullishResetBelow);
    rsiWasReset = wasBelow50;
    rsiTurning = rsi > rsiPrevious;
    const lowestRsi = Math.min(...rsiHistory, rsiPrevious);
    rsiResetStrength = rsi - lowestRsi;
  } else {
    // RSI should have gone above 50 and now turning down
    // Check last 5 bars for RSI reset (captures proper pullback depth)
    const rsiHistory = [rsiPrevious, rsi2Back, rsi3Back, rsi4Back].filter((v): v is number => v !== null);
    const wasAbove50 = rsiHistory.some(v => v > entry.rsi.bearishResetAbove);
    rsiWasReset = wasAbove50;
    rsiTurning = rsi < rsiPrevious;
    const highestRsi = Math.max(...rsiHistory, rsiPrevious);
    rsiResetStrength = highestRsi - rsi;
  }

  // ═══════════════════════════════════════════════════════════════
  // DETERMINE ENTRY STATUS
  // ═══════════════════════════════════════════════════════════════

  let status: EntryStatus = 'invalid';
  let reason = '';
  let isStrong = false;

  // Entry zone is ALWAYS the strict EMA band (strategy definition)
  const entryZoneLow = emaLow;
  const entryZoneHigh = emaHigh;

  // READY: Only when price is in STRICT zone AND RSI conditions met
  if (inStrictZone && rsiWasReset && rsiTurning) {
    status = 'ready';
    isStrong = rsiResetStrength >= STRATEGY.grading.rsiResetStrength.strong && 
               pullbackDepth === 'deep';
    
    const directionWord = trendDirection === 'bullish' ? 'up' : 'down';
    const depthWord = pullbackDepth === 'deep' ? 'deep' : 'shallow';
    reason = `${depthWord} pullback to EMA zone, RSI reset ${rsiPrevious.toFixed(1)}→${rsi.toFixed(1)} (turning ${directionWord})`;
  } 
  // BUILDING: In tolerance zone OR in strict zone but RSI not ready
  else if (inPullbackZone) {
    status = 'building';
    
    const missing: string[] = [];
    
    // If in tolerance zone, show overshoot percentage
    if (inToleranceZone) {
      const overshoot = trendDirection === 'bullish'
        ? ((emaLow - price) / price * 100).toFixed(2)
        : ((price - emaHigh) / price * 100).toFixed(2);
      missing.push(`Price ${overshoot}% outside EMA zone - waiting for return`);
    }
    
    if (!rsiWasReset) missing.push('RSI not reset');
    if (!rsiTurning) missing.push('RSI not turning');
    
    reason = inToleranceZone 
      ? `In tolerance zone: ${missing.join(', ')}`
      : `In pullback zone, waiting: ${missing.join(', ')}`;
  }
  // INVALID: Price not near zone at all
  else {
    status = 'invalid';
    
    const distanceToZone = trendDirection === 'bullish' 
      ? ((price - emaHigh) / price * 100).toFixed(2)
      : ((emaLow - price) / price * 100).toFixed(2);
    reason = `Price not in pullback zone (${distanceToZone}% away)`;
  }

  logger.debug(`Entry analysis for ${data.symbol}: ${status}`, {
    price,
    ema20,
    ema50,
    rsi,
    inPullbackZone,
    rsiWasReset,
    rsiTurning,
  });

  return {
    status,
    price,
    ema20: ema20 ?? 0,
    ema50: ema50 ?? 0,
    rsi: rsi ?? 0,
    rsiPrevious: rsiPrevious ?? 0,
    inPullbackZone,
    inStrictZone,
    inToleranceZone,
    pullbackDepth,
    rsiWasReset,
    rsiTurning,
    rsiResetStrength,
    entryZoneLow,
    entryZoneHigh,
    isStrong,
    reason,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function createInvalidResult(
  price: number,
  ema20: number | null,
  ema50: number | null,
  rsi: number | null,
  reason: string
): EntryAnalysis {
  return {
    status: 'invalid',
    price,
    ema20: ema20 ?? 0,
    ema50: ema50 ?? 0,
    rsi: rsi ?? 0,
    rsiPrevious: 0,
    inPullbackZone: false,
    inStrictZone: false,
    inToleranceZone: false,
    pullbackDepth: 'none',
    rsiWasReset: false,
    rsiTurning: false,
    rsiResetStrength: 0,
    entryZoneLow: 0,
    entryZoneHigh: 0,
    isStrong: false,
    reason,
  };
}

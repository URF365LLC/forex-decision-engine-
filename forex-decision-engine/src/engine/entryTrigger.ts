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
  let pullbackDepth: 'shallow' | 'deep' | 'none' = 'none';
  
  if (trendDirection === 'bullish') {
    // For bullish: price should pull back DOWN to EMA zone
    if (price >= emaLow && price <= emaHigh) {
      inPullbackZone = true;
      pullbackDepth = price <= ema50 ? 'deep' : 'shallow';
    } else if (price < emaLow && price >= emaLow * 0.995) {
      // Allow slight overshoot (0.5%)
      inPullbackZone = true;
      pullbackDepth = 'deep';
    }
  } else {
    // For bearish: price should pull back UP to EMA zone
    if (price >= emaLow && price <= emaHigh) {
      inPullbackZone = true;
      pullbackDepth = price >= ema50 ? 'deep' : 'shallow';
    } else if (price > emaHigh && price <= emaHigh * 1.005) {
      // Allow slight overshoot (0.5%)
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
    const wasBelow50 = rsiPrevious < entry.rsi.bullishResetBelow || 
                       (rsi2Back !== null && rsi2Back < entry.rsi.bullishResetBelow);
    rsiWasReset = wasBelow50;
    rsiTurning = rsi > rsiPrevious;
    rsiResetStrength = rsi - Math.min(rsiPrevious, rsi2Back ?? rsiPrevious);
  } else {
    // RSI should have gone above 50 and now turning down
    const wasAbove50 = rsiPrevious > entry.rsi.bearishResetAbove ||
                       (rsi2Back !== null && rsi2Back > entry.rsi.bearishResetAbove);
    rsiWasReset = wasAbove50;
    rsiTurning = rsi < rsiPrevious;
    rsiResetStrength = Math.max(rsiPrevious, rsi2Back ?? rsiPrevious) - rsi;
  }

  // ═══════════════════════════════════════════════════════════════
  // DETERMINE ENTRY STATUS
  // ═══════════════════════════════════════════════════════════════

  let status: EntryStatus = 'invalid';
  let reason = '';
  let isStrong = false;

  // Calculate entry zone based on direction and current price
  let entryZoneLow = emaLow;
  let entryZoneHigh = emaHigh;
  
  // If price has overshot the zone, adjust entry zone to reflect actual entry area
  if (inPullbackZone) {
    if (trendDirection === 'bullish' && price < emaLow) {
      // Price below zone in uptrend - entry would be around current price
      entryZoneLow = price;
    } else if (trendDirection === 'bearish' && price > emaHigh) {
      // Price above zone in downtrend - entry would be around current price
      entryZoneHigh = price;
    }
  }

  if (inPullbackZone && rsiWasReset && rsiTurning) {
    status = 'ready';
    isStrong = rsiResetStrength >= STRATEGY.grading.rsiResetStrength.strong && 
               pullbackDepth === 'deep';
    
    const directionWord = trendDirection === 'bullish' ? 'up' : 'down';
    const depthWord = pullbackDepth === 'deep' ? 'deep' : 'shallow';
    reason = `${depthWord} pullback to EMA zone, RSI reset ${rsiPrevious.toFixed(1)}→${rsi.toFixed(1)} (turning ${directionWord})`;
  } 
  else if (inPullbackZone) {
    status = 'building';
    
    const missing: string[] = [];
    if (!rsiWasReset) missing.push('RSI not reset');
    if (!rsiTurning) missing.push('RSI not turning');
    
    reason = `In pullback zone, waiting: ${missing.join(', ')}`;
  }
  else {
    status = 'invalid';
    
    const missing: string[] = [];
    if (!inPullbackZone) {
      const distanceToZone = trendDirection === 'bullish' 
        ? ((price - emaHigh) / price * 100).toFixed(2)
        : ((emaLow - price) / price * 100).toFixed(2);
      missing.push(`Price not in pullback zone (${distanceToZone}% away)`);
    }
    
    reason = missing.join(', ') || 'No valid entry setup';
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

/**
 * Trend Filter Engine
 * Determines trend direction on higher timeframe
 * 
 * Rules:
 * - BULLISH: Price > EMA200 AND EMA200 slope > 0 AND ADX > 20
 * - BEARISH: Price < EMA200 AND EMA200 slope < 0 AND ADX > 20
 * - NO TREND: Otherwise
 */

import { STRATEGY } from '../config/strategy.js';
import { 
  IndicatorData, 
  getLatestValue, 
  calculateSlope 
} from './indicatorService.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('TrendFilter');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type TrendDirection = 'bullish' | 'bearish' | 'none';

export interface TrendAnalysis {
  direction: TrendDirection;
  
  // Component values
  price: number;
  ema200: number;
  ema200Slope: number;
  adx: number;
  
  // Component checks
  priceAboveEma: boolean;
  priceBelowEma: boolean;
  slopePositive: boolean;
  slopeNegative: boolean;
  adxAboveThreshold: boolean;
  adxBorderline: boolean;
  
  // Confidence
  isStrong: boolean;          // All conditions met clearly
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// TREND ANALYSIS
// ═══════════════════════════════════════════════════════════════

export function analyzeTrend(data: IndicatorData): TrendAnalysis {
  const { trend } = STRATEGY;
  
  // Get current values
  const price = data.currentPrice;
  const ema200 = getLatestValue(data.ema200);
  const adx = getLatestValue(data.adx);
  const ema200Slope = calculateSlope(data.ema200, trend.ema.slopeLookback);

  // Handle missing data
  if (ema200 === null || adx === null) {
    logger.warn(`Missing trend data for ${data.symbol}`, { ema200, adx });
    return createNoTrendResult(price, ema200, adx, ema200Slope, 'Missing indicator data');
  }

  // ═══════════════════════════════════════════════════════════════
  // CHECK CONDITIONS
  // ═══════════════════════════════════════════════════════════════

  const priceAboveEma = price > ema200;
  const priceBelowEma = price < ema200;
  const slopePositive = ema200Slope > 0;
  const slopeNegative = ema200Slope < 0;
  const adxAboveThreshold = adx >= trend.adx.threshold;
  const adxBorderline = adx >= STRATEGY.grading.adxBorderline.min && adx < trend.adx.threshold;

  // ═══════════════════════════════════════════════════════════════
  // DETERMINE TREND
  // ═══════════════════════════════════════════════════════════════

  let direction: TrendDirection = 'none';
  let reason = '';
  let isStrong = false;

  // BULLISH TREND
  if (priceAboveEma && slopePositive && (adxAboveThreshold || adxBorderline)) {
    direction = 'bullish';
    isStrong = adxAboveThreshold;
    
    if (isStrong) {
      reason = `Uptrend: Price > EMA200, slope +${ema200Slope.toFixed(5)}, ADX ${adx.toFixed(1)}`;
    } else {
      reason = `Weak uptrend: Price > EMA200, slope +${ema200Slope.toFixed(5)}, ADX ${adx.toFixed(1)} (borderline)`;
    }
  }
  // BEARISH TREND
  else if (priceBelowEma && slopeNegative && (adxAboveThreshold || adxBorderline)) {
    direction = 'bearish';
    isStrong = adxAboveThreshold;
    
    if (isStrong) {
      reason = `Downtrend: Price < EMA200, slope ${ema200Slope.toFixed(5)}, ADX ${adx.toFixed(1)}`;
    } else {
      reason = `Weak downtrend: Price < EMA200, slope ${ema200Slope.toFixed(5)}, ADX ${adx.toFixed(1)} (borderline)`;
    }
  }
  // NO TREND
  else {
    const reasons: string[] = [];
    
    if (!priceAboveEma && !priceBelowEma) {
      reasons.push('Price at EMA200');
    }
    if (!slopePositive && !slopeNegative) {
      reasons.push('EMA200 flat');
    }
    if (!adxAboveThreshold && !adxBorderline) {
      reasons.push(`ADX ${adx.toFixed(1)} below threshold (need ${trend.adx.threshold}+)`);
    }
    
    reason = reasons.length > 0 ? reasons.join(', ') : 'No clear trend';
  }

  logger.debug(`Trend analysis for ${data.symbol}: ${direction}`, {
    price,
    ema200,
    ema200Slope,
    adx,
    isStrong,
  });

  return {
    direction,
    price,
    ema200: ema200 ?? 0,
    ema200Slope,
    adx: adx ?? 0,
    priceAboveEma,
    priceBelowEma,
    slopePositive,
    slopeNegative,
    adxAboveThreshold,
    adxBorderline,
    isStrong,
    reason,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function createNoTrendResult(
  price: number,
  ema200: number | null,
  adx: number | null,
  slope: number,
  reason: string
): TrendAnalysis {
  return {
    direction: 'none',
    price,
    ema200: ema200 ?? 0,
    ema200Slope: slope,
    adx: adx ?? 0,
    priceAboveEma: false,
    priceBelowEma: false,
    slopePositive: false,
    slopeNegative: false,
    adxAboveThreshold: false,
    adxBorderline: false,
    isStrong: false,
    reason,
  };
}

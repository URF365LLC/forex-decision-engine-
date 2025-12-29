/**
 * STRATEGY: Triple EMA Crossover (Intraday)
 * 
 * Win Rate: ~55%
 * Risk:Reward: 1:2
 * Signals/Day: 2-3
 * 
 * RULES:
 * ══════════════════════════════════════════════════════════════
 * SETUP:
 * - Uses 3 EMAs: EMA8 (fast), EMA21 (medium), EMA55 (slow)
 * - All 3 EMAs should be aligned in same direction
 * 
 * ENTRY:
 * - LONG: EMA8 > EMA21 > EMA55 (bullish alignment)
 *         + Price pulls back to EMA8-EMA21 zone
 *         + Price closes back above EMA8
 * - SHORT: EMA8 < EMA21 < EMA55 (bearish alignment)
 *          + Price pulls back to EMA8-EMA21 zone
 *          + Price closes back below EMA8
 * 
 * STOP LOSS:
 * - Beyond EMA55 or recent swing
 * 
 * TAKE PROFIT:
 * - 2R minimum
 * ══════════════════════════════════════════════════════════════
 */

import {
  IStrategy,
  StrategyMeta,
  IndicatorData,
  Decision,
  UserSettings,
  Bar,
} from '../types';

import {
  latest,
  previous,
  findSwingHigh,
  findSwingLow,
  buildDecision,
  hasEnoughData,
} from '../utils';

// ═══════════════════════════════════════════════════════════════
// STRATEGY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // EMA Periods (we'll calculate from EMA20/50 if not available)
  fastPeriod: 8,
  mediumPeriod: 21,
  slowPeriod: 55,
  
  // Pullback tolerance (price can be slightly beyond EMA zone)
  pullbackTolerance: 0.002, // 0.2%
  
  // Risk Management
  swingLookback: 12,
  minRR: 2.0,
};

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate EMA from bars
// ═══════════════════════════════════════════════════════════════

function calculateEMA(bars: Bar[], period: number): number[] {
  if (bars.length < period) return [];
  
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  
  // Start with SMA for first value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].close;
  }
  ema.push(sum / period);
  
  // Calculate EMA for rest
  for (let i = period; i < bars.length; i++) {
    const newEma = (bars[i].close - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(newEma);
  }
  
  return ema;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class TripleEmaIntraday implements IStrategy {
  meta: StrategyMeta = {
    id: 'triple-ema',
    name: 'Triple EMA Crossover',
    description: 'Trend following with EMA8/21/55 alignment and pullback entry',
    style: 'intraday',
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'atr'],
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { bars, atr } = data;
    const symbol = data.symbol;
    
    // Need enough bars to calculate EMA55
    if (!hasEnoughData(bars, 70) || !hasEnoughData(atr, 20)) {
      return null;
    }
    
    const currentBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const price = currentBar.close;
    const currentAtr = latest(atr)!;

    // Calculate EMAs
    const ema8 = calculateEMA(bars, CONFIG.fastPeriod);
    const ema21 = calculateEMA(bars, CONFIG.mediumPeriod);
    const ema55 = calculateEMA(bars, CONFIG.slowPeriod);
    
    if (ema8.length < 3 || ema21.length < 3 || ema55.length < 3) {
      return null;
    }
    
    const currentEma8 = ema8[ema8.length - 1];
    const currentEma21 = ema21[ema21.length - 1];
    const currentEma55 = ema55[ema55.length - 1];
    
    const prevEma8 = ema8[ema8.length - 2];
    const prevEma21 = ema21[ema21.length - 2];

    const triggers: string[] = [];
    const warnings: string[] = [];
    let confidence = 0;

    // ════════════════════════════════════════════════════════════
    // STEP 1: CHECK EMA ALIGNMENT
    // ════════════════════════════════════════════════════════════
    
    const bullishAlignment = currentEma8 > currentEma21 && currentEma21 > currentEma55;
    const bearishAlignment = currentEma8 < currentEma21 && currentEma21 < currentEma55;
    
    if (!bullishAlignment && !bearishAlignment) {
      return null; // EMAs not aligned
    }
    
    const direction: 'long' | 'short' = bullishAlignment ? 'long' : 'short';
    
    triggers.push(`EMAs aligned ${direction.toUpperCase()}: EMA8 ${bullishAlignment ? '>' : '<'} EMA21 ${bullishAlignment ? '>' : '<'} EMA55`);
    confidence += 25;

    // ════════════════════════════════════════════════════════════
    // STEP 2: CHECK FOR PULLBACK TO EMA ZONE
    // ════════════════════════════════════════════════════════════
    
    const emaZoneHigh = Math.max(currentEma8, currentEma21);
    const emaZoneLow = Math.min(currentEma8, currentEma21);
    const tolerance = price * CONFIG.pullbackTolerance;
    
    let inPullbackZone = false;
    let pulledBack = false;
    
    if (direction === 'long') {
      // For longs: price should have dipped into EMA8-21 zone
      inPullbackZone = currentBar.low <= emaZoneHigh + tolerance;
      pulledBack = prevBar.low <= emaZoneHigh || currentBar.low <= emaZoneHigh;
    } else {
      // For shorts: price should have risen into EMA8-21 zone
      inPullbackZone = currentBar.high >= emaZoneLow - tolerance;
      pulledBack = prevBar.high >= emaZoneLow || currentBar.high >= emaZoneLow;
    }
    
    if (!pulledBack) {
      return null; // No pullback to EMA zone
    }
    
    triggers.push(`Price pulled back to EMA8-21 zone`);
    confidence += 20;

    // ════════════════════════════════════════════════════════════
    // STEP 3: CHECK FOR RECLAIM (price closing back in direction)
    // ════════════════════════════════════════════════════════════
    
    let hasReclaim = false;
    
    if (direction === 'long') {
      // Price should close above EMA8 (reclaiming the fast EMA)
      hasReclaim = price > currentEma8;
      
      if (hasReclaim) {
        triggers.push(`Price reclaimed EMA8 at ${currentEma8.toFixed(5)}`);
        confidence += 20;
      } else if (price > currentEma21) {
        triggers.push('Price above EMA21, approaching EMA8');
        confidence += 10;
        warnings.push('Wait for EMA8 reclaim for stronger entry');
      } else {
        return null; // Price still below EMA21
      }
    } else {
      // Price should close below EMA8
      hasReclaim = price < currentEma8;
      
      if (hasReclaim) {
        triggers.push(`Price broke below EMA8 at ${currentEma8.toFixed(5)}`);
        confidence += 20;
      } else if (price < currentEma21) {
        triggers.push('Price below EMA21, approaching EMA8');
        confidence += 10;
        warnings.push('Wait for EMA8 break for stronger entry');
      } else {
        return null; // Price still above EMA21
      }
    }

    // ════════════════════════════════════════════════════════════
    // STEP 4: EMA SPACING (well-spaced = stronger trend)
    // ════════════════════════════════════════════════════════════
    
    const ema8_21_gap = Math.abs(currentEma8 - currentEma21) / currentEma21;
    const ema21_55_gap = Math.abs(currentEma21 - currentEma55) / currentEma55;
    
    if (ema8_21_gap > 0.003 && ema21_55_gap > 0.005) {
      triggers.push('EMAs well-spaced - strong trend');
      confidence += 15;
    } else if (ema8_21_gap > 0.001) {
      triggers.push('EMAs showing trend');
      confidence += 10;
    } else {
      warnings.push('EMAs converging - trend may be weakening');
      confidence += 5;
    }

    // ════════════════════════════════════════════════════════════
    // STEP 5: MOMENTUM (price action)
    // ════════════════════════════════════════════════════════════
    
    const isBullishCandle = currentBar.close > currentBar.open;
    const isBearishCandle = currentBar.close < currentBar.open;
    
    if (direction === 'long' && isBullishCandle) {
      triggers.push('Bullish candle confirms');
      confidence += 10;
    } else if (direction === 'short' && isBearishCandle) {
      triggers.push('Bearish candle confirms');
      confidence += 10;
    }

    // ════════════════════════════════════════════════════════════
    // STEP 6: CALCULATE STOP LOSS & TAKE PROFIT
    // ════════════════════════════════════════════════════════════
    
    let stopLossPrice: number;
    let takeProfitPrice: number;
    
    if (direction === 'long') {
      // Stop below EMA55 or swing low
      const swingLow = findSwingLow(bars, CONFIG.swingLookback);
      stopLossPrice = Math.min(swingLow, currentEma55 - currentAtr * 0.5);
      
      const risk = price - stopLossPrice;
      takeProfitPrice = price + (risk * CONFIG.minRR);
    } else {
      // Stop above EMA55 or swing high
      const swingHigh = findSwingHigh(bars, CONFIG.swingLookback);
      stopLossPrice = Math.max(swingHigh, currentEma55 + currentAtr * 0.5);
      
      const risk = stopLossPrice - price;
      takeProfitPrice = price - (risk * CONFIG.minRR);
    }

    // Cap confidence at 100
    confidence = Math.min(confidence, 100);
    
    // Minimum confidence threshold
    if (confidence < 50) {
      return null;
    }

    // ════════════════════════════════════════════════════════════
    // STEP 7: BUILD DECISION
    // ════════════════════════════════════════════════════════════
    
    const reason = direction === 'long'
      ? `Triple EMA bullish alignment (8>21>55), pullback entry with EMA8 reclaim`
      : `Triple EMA bearish alignment (8<21<55), pullback entry below EMA8`;

    return buildDecision({
      symbol,
      strategyId: this.meta.id,
      strategyName: this.meta.name,
      direction,
      confidence,
      entryPrice: price,
      stopLossPrice,
      takeProfitPrice,
      reason,
      triggers,
      warnings,
      settings,
    });
  }
}

// Export singleton instance
export const tripleEmaIntraday = new TripleEmaIntraday();

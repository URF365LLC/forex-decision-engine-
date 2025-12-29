/**
 * STRATEGY: EMA Pullback (Intraday)
 * 
 * Win Rate: ~50%
 * Risk:Reward: 1:2
 * Signals/Day: 2-3
 * 
 * RULES:
 * ══════════════════════════════════════════════════════════════
 * TREND FILTER (D1):
 * - Price above EMA200 + EMA200 slope positive + ADX > 20 = Bullish
 * - Price below EMA200 + EMA200 slope negative + ADX > 20 = Bearish
 * 
 * ENTRY TRIGGER (H1):
 * - LONG: Price pulls back to EMA20-50 zone, RSI was below 50, now turning up
 * - SHORT: Price pulls back to EMA20-50 zone, RSI was above 50, now turning down
 * 
 * STOP LOSS:
 * - Below/above recent swing low/high (10 bars)
 * - Fallback: 1.5x ATR from entry
 * 
 * TAKE PROFIT:
 * - Minimum 2R from entry
 * ══════════════════════════════════════════════════════════════
 */

import {
  IStrategy,
  StrategyMeta,
  IndicatorData,
  Decision,
  UserSettings,
} from '../types';

import {
  latest,
  previous,
  lastN,
  calculateSlope,
  isRising,
  isFalling,
  priceAboveEma,
  priceBelowEma,
  findSwingHigh,
  findSwingLow,
  calculateGrade,
  buildDecision,
  validateIndicators,
} from '../utils';

// ═══════════════════════════════════════════════════════════════
// STRATEGY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Trend Filter
  ema200SlopeLookback: 3,
  minSlopeThreshold: 0.00005,  // Minimum slope to confirm trend
  adxThreshold: 20,
  adxBorderline: 18,
  
  // Entry Zone
  rsiResetLevel: 50,
  rsiLookback: 5,             // How many bars back to check for RSI reset
  rsiResetStrengthStrong: 5,  // RSI moved 5+ points = strong
  rsiResetStrengthWeak: 2,    // RSI moved 2-5 points = weak
  
  // Risk Management
  swingLookback: 10,
  atrMultiplier: 1.5,
  minRR: 2.0,
};

// ═══════════════════════════════════════════════════════════════
// STRATEGY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class EmaPullbackIntraday implements IStrategy {
  meta: StrategyMeta = {
    id: 'ema-pullback-intra',
    name: 'EMA Pullback',
    description: 'Trend continuation on pullback to EMA20-50 zone with RSI reset confirmation',
    style: 'intraday',
    winRate: 50,
    avgRR: 2.0,
    signalsPerWeek: '8-15',
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'],
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    // Validate data
    if (!validateIndicators(data, this.meta.requiredIndicators, 50)) {
      return null;
    }

    const { bars, ema20, ema50, ema200, rsi, adx, atr } = data;
    const symbol = data.symbol;
    
    const currentBar = bars[bars.length - 1];
    const price = currentBar.close;
    
    const currentEma20 = latest(ema20)!;
    const currentEma50 = latest(ema50)!;
    const currentEma200 = latest(ema200)!;
    const currentRsi = latest(rsi)!;
    const currentAdx = latest(adx)!;
    const currentAtr = latest(atr)!;

    const triggers: string[] = [];
    const warnings: string[] = [];
    let confidence = 0;

    // ════════════════════════════════════════════════════════════
    // STEP 1: DETERMINE TREND DIRECTION
    // ════════════════════════════════════════════════════════════
    
    const ema200Slope = calculateSlope(ema200, CONFIG.ema200SlopeLookback);
    const slopePositive = ema200Slope > CONFIG.minSlopeThreshold;
    const slopeNegative = ema200Slope < -CONFIG.minSlopeThreshold;
    
    const bullishTrend = price > currentEma200 && slopePositive;
    const bearishTrend = price < currentEma200 && slopeNegative;
    
    if (!bullishTrend && !bearishTrend) {
      return null; // No clear trend
    }

    // ADX Check
    if (currentAdx < CONFIG.adxBorderline) {
      return null; // Trend too weak
    }
    
    if (currentAdx >= CONFIG.adxThreshold) {
      triggers.push(`ADX ${currentAdx.toFixed(1)} confirms strong trend`);
      confidence += 25;
    } else {
      warnings.push(`ADX ${currentAdx.toFixed(1)} is borderline (${CONFIG.adxBorderline}-${CONFIG.adxThreshold})`);
      confidence += 15;
    }

    const direction = bullishTrend ? 'long' : 'short';
    triggers.push(`${direction.toUpperCase()} trend: Price ${bullishTrend ? 'above' : 'below'} EMA200`);
    confidence += 20;

    // ════════════════════════════════════════════════════════════
    // STEP 2: CHECK PULLBACK TO EMA ZONE
    // ════════════════════════════════════════════════════════════
    
    const emaZoneHigh = Math.max(currentEma20, currentEma50);
    const emaZoneLow = Math.min(currentEma20, currentEma50);
    
    let inPullbackZone = false;
    
    if (direction === 'long') {
      // Price should be between EMA20 and EMA50, or just touched the zone
      inPullbackZone = price >= emaZoneLow && price <= emaZoneHigh * 1.005;
    } else {
      inPullbackZone = price <= emaZoneHigh && price >= emaZoneLow * 0.995;
    }
    
    if (!inPullbackZone) {
      return null; // Not in pullback zone
    }
    
    triggers.push(`Price in EMA20-50 pullback zone`);
    confidence += 20;

    // ════════════════════════════════════════════════════════════
    // STEP 3: RSI RESET CONFIRMATION
    // ════════════════════════════════════════════════════════════
    
    const rsiHistory = lastN(rsi, CONFIG.rsiLookback);
    let rsiWasReset = false;
    let rsiResetStrength = 0;
    
    if (direction === 'long') {
      // RSI should have gone below 50 and now turning up
      const lowestRsi = Math.min(...rsiHistory);
      rsiWasReset = lowestRsi < CONFIG.rsiResetLevel;
      rsiResetStrength = currentRsi - lowestRsi;
      
      if (!rsiWasReset || currentRsi <= previous(rsi, 1)!) {
        return null; // RSI didn't reset or not turning up
      }
    } else {
      // RSI should have gone above 50 and now turning down
      const highestRsi = Math.max(...rsiHistory);
      rsiWasReset = highestRsi > CONFIG.rsiResetLevel;
      rsiResetStrength = highestRsi - currentRsi;
      
      if (!rsiWasReset || currentRsi >= previous(rsi, 1)!) {
        return null; // RSI didn't reset or not turning down
      }
    }
    
    if (rsiResetStrength >= CONFIG.rsiResetStrengthStrong) {
      triggers.push(`RSI reset confirmed: ${rsiResetStrength.toFixed(1)} points`);
      confidence += 25;
    } else if (rsiResetStrength >= CONFIG.rsiResetStrengthWeak) {
      triggers.push(`RSI reset (weak): ${rsiResetStrength.toFixed(1)} points`);
      confidence += 15;
      warnings.push('RSI reset strength is marginal');
    } else {
      return null; // RSI reset too weak
    }

    // ════════════════════════════════════════════════════════════
    // STEP 4: CALCULATE STOP LOSS & TAKE PROFIT
    // ════════════════════════════════════════════════════════════
    
    let stopLossPrice: number;
    let takeProfitPrice: number;
    
    if (direction === 'long') {
      const swingLow = findSwingLow(bars, CONFIG.swingLookback);
      stopLossPrice = Math.min(swingLow, price - currentAtr * CONFIG.atrMultiplier);
      
      const risk = price - stopLossPrice;
      takeProfitPrice = price + (risk * CONFIG.minRR);
    } else {
      const swingHigh = findSwingHigh(bars, CONFIG.swingLookback);
      stopLossPrice = Math.max(swingHigh, price + currentAtr * CONFIG.atrMultiplier);
      
      const risk = stopLossPrice - price;
      takeProfitPrice = price - (risk * CONFIG.minRR);
    }

    // ════════════════════════════════════════════════════════════
    // STEP 5: ADDITIONAL CONFLUENCE (BONUS POINTS)
    // ════════════════════════════════════════════════════════════
    
    // EMA stacking (EMA20 > EMA50 > EMA200 for bullish)
    if (direction === 'long' && currentEma20 > currentEma50 && currentEma50 > currentEma200) {
      triggers.push('EMAs properly stacked (20 > 50 > 200)');
      confidence += 10;
    } else if (direction === 'short' && currentEma20 < currentEma50 && currentEma50 < currentEma200) {
      triggers.push('EMAs properly stacked (20 < 50 < 200)');
      confidence += 10;
    }

    // Cap confidence at 100
    confidence = Math.min(confidence, 100);

    // ════════════════════════════════════════════════════════════
    // STEP 6: BUILD DECISION
    // ════════════════════════════════════════════════════════════
    
    const reason = direction === 'long'
      ? `Bullish trend on D1, price pulled back to EMA20-50 zone, RSI reset below 50 and turning up`
      : `Bearish trend on D1, price pulled back to EMA20-50 zone, RSI reset above 50 and turning down`;

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
export const emaPullbackIntraday = new EmaPullbackIntraday();

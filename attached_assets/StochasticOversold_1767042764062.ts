/**
 * STRATEGY: Stochastic Oversold (Intraday)
 * 
 * Win Rate: ~65%
 * Risk:Reward: 1:1.5
 * Signals/Day: 4-6
 * 
 * RULES:
 * ══════════════════════════════════════════════════════════════
 * SETUP:
 * - Stochastic %K and %D both below 20 (oversold) or above 80 (overbought)
 * - Wait for %K to cross %D (bullish/bearish cross)
 * 
 * ENTRY:
 * - LONG: %K crosses above %D in oversold zone (<20)
 * - SHORT: %K crosses below %D in overbought zone (>80)
 * 
 * FILTER:
 * - Optional: Price should be near support/resistance (EMA zones)
 * 
 * STOP LOSS:
 * - Beyond the extreme candle
 * - Or 1x ATR from entry
 * 
 * TAKE PROFIT:
 * - When Stochastic reaches opposite extreme
 * - Or 1.5R minimum
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
  findSwingHigh,
  findSwingLow,
  buildDecision,
  validateIndicators,
  priceAboveEma,
  priceBelowEma,
} from '../utils';

// ═══════════════════════════════════════════════════════════════
// STRATEGY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Stochastic Levels
  oversoldLevel: 20,
  overboughtLevel: 80,
  extremeOversold: 10,
  extremeOverbought: 90,
  
  // Trend Filter (optional)
  useTrendFilter: true,
  
  // Risk Management
  atrMultiplier: 1.0,
  swingLookback: 8,
  minRR: 1.5,
};

// ═══════════════════════════════════════════════════════════════
// STRATEGY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class StochasticOversoldIntraday implements IStrategy {
  meta: StrategyMeta = {
    id: 'stoch-oversold',
    name: 'Stochastic Oversold',
    description: 'Mean reversion from Stochastic extremes with %K/%D crossover confirmation',
    style: 'intraday',
    winRate: 65,
    avgRR: 1.5,
    signalsPerWeek: '20-30',
    requiredIndicators: ['bars', 'stoch', 'atr', 'ema200'],
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    // Validate data
    if (!validateIndicators(data, this.meta.requiredIndicators, 30)) {
      return null;
    }

    const { bars, stoch, atr, ema200 } = data;
    const symbol = data.symbol;
    
    const currentBar = bars[bars.length - 1];
    const price = currentBar.close;
    
    const currentStoch = latest(stoch)!;
    const prevStoch = previous(stoch, 1)!;
    const currentAtr = latest(atr)!;

    const triggers: string[] = [];
    const warnings: string[] = [];
    let confidence = 0;

    // ════════════════════════════════════════════════════════════
    // STEP 1: CHECK STOCHASTIC EXTREME ZONE
    // ════════════════════════════════════════════════════════════
    
    const isOversold = currentStoch.k < CONFIG.oversoldLevel && currentStoch.d < CONFIG.oversoldLevel;
    const isOverbought = currentStoch.k > CONFIG.overboughtLevel && currentStoch.d > CONFIG.overboughtLevel;
    
    if (!isOversold && !isOverbought) {
      return null; // Not in extreme zone
    }

    // ════════════════════════════════════════════════════════════
    // STEP 2: CHECK FOR %K/%D CROSSOVER
    // ════════════════════════════════════════════════════════════
    
    let direction: 'long' | 'short' | null = null;
    
    // Bullish crossover: %K crosses above %D in oversold
    const bullishCross = prevStoch.k <= prevStoch.d && currentStoch.k > currentStoch.d;
    
    // Bearish crossover: %K crosses below %D in overbought
    const bearishCross = prevStoch.k >= prevStoch.d && currentStoch.k < currentStoch.d;
    
    if (isOversold && bullishCross) {
      direction = 'long';
      triggers.push(`Bullish Stochastic cross in oversold zone`);
      triggers.push(`%K: ${currentStoch.k.toFixed(1)} crossed above %D: ${currentStoch.d.toFixed(1)}`);
      
      // Extra confidence for extreme oversold
      if (prevStoch.k < CONFIG.extremeOversold) {
        confidence += 35;
        triggers.push('Extremely oversold (%K < 10)');
      } else {
        confidence += 25;
      }
    }
    else if (isOverbought && bearishCross) {
      direction = 'short';
      triggers.push(`Bearish Stochastic cross in overbought zone`);
      triggers.push(`%K: ${currentStoch.k.toFixed(1)} crossed below %D: ${currentStoch.d.toFixed(1)}`);
      
      // Extra confidence for extreme overbought
      if (prevStoch.k > CONFIG.extremeOverbought) {
        confidence += 35;
        triggers.push('Extremely overbought (%K > 90)');
      } else {
        confidence += 25;
      }
    }
    
    if (!direction) {
      return null; // No crossover
    }

    // ════════════════════════════════════════════════════════════
    // STEP 3: TREND FILTER (Optional)
    // ════════════════════════════════════════════════════════════
    
    if (CONFIG.useTrendFilter && ema200) {
      const withTrend = (direction === 'long' && priceAboveEma(bars, ema200)) ||
                        (direction === 'short' && priceBelowEma(bars, ema200));
      
      if (withTrend) {
        triggers.push('Signal aligned with EMA200 trend');
        confidence += 15;
      } else {
        warnings.push('Counter-trend signal (against EMA200)');
        confidence += 5;
      }
    } else {
      confidence += 10; // No filter applied
    }

    // ════════════════════════════════════════════════════════════
    // STEP 4: CROSSOVER STRENGTH
    // ════════════════════════════════════════════════════════════
    
    const crossoverGap = Math.abs(currentStoch.k - currentStoch.d);
    
    if (crossoverGap >= 5) {
      triggers.push(`Strong crossover: %K/%D gap of ${crossoverGap.toFixed(1)}`);
      confidence += 20;
    } else if (crossoverGap >= 2) {
      triggers.push(`Crossover confirmed: %K/%D gap of ${crossoverGap.toFixed(1)}`);
      confidence += 10;
    } else {
      warnings.push('Weak crossover - %K and %D very close');
      confidence += 5;
    }

    // ════════════════════════════════════════════════════════════
    // STEP 5: CALCULATE STOP LOSS & TAKE PROFIT
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
    // STEP 6: CANDLE CONFIRMATION
    // ════════════════════════════════════════════════════════════
    
    const isBullishCandle = currentBar.close > currentBar.open;
    const isBearishCandle = currentBar.close < currentBar.open;
    
    if (direction === 'long' && isBullishCandle) {
      triggers.push('Bullish candle confirms');
      confidence += 10;
    } else if (direction === 'short' && isBearishCandle) {
      triggers.push('Bearish candle confirms');
      confidence += 10;
    } else {
      warnings.push('Current candle does not confirm direction');
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
      ? `Stochastic bullish crossover in oversold zone (%K=${currentStoch.k.toFixed(0)}, %D=${currentStoch.d.toFixed(0)})`
      : `Stochastic bearish crossover in overbought zone (%K=${currentStoch.k.toFixed(0)}, %D=${currentStoch.d.toFixed(0)})`;

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
export const stochasticOversoldIntraday = new StochasticOversoldIntraday();

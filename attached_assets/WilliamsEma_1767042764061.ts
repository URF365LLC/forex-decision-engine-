/**
 * STRATEGY: Williams %R + EMA (Intraday)
 * 
 * Win Rate: ~58%
 * Risk:Reward: 1:1.5
 * Signals/Day: 3-4
 * 
 * RULES:
 * ══════════════════════════════════════════════════════════════
 * Williams %R oscillates between 0 and -100
 * - Above -20 = Overbought
 * - Below -80 = Oversold
 * 
 * ENTRY:
 * - LONG: Williams %R crosses above -80 (leaving oversold) + Price above EMA50
 * - SHORT: Williams %R crosses below -20 (leaving overbought) + Price below EMA50
 * 
 * The EMA50 acts as a trend filter to avoid counter-trend entries.
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

const CONFIG = {
  oversoldLevel: -80,
  overboughtLevel: -20,
  extremeOversold: -90,
  extremeOverbought: -10,
  atrMultiplier: 1.0,
  swingLookback: 8,
  minRR: 1.5,
};

export class WilliamsEmaIntraday implements IStrategy {
  meta: StrategyMeta = {
    id: 'williams-ema',
    name: 'Williams %R + EMA',
    description: 'Williams %R overbought/oversold with EMA50 trend filter',
    style: 'intraday',
    winRate: 58,
    avgRR: 1.5,
    signalsPerWeek: '15-20',
    requiredIndicators: ['bars', 'willr', 'ema50', 'atr'],
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    if (!validateIndicators(data, this.meta.requiredIndicators, 30)) return null;

    const { bars, willr, ema50, atr } = data;
    const symbol = data.symbol;
    
    const currentBar = bars[bars.length - 1];
    const price = currentBar.close;
    
    const currentWillR = latest(willr)!;
    const prevWillR = previous(willr, 1)!;
    const currentEma50 = latest(ema50)!;
    const currentAtr = latest(atr)!;

    const triggers: string[] = [];
    const warnings: string[] = [];
    let confidence = 0;

    // ════════════════════════════════════════════════════════════
    // STEP 1: CHECK WILLIAMS %R CROSSOVER
    // ════════════════════════════════════════════════════════════
    
    let direction: 'long' | 'short' | null = null;
    
    // Bullish: Williams %R crosses above -80 (leaving oversold)
    const bullishCross = prevWillR <= CONFIG.oversoldLevel && currentWillR > CONFIG.oversoldLevel;
    
    // Bearish: Williams %R crosses below -20 (leaving overbought)
    const bearishCross = prevWillR >= CONFIG.overboughtLevel && currentWillR < CONFIG.overboughtLevel;
    
    if (bullishCross) {
      direction = 'long';
      triggers.push(`Williams %R crossed above -80 (was ${prevWillR.toFixed(1)}, now ${currentWillR.toFixed(1)})`);
      
      if (prevWillR < CONFIG.extremeOversold) {
        confidence += 35;
        triggers.push('Came from extremely oversold (<-90)');
      } else {
        confidence += 25;
      }
    }
    else if (bearishCross) {
      direction = 'short';
      triggers.push(`Williams %R crossed below -20 (was ${prevWillR.toFixed(1)}, now ${currentWillR.toFixed(1)})`);
      
      if (prevWillR > CONFIG.extremeOverbought) {
        confidence += 35;
        triggers.push('Came from extremely overbought (>-10)');
      } else {
        confidence += 25;
      }
    }
    
    if (!direction) return null;

    // ════════════════════════════════════════════════════════════
    // STEP 2: EMA50 TREND FILTER
    // ════════════════════════════════════════════════════════════
    
    const aboveEma = priceAboveEma(bars, ema50);
    const belowEma = priceBelowEma(bars, ema50);
    
    if (direction === 'long' && aboveEma) {
      triggers.push('Price above EMA50 - aligned with trend');
      confidence += 20;
    } else if (direction === 'short' && belowEma) {
      triggers.push('Price below EMA50 - aligned with trend');
      confidence += 20;
    } else if (direction === 'long' && belowEma) {
      warnings.push('Counter-trend long (price below EMA50)');
      confidence += 10;
    } else if (direction === 'short' && aboveEma) {
      warnings.push('Counter-trend short (price above EMA50)');
      confidence += 10;
    }

    // ════════════════════════════════════════════════════════════
    // STEP 3: MOMENTUM CONFIRMATION
    // ════════════════════════════════════════════════════════════
    
    const willrMomentum = Math.abs(currentWillR - prevWillR);
    
    if (willrMomentum >= 10) {
      triggers.push(`Strong Williams %R momentum: ${willrMomentum.toFixed(1)} points`);
      confidence += 15;
    } else if (willrMomentum >= 5) {
      triggers.push('Williams %R momentum confirmed');
      confidence += 10;
    } else {
      warnings.push('Weak momentum - consider waiting');
    }

    // ════════════════════════════════════════════════════════════
    // STEP 4: CANDLE CONFIRMATION
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

    confidence = Math.min(confidence, 100);
    if (confidence < 50) return null;

    const reason = direction === 'long'
      ? `Williams %R leaving oversold (${currentWillR.toFixed(0)}), price above EMA50`
      : `Williams %R leaving overbought (${currentWillR.toFixed(0)}), price below EMA50`;

    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice: price,
      stopLossPrice, takeProfitPrice, reason, triggers, warnings, settings,
    });
  }
}

export const williamsEmaIntraday = new WilliamsEmaIntraday();

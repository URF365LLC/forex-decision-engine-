/**
 * STRATEGY: CCI Zero-Line Cross (Intraday)
 * 
 * Win Rate: ~55%
 * Risk:Reward: 1:2
 * Signals/Day: 2-3
 * 
 * RULES:
 * ══════════════════════════════════════════════════════════════
 * CCI (Commodity Channel Index) measures deviation from average:
 * - Above +100 = Overbought
 * - Below -100 = Oversold
 * - Zero line = Neutral/mean
 * 
 * ENTRY:
 * - LONG: CCI crosses above 0 from below (coming from oversold territory)
 * - SHORT: CCI crosses below 0 from above (coming from overbought territory)
 * 
 * FILTER:
 * - Stronger signal if CCI was at extreme (<-100 or >+100) before crossing
 * - EMA200 trend filter optional
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
  findSwingHigh,
  findSwingLow,
  buildDecision,
  validateIndicators,
  priceAboveEma,
  priceBelowEma,
} from '../utils';

const CONFIG = {
  oversoldLevel: -100,
  overboughtLevel: 100,
  extremeOversold: -150,
  extremeOverbought: 150,
  lookback: 10,
  useTrendFilter: true,
  atrMultiplier: 1.2,
  swingLookback: 10,
  minRR: 2.0,
};

export class CciZeroLineIntraday implements IStrategy {
  meta: StrategyMeta = {
    id: 'cci-zero',
    name: 'CCI Zero-Line Cross',
    description: 'CCI crossing zero line with momentum from extremes',
    style: 'intraday',
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'cci', 'ema200', 'atr'],
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    if (!validateIndicators(data, this.meta.requiredIndicators, 30)) return null;

    const { bars, cci, ema200, atr } = data;
    const symbol = data.symbol;
    
    const currentBar = bars[bars.length - 1];
    const price = currentBar.close;
    
    const currentCci = latest(cci)!;
    const prevCci = previous(cci, 1)!;
    const cciHistory = lastN(cci, CONFIG.lookback);
    const currentAtr = latest(atr)!;

    const triggers: string[] = [];
    const warnings: string[] = [];
    let confidence = 0;

    // ════════════════════════════════════════════════════════════
    // STEP 1: CHECK CCI ZERO-LINE CROSS
    // ════════════════════════════════════════════════════════════
    
    let direction: 'long' | 'short' | null = null;
    
    // Bullish: CCI crosses above 0
    const bullishCross = prevCci < 0 && currentCci > 0;
    
    // Bearish: CCI crosses below 0
    const bearishCross = prevCci > 0 && currentCci < 0;
    
    if (!bullishCross && !bearishCross) return null;

    // ════════════════════════════════════════════════════════════
    // STEP 2: CHECK IF CAME FROM EXTREME
    // ════════════════════════════════════════════════════════════
    
    const lowestCci = Math.min(...cciHistory);
    const highestCci = Math.max(...cciHistory);
    
    if (bullishCross) {
      direction = 'long';
      triggers.push(`CCI crossed above zero (${prevCci.toFixed(0)} → ${currentCci.toFixed(0)})`);
      
      if (lowestCci < CONFIG.extremeOversold) {
        triggers.push(`Came from extreme oversold (low: ${lowestCci.toFixed(0)})`);
        confidence += 40;
      } else if (lowestCci < CONFIG.oversoldLevel) {
        triggers.push(`Came from oversold territory (low: ${lowestCci.toFixed(0)})`);
        confidence += 30;
      } else {
        triggers.push('Zero-line cross from neutral');
        confidence += 20;
      }
    } else {
      direction = 'short';
      triggers.push(`CCI crossed below zero (${prevCci.toFixed(0)} → ${currentCci.toFixed(0)})`);
      
      if (highestCci > CONFIG.extremeOverbought) {
        triggers.push(`Came from extreme overbought (high: ${highestCci.toFixed(0)})`);
        confidence += 40;
      } else if (highestCci > CONFIG.overboughtLevel) {
        triggers.push(`Came from overbought territory (high: ${highestCci.toFixed(0)})`);
        confidence += 30;
      } else {
        triggers.push('Zero-line cross from neutral');
        confidence += 20;
      }
    }

    // ════════════════════════════════════════════════════════════
    // STEP 3: TREND FILTER (EMA200)
    // ════════════════════════════════════════════════════════════
    
    if (CONFIG.useTrendFilter && ema200) {
      const withTrend = (direction === 'long' && priceAboveEma(bars, ema200)) ||
                        (direction === 'short' && priceBelowEma(bars, ema200));
      
      if (withTrend) {
        triggers.push('Aligned with EMA200 trend');
        confidence += 15;
      } else {
        warnings.push('Counter-trend signal');
        confidence += 5;
      }
    }

    // ════════════════════════════════════════════════════════════
    // STEP 4: CCI MOMENTUM
    // ════════════════════════════════════════════════════════════
    
    const cciMomentum = Math.abs(currentCci - prevCci);
    
    if (cciMomentum >= 30) {
      triggers.push(`Strong CCI momentum: ${cciMomentum.toFixed(0)} points`);
      confidence += 15;
    } else if (cciMomentum >= 15) {
      triggers.push('CCI momentum confirmed');
      confidence += 10;
    } else {
      warnings.push('Weak CCI momentum');
    }

    // ════════════════════════════════════════════════════════════
    // STEP 5: CANDLE CONFIRMATION
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
      ? `CCI crossed above zero from ${lowestCci < CONFIG.oversoldLevel ? 'oversold' : 'negative'} territory`
      : `CCI crossed below zero from ${highestCci > CONFIG.overboughtLevel ? 'overbought' : 'positive'} territory`;

    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice: price,
      stopLossPrice, takeProfitPrice, reason, triggers, warnings, settings,
    });
  }
}

export const cciZeroLineIntraday = new CciZeroLineIntraday();

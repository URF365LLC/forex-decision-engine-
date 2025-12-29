/**
 * Triple EMA Crossover Strategy
 * Win Rate: 56% | Avg RR: 2.0
 * 
 * Logic: EMA8/21/55 alignment with pullback entry
 * Computes EMAs locally from bars
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, Bar } from '../types.js';
import { atIndex, validateOrder, buildDecision, clamp, normalizedSlope } from '../utils.js';

function computeEMA(bars: Bar[], period: number): number[] {
  const result: number[] = [];
  if (bars.length < period) return result;
  
  const multiplier = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((sum, b) => sum + b.close, 0) / period;
  
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      result.push(0);
    } else if (i === period - 1) {
      result.push(ema);
    } else {
      ema = (bars[i].close - ema) * multiplier + ema;
      result.push(ema);
    }
  }
  return result;
}

export class TripleEma implements IStrategy {
  meta: StrategyMeta = {
    id: 'triple-ema',
    name: 'Triple EMA Crossover',
    description: 'EMA8/21/55 alignment with pullback entry',
    style: 'intraday',
    winRate: 56,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'atr'],
    version: '2025-12-29',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, atr } = data;
    
    if (!bars || bars.length < 55) return null;
    if (!atr || atr.length < 50) return null;
    
    const ema8 = computeEMA(bars, 8);
    const ema21 = computeEMA(bars, 21);
    const ema55 = computeEMA(bars, 55);
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const ema8Signal = atIndex(ema8, signalIdx);
    const ema21Signal = atIndex(ema21, signalIdx);
    const ema55Signal = atIndex(ema55, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    
    if (!ema8Signal || !ema21Signal || !ema55Signal || !atrSignal) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    const bullishStack = ema8Signal > ema21Signal && ema21Signal > ema55Signal;
    const bearishStack = ema8Signal < ema21Signal && ema21Signal < ema55Signal;
    
    if (bullishStack && signalBar.low <= ema21Signal && signalBar.close > ema21Signal) {
      direction = 'long';
      confidence += 30;
      triggers.push('EMA8 > EMA21 > EMA55 (bullish stack)');
      reasonCodes.push('EMA_BULLISH_STACK');
      triggers.push('Price pulled back to EMA21 and closed above');
      reasonCodes.push('EMA_PULLBACK');
      
      const slope = normalizedSlope(ema21, 5);
      if (slope > 0.0001) {
        confidence += 15;
        triggers.push('EMA21 sloping upward');
        reasonCodes.push('TREND_ALIGNED');
      }
      
      if (signalBar.close > signalBar.open) {
        confidence += 10;
        triggers.push('Bullish candle confirmation');
      }
      
    } else if (bearishStack && signalBar.high >= ema21Signal && signalBar.close < ema21Signal) {
      direction = 'short';
      confidence += 30;
      triggers.push('EMA8 < EMA21 < EMA55 (bearish stack)');
      reasonCodes.push('EMA_BEARISH_STACK');
      triggers.push('Price pulled back to EMA21 and closed below');
      reasonCodes.push('EMA_PULLBACK');
      
      const slope = normalizedSlope(ema21, 5);
      if (slope < -0.0001) {
        confidence += 15;
        triggers.push('EMA21 sloping downward');
        reasonCodes.push('TREND_ALIGNED');
      }
      
      if (signalBar.close < signalBar.open) {
        confidence += 10;
        triggers.push('Bearish candle confirmation');
      }
    }
    
    if (!direction) return null;
    
    const entryPrice = entryBar.open;
    const atrValue = atrSignal;
    
    const stopLossPrice = direction === 'long' 
      ? Math.min(signalBar.low, ema55Signal) - (atrValue * 0.5)
      : Math.max(signalBar.high, ema55Signal) + (atrValue * 0.5);
    
    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long'
      ? entryPrice + (riskAmount * 2)
      : entryPrice - (riskAmount * 2);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) {
      return null;
    }
    
    reasonCodes.push('RR_FAVORABLE');
    confidence += 15;
    
    confidence = clamp(confidence, 0, 100);
    
    return buildDecision({
      symbol,
      strategyId: this.meta.id,
      strategyName: this.meta.name,
      direction,
      confidence,
      entryPrice,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      triggers,
      reasonCodes,
      settings,
    });
  }
}

/**
 * Williams %R + EMA Strategy
 * Win Rate: 58% | Avg RR: 1.5
 * 
 * Logic: Williams %R extremes with EMA trend filter
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp } from '../utils.js';

export class WilliamsEma implements IStrategy {
  meta: StrategyMeta = {
    id: 'williams-ema',
    name: 'Williams %R + EMA',
    description: 'Williams %R extremes with EMA trend filter',
    style: 'intraday',
    winRate: 58,
    avgRR: 1.5,
    signalsPerWeek: '15-20',
    requiredIndicators: ['bars', 'willr', 'ema50', 'atr'],
    version: '2025-12-29',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, willr, ema50, atr } = data;
    
    if (!bars || bars.length < 50) return null;
    if (!validateIndicators(data as Record<string, unknown>, this.meta.requiredIndicators, 50)) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const prevIdx = bars.length - 3;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const willrSignal = atIndex(willr, signalIdx);
    const willrPrev = atIndex(willr, prevIdx);
    const emaSignal = atIndex(ema50, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    
    if (!willrSignal || !willrPrev || !emaSignal || !atrSignal) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    if (willrSignal < -80 && willrPrev < -80 && willrSignal > willrPrev) {
      direction = 'long';
      confidence += 30;
      triggers.push(`Williams %R oversold at ${willrSignal.toFixed(1)}`);
      reasonCodes.push('WILLR_OVERSOLD');
      triggers.push('Williams %R turning up from extreme');
      
      if (signalBar.close > emaSignal) {
        confidence += 20;
        triggers.push('Price above EMA50 (uptrend)');
        reasonCodes.push('TREND_ALIGNED');
      } else {
        confidence -= 10;
        reasonCodes.push('TREND_COUNTER');
      }
      
      if (willrSignal < -90) {
        confidence += 10;
        triggers.push('Williams %R extremely oversold');
      }
      
      if (signalBar.close > signalBar.open) {
        confidence += 10;
        triggers.push('Bullish candle confirmation');
      }
      
    } else if (willrSignal > -20 && willrPrev > -20 && willrSignal < willrPrev) {
      direction = 'short';
      confidence += 30;
      triggers.push(`Williams %R overbought at ${willrSignal.toFixed(1)}`);
      reasonCodes.push('WILLR_OVERBOUGHT');
      triggers.push('Williams %R turning down from extreme');
      
      if (signalBar.close < emaSignal) {
        confidence += 20;
        triggers.push('Price below EMA50 (downtrend)');
        reasonCodes.push('TREND_ALIGNED');
      } else {
        confidence -= 10;
        reasonCodes.push('TREND_COUNTER');
      }
      
      if (willrSignal > -10) {
        confidence += 10;
        triggers.push('Williams %R extremely overbought');
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
      ? entryPrice - (atrValue * 1.5)
      : entryPrice + (atrValue * 1.5);
    
    const takeProfitPrice = direction === 'long'
      ? entryPrice + (atrValue * 2.5)
      : entryPrice - (atrValue * 2.5);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) {
      return null;
    }
    
    const rr = Math.abs(takeProfitPrice - entryPrice) / Math.abs(entryPrice - stopLossPrice);
    if (rr >= 1.5) {
      confidence += 10;
      reasonCodes.push('RR_FAVORABLE');
    }
    
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

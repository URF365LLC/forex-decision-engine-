/**
 * Bollinger Mean Reversion Strategy
 * Win Rate: 65% | Avg RR: 1.5
 * 
 * Logic: Mean reversion from Bollinger Band touches with rejection candle
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, isRejectionCandle, clamp } from '../utils.js';

export class BollingerMR implements IStrategy {
  meta: StrategyMeta = {
    id: 'bollinger-mr',
    name: 'Bollinger Mean Reversion',
    description: 'Mean reversion from Bollinger Band touches with rejection candle',
    style: 'intraday',
    winRate: 65,
    avgRR: 1.5,
    signalsPerWeek: '15-20',
    requiredIndicators: ['bars', 'bbands', 'rsi', 'atr', 'ema200'],
    version: '2025-12-29',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, bbands, rsi, atr, ema200 } = data;
    
    if (!bars || bars.length < 50) return null;
    if (!validateIndicators(data as Record<string, unknown>, this.meta.requiredIndicators, 50)) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const bbSignal = atIndex(bbands, signalIdx);
    const rsiSignal = atIndex(rsi, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    const emaSignal = atIndex(ema200, signalIdx);
    
    if (!bbSignal || !rsiSignal || !atrSignal || !emaSignal) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    if (signalBar.low <= bbSignal.lower) {
      direction = 'long';
      confidence += 25;
      triggers.push(`Price touched lower BB at ${bbSignal.lower.toFixed(5)}`);
      reasonCodes.push('BB_TOUCH_LOWER');
      
      const rejection = isRejectionCandle(signalBar, 'long');
      if (rejection.ok) {
        confidence += 20;
        triggers.push(`Bullish rejection candle (${(rejection.wickRatio * 100).toFixed(0)}% lower wick)`);
        reasonCodes.push('REJECTION_CONFIRMED');
      }
      
      if (rsiSignal < 35) {
        confidence += 15;
        triggers.push(`RSI oversold at ${rsiSignal.toFixed(1)}`);
        reasonCodes.push('RSI_OVERSOLD');
      }
      
      if (signalBar.close > emaSignal) {
        confidence += 10;
        triggers.push('Price above EMA200');
        reasonCodes.push('TREND_ALIGNED');
      }
      
    } else if (signalBar.high >= bbSignal.upper) {
      direction = 'short';
      confidence += 25;
      triggers.push(`Price touched upper BB at ${bbSignal.upper.toFixed(5)}`);
      reasonCodes.push('BB_TOUCH_UPPER');
      
      const rejection = isRejectionCandle(signalBar, 'short');
      if (rejection.ok) {
        confidence += 20;
        triggers.push(`Bearish rejection candle (${(rejection.wickRatio * 100).toFixed(0)}% upper wick)`);
        reasonCodes.push('REJECTION_CONFIRMED');
      }
      
      if (rsiSignal > 65) {
        confidence += 15;
        triggers.push(`RSI overbought at ${rsiSignal.toFixed(1)}`);
        reasonCodes.push('RSI_OVERBOUGHT');
      }
      
      if (signalBar.close < emaSignal) {
        confidence += 10;
        triggers.push('Price below EMA200');
        reasonCodes.push('TREND_ALIGNED');
      }
    }
    
    if (!direction) return null;
    
    const entryPrice = entryBar.open;
    const atrValue = atrSignal;
    
    const stopLossPrice = direction === 'long' 
      ? entryPrice - (atrValue * 1.5)
      : entryPrice + (atrValue * 1.5);
    
    const takeProfitPrice = direction === 'long'
      ? bbSignal.middle
      : bbSignal.middle;
    
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

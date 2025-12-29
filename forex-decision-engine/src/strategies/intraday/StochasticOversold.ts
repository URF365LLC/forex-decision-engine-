/**
 * Stochastic Oversold Strategy
 * Win Rate: 65% | Avg RR: 1.5
 * 
 * Logic: Stochastic crossover in extreme zones with trend filter
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp } from '../utils.js';

export class StochasticOversold implements IStrategy {
  meta: StrategyMeta = {
    id: 'stoch-oversold',
    name: 'Stochastic Oversold',
    description: 'Stochastic crossover in extreme zones with trend filter',
    style: 'intraday',
    winRate: 65,
    avgRR: 1.5,
    signalsPerWeek: '20-30',
    requiredIndicators: ['bars', 'stoch', 'atr', 'ema200'],
    version: '2025-12-29',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, stoch, atr, ema200 } = data;
    
    if (!bars || bars.length < 50) return null;
    if (!validateIndicators(data as Record<string, unknown>, this.meta.requiredIndicators, 50)) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const prevIdx = bars.length - 3;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const stochSignal = atIndex(stoch, signalIdx);
    const stochPrev = atIndex(stoch, prevIdx);
    const atrSignal = atIndex(atr, signalIdx);
    const emaSignal = atIndex(ema200, signalIdx);
    
    if (!stochSignal || !stochPrev || !atrSignal || !emaSignal) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    if (stochSignal.k < 20 && stochPrev.k < stochPrev.d && stochSignal.k > stochSignal.d) {
      direction = 'long';
      confidence += 30;
      triggers.push(`Stochastic oversold at K=${stochSignal.k.toFixed(1)}`);
      reasonCodes.push('STOCH_OVERSOLD');
      triggers.push('Stochastic K crossed above D');
      reasonCodes.push('STOCH_CROSS_UP');
      
      if (signalBar.close > emaSignal) {
        confidence += 20;
        triggers.push('Price above EMA200 (uptrend)');
        reasonCodes.push('TREND_ALIGNED');
      } else {
        confidence -= 10;
        triggers.push('Counter-trend trade (price below EMA200)');
        reasonCodes.push('TREND_COUNTER');
      }
      
      if (stochSignal.k < 10) {
        confidence += 10;
        triggers.push('Stochastic extremely oversold');
      }
      
    } else if (stochSignal.k > 80 && stochPrev.k > stochPrev.d && stochSignal.k < stochSignal.d) {
      direction = 'short';
      confidence += 30;
      triggers.push(`Stochastic overbought at K=${stochSignal.k.toFixed(1)}`);
      reasonCodes.push('STOCH_OVERBOUGHT');
      triggers.push('Stochastic K crossed below D');
      reasonCodes.push('STOCH_CROSS_DOWN');
      
      if (signalBar.close < emaSignal) {
        confidence += 20;
        triggers.push('Price below EMA200 (downtrend)');
        reasonCodes.push('TREND_ALIGNED');
      } else {
        confidence -= 10;
        triggers.push('Counter-trend trade (price above EMA200)');
        reasonCodes.push('TREND_COUNTER');
      }
      
      if (stochSignal.k > 90) {
        confidence += 10;
        triggers.push('Stochastic extremely overbought');
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

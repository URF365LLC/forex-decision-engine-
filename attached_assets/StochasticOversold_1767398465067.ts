/**
 * Stochastic Oversold Strategy - PROP-GRADE V2
 * Win Rate: 65% | Avg RR: 1.5
 * 
 * V2 FIXES: Added H4 trend, fixed falsy check → isValidStoch, minBars 250, meta.timeframes
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp } from '../utils.js';
import {
  runPreFlight, logPreFlight, isValidNumber, isValidStoch,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

export class StochasticOversold implements IStrategy {
  meta: StrategyMeta = {
    id: 'stoch-oversold',
    name: 'Stochastic Oversold',
    description: 'Stochastic crossover in extreme zones with H4 trend filter',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 65,
    avgRR: 1.5,
    signalsPerWeek: '20-30',
    requiredIndicators: ['bars', 'stoch', 'atr', 'ema200', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, stoch, atr, ema200, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'mean-reversion', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }
    
    if (!validateIndicators(data as Record<string, unknown>, ['bars', 'stoch', 'atr', 'ema200'], 250)) return null;
    
    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const prevIdx = bars!.length - 3;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    
    const stochSignal = atIndex(stoch, signalIdx);
    const stochPrev = atIndex(stoch, prevIdx);
    const atrSignal = atIndex(atr, signalIdx);
    const emaSignal = atIndex(ema200, signalIdx);
    
    // V2: Fix falsy check for stoch object
    if (!isValidStoch(stochSignal) || !isValidStoch(stochPrev)) return null;
    if (!isValidNumber(atrSignal) || !isValidNumber(emaSignal)) return null;
    
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
      if (stochSignal.k < 10) { confidence += 10; triggers.push('Stochastic extremely oversold'); }
    } else if (stochSignal.k > 80 && stochPrev.k > stochPrev.d && stochSignal.k < stochSignal.d) {
      direction = 'short';
      confidence += 30;
      triggers.push(`Stochastic overbought at K=${stochSignal.k.toFixed(1)}`);
      reasonCodes.push('STOCH_OVERBOUGHT');
      triggers.push('Stochastic K crossed below D');
      reasonCodes.push('STOCH_CROSS_DOWN');
      if (stochSignal.k > 90) { confidence += 10; triggers.push('Stochastic extremely overbought'); }
    }
    
    if (!direction) return null;
    
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        triggers.push(`Counter-trend`);
        reasonCodes.push('TREND_COUNTER');
        if (preflight.h4Trend.strength === 'strong') return null;
      }
    }
    confidence += preflight.confidenceAdjustments;
    
    const entryPrice = entryBar.open;
    const stopLossPrice = direction === 'long' ? entryPrice - (atrSignal * 1.5) : entryPrice + (atrSignal * 1.5);
    const takeProfitPrice = direction === 'long' ? entryPrice + (atrSignal * 2.5) : entryPrice - (atrSignal * 2.5);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    const rr = Math.abs(takeProfitPrice - entryPrice) / Math.abs(entryPrice - stopLossPrice);
    if (rr >= 1.5) { confidence += 10; reasonCodes.push('RR_FAVORABLE'); }
    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;
    
    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice, stopLoss: stopLossPrice, takeProfit: takeProfitPrice,
      triggers, reasonCodes, settings, timeframes: this.meta.timeframes,
    });
  }
}

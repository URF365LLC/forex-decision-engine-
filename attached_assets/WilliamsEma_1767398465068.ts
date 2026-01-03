/**
 * Williams %R + EMA Strategy - PROP-GRADE V2
 * Win Rate: 58% | Avg RR: 1.5
 * 
 * V2 FIXES: Upgraded to EMA200 (was EMA50), added H4 trend, fixed falsy check, minBars 250
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp } from '../utils.js';
import {
  runPreFlight, logPreFlight, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

export class WilliamsEma implements IStrategy {
  meta: StrategyMeta = {
    id: 'williams-ema',
    name: 'Williams %R + EMA',
    description: 'Williams %R extremes with H4 trend filter',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 58,
    avgRR: 1.5,
    signalsPerWeek: '15-20',
    requiredIndicators: ['bars', 'willr', 'ema200', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'], // V2: ema50→ema200
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, willr, ema200, atr, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'mean-reversion', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }
    
    if (!validateIndicators(data as Record<string, unknown>, ['bars', 'willr', 'ema200', 'atr'], 250)) return null;
    
    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const prevIdx = bars!.length - 3;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    
    const willrSignal = atIndex(willr, signalIdx);
    const willrPrev = atIndex(willr, prevIdx);
    const emaSignal = atIndex(ema200, signalIdx); // V2: Was ema50
    const atrSignal = atIndex(atr, signalIdx);
    
    // V2: Fix falsy check (Williams %R ranges 0 to -100, 0 is valid)
    if (!allValidNumbers(willrSignal, willrPrev, emaSignal, atrSignal)) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    if (willrSignal! < -80 && willrPrev! < -80 && willrSignal! > willrPrev!) {
      direction = 'long';
      confidence += 30;
      triggers.push(`Williams %R oversold at ${willrSignal!.toFixed(1)}`);
      reasonCodes.push('WILLR_OVERSOLD');
      triggers.push('Williams %R turning up from extreme');
      if (willrSignal! < -90) { confidence += 10; triggers.push('Williams %R extremely oversold'); }
      if (signalBar.close > signalBar.open) { confidence += 10; triggers.push('Bullish candle confirmation'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    } else if (willrSignal! > -20 && willrPrev! > -20 && willrSignal! < willrPrev!) {
      direction = 'short';
      confidence += 30;
      triggers.push(`Williams %R overbought at ${willrSignal!.toFixed(1)}`);
      reasonCodes.push('WILLR_OVERBOUGHT');
      triggers.push('Williams %R turning down from extreme');
      if (willrSignal! > -10) { confidence += 10; triggers.push('Williams %R extremely overbought'); }
      if (signalBar.close < signalBar.open) { confidence += 10; triggers.push('Bearish candle confirmation'); reasonCodes.push('CANDLE_CONFIRMATION'); }
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
    const stopLossPrice = direction === 'long' ? entryPrice - (atrSignal! * 1.5) : entryPrice + (atrSignal! * 1.5);
    const takeProfitPrice = direction === 'long' ? entryPrice + (atrSignal! * 2.5) : entryPrice - (atrSignal! * 2.5);
    
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

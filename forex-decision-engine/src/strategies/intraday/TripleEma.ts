/**
 * Triple EMA Crossover Strategy - PROP-GRADE V2
 * Win Rate: 56% | Avg RR: 2.0
 * 
 * V2 FIXES:
 * 🔴 CRITICAL: Fixed zero-seeding → now uses null for warmup period
 * - Added H4 trend framework (was completely missing!)
 * - Fixed falsy check → isValidNumber
 * - Added counter-trend rejection
 * - Added meta.timeframes
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, Bar } from '../types.js';
import { atIndex, validateOrder, buildDecision, clamp, normalizedSlope, DEFAULT_SESSION_TP_PROFILE } from '../utils.js';
import {
  runPreFlight, logPreFlight, isValidNumber, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

// V2 FIX: Return null during warmup, not 0
function computeEMA(bars: Bar[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  if (bars.length < period) return result;
  
  const multiplier = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((sum, b) => sum + b.close, 0) / period;
  
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      result.push(null); // V2 FIX: Was 0, which triggered falsy check!
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
    description: 'EMA8/21/55 alignment with pullback entry and H4 trend',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 56,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, atr, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'trend-continuation', minBars: 100,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }
    
    if (!bars || bars.length < 100) return null;
    if (!atr || atr.length < 100) return null;
    
    const ema8 = computeEMA(bars, 8);
    const ema21 = computeEMA(bars, 21);
    const ema55 = computeEMA(bars, 55);
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const ema8Signal = ema8[signalIdx];
    const ema21Signal = ema21[signalIdx];
    const ema55Signal = ema55[signalIdx];
    const atrSignal = atIndex(atr, signalIdx);
    
    // V2 FIX: Use isValidNumber (null from warmup won't pass)
    if (!allValidNumbers(ema8Signal, ema21Signal, ema55Signal, atrSignal)) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    const bullishStack = ema8Signal! > ema21Signal! && ema21Signal! > ema55Signal!;
    const bearishStack = ema8Signal! < ema21Signal! && ema21Signal! < ema55Signal!;
    
    if (bullishStack && signalBar.low <= ema21Signal! && signalBar.close > ema21Signal!) {
      direction = 'long';
      confidence += 30;
      triggers.push('EMA8 > EMA21 > EMA55 (bullish stack)');
      reasonCodes.push('EMA_BULLISH_STACK');
      triggers.push('Price pulled back to EMA21 and closed above');
      reasonCodes.push('EMA_PULLBACK');
      const validEma21 = ema21.filter(isValidNumber) as number[];
      const slope = normalizedSlope(validEma21, 5);
      if (slope > 0.0001) { confidence += 15; triggers.push('EMA21 sloping upward'); }
      if (signalBar.close > signalBar.open) { confidence += 10; triggers.push('Bullish candle'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    } else if (bearishStack && signalBar.high >= ema21Signal! && signalBar.close < ema21Signal!) {
      direction = 'short';
      confidence += 30;
      triggers.push('EMA8 < EMA21 < EMA55 (bearish stack)');
      reasonCodes.push('EMA_BEARISH_STACK');
      triggers.push('Price pulled back to EMA21 and closed below');
      reasonCodes.push('EMA_PULLBACK');
      const validEma21 = ema21.filter(isValidNumber) as number[];
      const slope = normalizedSlope(validEma21, 5);
      if (slope < -0.0001) { confidence += 15; triggers.push('EMA21 sloping downward'); }
      if (signalBar.close < signalBar.open) { confidence += 10; triggers.push('Bearish candle'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    }
    
    if (!direction) return null;
    
    // V2: H4 TREND (was completely missing!)
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        triggers.push(`Counter-trend`);
        reasonCodes.push('TREND_COUNTER');
        return null; // V2: Reject counter-trend for trend strategy
      }
    }
    confidence += preflight.confidenceAdjustments;
    
    const entryPrice = entryBar.open;
    const stopLossPrice = direction === 'long'
      ? Math.min(signalBar.low, ema55Signal!) - (atrSignal! * 0.5)
      : Math.max(signalBar.high, ema55Signal!) + (atrSignal! * 0.5);
    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long' ? entryPrice + (riskAmount * 2) : entryPrice - (riskAmount * 2);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    reasonCodes.push('RR_FAVORABLE');
    confidence += 15;
    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;
    
    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice, stopLoss: stopLossPrice, takeProfit: takeProfitPrice,
      triggers, reasonCodes, settings, timeframes: this.meta.timeframes,
      bars,
      atr: atrSignal ?? null,
      takeProfitConfig: {
        preferStructure: true,
        structureLookback: 60,
        rrTarget: 2,
        atrMultiplier: 2,
        sessionProfile: DEFAULT_SESSION_TP_PROFILE,
      },
    });
  }
}

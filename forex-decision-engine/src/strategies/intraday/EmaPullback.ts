/**
 * EMA Pullback Strategy - PROP-GRADE V2
 * Win Rate: 50% | Avg RR: 2.0
 * 
 * V2 FIXES: Added H4 trend (was claiming but not using), fixed falsy checks,
 *           ADX now a gate (was bonus), increased minBars to 250, counter-trend rejection
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, normalizedSlope, clamp, DEFAULT_SESSION_TP_PROFILE } from '../utils.js';
import {
  runPreFlight, logPreFlight, allValidNumbers, isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

export class EmaPullback implements IStrategy {
  meta: StrategyMeta = {
    id: 'ema-pullback-intra',
    name: 'EMA Pullback',
    description: 'Trend continuation on EMA 20/50 pullback with H4 trend and ADX filter',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 50,
    avgRR: 2.0,
    signalsPerWeek: '8-15',
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, ema20, ema50, ema200, rsi, adx, atr, trendBarsH4, ema200H4, adxH4 } = data;
    
    // V2: PRE-FLIGHT
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'trend-continuation', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }
    
    if (!validateIndicators(data as unknown as Record<string, unknown>, ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'], 250)) return null;
    
    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    
    const ema20Signal = atIndex(ema20, signalIdx);
    const ema50Signal = atIndex(ema50, signalIdx);
    const ema200Signal = atIndex(ema200, signalIdx);
    const rsiSignal = atIndex(rsi, signalIdx);
    const adxSignal = atIndex(adx, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    
    // V2: Fix falsy check
    if (!allValidNumbers(ema20Signal, ema50Signal, ema200Signal, rsiSignal, adxSignal, atrSignal)) return null;
    
    // V2: ADX as gate (was just bonus)
    if (adxSignal! < 20) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    const bullishTrend = signalBar.close > ema200Signal! && ema20Signal! > ema50Signal!;
    const bearishTrend = signalBar.close < ema200Signal! && ema20Signal! < ema50Signal!;
    const emaZoneHigh = Math.max(ema20Signal!, ema50Signal!);
    const emaZoneLow = Math.min(ema20Signal!, ema50Signal!);
    const inPullbackZone = signalBar.low <= emaZoneHigh && signalBar.high >= emaZoneLow;
    
    if (bullishTrend && inPullbackZone && signalBar.close > ema20Signal!) {
      direction = 'long';
      confidence += 25;
      triggers.push('Price above EMA200 (uptrend)');
      triggers.push('EMA20 > EMA50 (bullish structure)');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');
      confidence += 15;
      triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      if (rsiSignal! >= 40 && rsiSignal! <= 60) { confidence += 10; triggers.push(`RSI reset to neutral (${rsiSignal!.toFixed(1)})`); }
      const slope = normalizedSlope(ema200!, 10);
      if (slope > 0.00005) { confidence += 10; triggers.push('EMA200 sloping upward'); }
      if (signalBar.close > signalBar.open) { confidence += 10; triggers.push('Bullish candle confirmation'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    } else if (bearishTrend && inPullbackZone && signalBar.close < ema20Signal!) {
      direction = 'short';
      confidence += 25;
      triggers.push('Price below EMA200 (downtrend)');
      triggers.push('EMA20 < EMA50 (bearish structure)');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');
      confidence += 15;
      triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      if (rsiSignal! >= 40 && rsiSignal! <= 60) { confidence += 10; triggers.push(`RSI reset to neutral (${rsiSignal!.toFixed(1)})`); }
      const slope = normalizedSlope(ema200!, 10);
      if (slope < -0.00005) { confidence += 10; triggers.push('EMA200 sloping downward'); }
      if (signalBar.close < signalBar.open) { confidence += 10; triggers.push('Bearish candle confirmation'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    }
    
    if (!direction) return null;
    
    // V2: H4 TREND (reject counter-trend for trend strategy)
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned (${preflight.h4Trend.direction})`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        return null; // V2: Reject counter-trend for trend-continuation strategy
      }
    }
    confidence += preflight.confidenceAdjustments;
    
    const entryPrice = entryBar.open;
    const stopLossPrice = direction === 'long' ? emaZoneLow - (atrSignal! * 0.5) : emaZoneHigh + (atrSignal! * 0.5);
    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long' ? entryPrice + (riskAmount * 2) : entryPrice - (riskAmount * 2);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    reasonCodes.push('RR_FAVORABLE');
    confidence += 10;
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

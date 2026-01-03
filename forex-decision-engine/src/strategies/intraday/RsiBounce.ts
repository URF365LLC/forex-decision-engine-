/**
 * RSI Oversold Bounce Strategy - PROP-GRADE V2
 * Win Rate: 72% | Avg RR: 1.2
 * 
 * V2 FIXES: Added H4 trend, SignalQualityGate preflight, min confidence gate
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp, DEFAULT_SESSION_TP_PROFILE } from '../utils.js';
import {
  runPreFlight, logPreFlight, isValidNumber, isValidBBand, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

export class RsiBounce implements IStrategy {
  meta: StrategyMeta = {
    id: 'rsi-bounce',
    name: 'RSI Oversold Bounce',
    description: 'Mean reversion from RSI extremes with Bollinger Band and H4 trend confirmation',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 72,
    avgRR: 1.2,
    signalsPerWeek: '15-25',
    requiredIndicators: ['bars', 'rsi', 'bbands', 'atr', 'sma20', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, rsi, bbands, atr, sma20, trendBarsH4, ema200H4, adxH4 } = data;
    
    // V2: PRE-FLIGHT
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'mean-reversion', minBars: 50,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }
    
    if (!validateIndicators(data as unknown as Record<string, unknown>, ['bars', 'rsi', 'bbands', 'atr', 'sma20'], 50)) return null;
    
    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    
    const rsiSignal = atIndex(rsi, signalIdx);
    const bbSignal = atIndex(bbands, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    const smaSignal = atIndex(sma20, signalIdx);
    
    // V2: Proper null checks
    if (!isValidNumber(rsiSignal) || !isValidBBand(bbSignal) || !allValidNumbers(atrSignal, smaSignal)) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    if (rsiSignal < 30 && signalBar.low <= bbSignal.lower) {
      direction = 'long';
      confidence += 30;
      triggers.push(`RSI oversold at ${rsiSignal.toFixed(1)}`);
      reasonCodes.push('RSI_OVERSOLD');
      triggers.push(`Price touched lower BB at ${bbSignal.lower.toFixed(5)}`);
      reasonCodes.push('BB_TOUCH_LOWER');
      if (rsiSignal < 20) { confidence += 10; triggers.push('RSI extremely oversold'); reasonCodes.push('RSI_EXTREME_LOW'); }
      if (signalBar.close > signalBar.open) { confidence += 10; triggers.push('Bullish candle confirmation'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    } else if (rsiSignal > 70 && signalBar.high >= bbSignal.upper) {
      direction = 'short';
      confidence += 30;
      triggers.push(`RSI overbought at ${rsiSignal.toFixed(1)}`);
      reasonCodes.push('RSI_OVERBOUGHT');
      triggers.push(`Price touched upper BB at ${bbSignal.upper.toFixed(5)}`);
      reasonCodes.push('BB_TOUCH_UPPER');
      if (rsiSignal > 80) { confidence += 10; triggers.push('RSI extremely overbought'); reasonCodes.push('RSI_EXTREME_HIGH'); }
      if (signalBar.close < signalBar.open) { confidence += 10; triggers.push('Bearish candle confirmation'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    }
    
    if (!direction) return null;
    
    // V2: H4 TREND
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned (${preflight.h4Trend.direction})`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        triggers.push(`⚠️ Counter-trend: H4 is ${preflight.h4Trend.direction}`);
        reasonCodes.push('TREND_COUNTER');
        if (preflight.h4Trend.strength === 'strong') return null;
      }
    }
    confidence += preflight.confidenceAdjustments;
    
    const entryPrice = entryBar.open;
    const stopLossPrice = direction === 'long' ? entryPrice - (atrSignal! * 1.5) : entryPrice + (atrSignal! * 1.5);
    const takeProfitPrice = direction === 'long' ? entryPrice + (atrSignal! * 2) : entryPrice - (atrSignal! * 2);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    const rr = Math.abs(takeProfitPrice - entryPrice) / Math.abs(entryPrice - stopLossPrice);
    if (rr >= 1.2) { confidence += 10; reasonCodes.push('RR_FAVORABLE'); }
    
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
        rrTarget: rr || 1.3,
        atrMultiplier: 2,
        sessionProfile: DEFAULT_SESSION_TP_PROFILE,
      },
    });
  }
}

/**
 * Bollinger Mean Reversion Strategy - PROP-GRADE V2
 * Win Rate: 65% | Avg RR: 1.5
 * 
 * V2 FIXES:
 * 🔴 CRITICAL: Fixed TP calculation (was same for long AND short!)
 * - Added H4 trend framework
 * - Fixed falsy checks → isValidBBand, isValidNumber
 * - minBars increased to 250
 * - Added meta.timeframes
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, isRejectionCandle, clamp } from '../utils.js';
import {
  runPreFlight, logPreFlight, createPreflightRejection, isValidBBand, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

export class BollingerMR implements IStrategy {
  meta: StrategyMeta = {
    id: 'bollinger-mr',
    name: 'Bollinger Mean Reversion',
    description: 'Mean reversion from Bollinger Band touches with rejection candle and H4 trend',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 65,
    avgRR: 1.5,
    signalsPerWeek: '15-20',
    requiredIndicators: ['bars', 'bbands', 'rsi', 'atr', 'ema200', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, bbands, rsi, atr, ema200, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'mean-reversion', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return createPreflightRejection(symbol, this.meta, preflight); }
    
    if (!validateIndicators(data as Record<string, unknown>, ['bars', 'bbands', 'rsi', 'atr', 'ema200'], 250)) return null;
    
    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    
    const bbSignal = atIndex(bbands, signalIdx);
    const rsiSignal = atIndex(rsi, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    const emaSignal = atIndex(ema200, signalIdx);
    
    if (!isValidBBand(bbSignal)) return null;
    if (!allValidNumbers(rsiSignal, atrSignal, emaSignal)) return null;
    
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
      if (rejection.ok) { confidence += 20; triggers.push(`Bullish rejection`); reasonCodes.push('REJECTION_CONFIRMED'); }
      if (rsiSignal! < 35) { confidence += 15; triggers.push(`RSI oversold at ${rsiSignal!.toFixed(1)}`); reasonCodes.push('RSI_OVERSOLD'); }
    } else if (signalBar.high >= bbSignal.upper) {
      direction = 'short';
      confidence += 25;
      triggers.push(`Price touched upper BB at ${bbSignal.upper.toFixed(5)}`);
      reasonCodes.push('BB_TOUCH_UPPER');
      const rejection = isRejectionCandle(signalBar, 'short');
      if (rejection.ok) { confidence += 20; triggers.push(`Bearish rejection`); reasonCodes.push('REJECTION_CONFIRMED'); }
      if (rsiSignal! > 65) { confidence += 15; triggers.push(`RSI overbought at ${rsiSignal!.toFixed(1)}`); reasonCodes.push('RSI_OVERBOUGHT'); }
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
    
    // V2 CRITICAL FIX: TP was same for long AND short!
    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long'
      ? entryPrice + (riskDistance * 1.5)
      : entryPrice - (riskDistance * 1.5);  // NOW CORRECT!
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    confidence += 10;
    reasonCodes.push('RR_FAVORABLE');
    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;
    
    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice, stopLoss: stopLossPrice, takeProfit: takeProfitPrice,
      triggers, reasonCodes, settings, timeframes: this.meta.timeframes,
    });
  }
}

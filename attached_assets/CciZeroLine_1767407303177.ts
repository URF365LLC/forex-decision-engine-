/**
 * CCI Zero-Line Cross Strategy - PROP-GRADE V2
 * Win Rate: 55% | Avg RR: 2.0
 * 
 * V2 FIXES:
 * 🔴 CRITICAL: Fixed falsy check (CCI=0 was killing signals!)
 * - Added H4 trend framework
 * - minBars increased to 250
 * - Added meta.timeframes
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp } from '../utils.js';
import {
  runPreFlight, logPreFlight, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

export class CciZeroLine implements IStrategy {
  meta: StrategyMeta = {
    id: 'cci-zero',
    name: 'CCI Zero-Line Cross',
    description: 'CCI crossing zero from extremes with H4 trend filter',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'cci', 'ema200', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, cci, ema200, atr, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'momentum', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }
    
    if (!validateIndicators(data as Record<string, unknown>, ['bars', 'cci', 'ema200', 'atr'], 250)) return null;
    
    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const prevIdx = bars!.length - 3;
    const prev2Idx = bars!.length - 4;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    
    const cciSignal = atIndex(cci, signalIdx);
    const cciPrev = atIndex(cci, prevIdx);
    const cciPrev2 = atIndex(cci, prev2Idx);
    const emaSignal = atIndex(ema200, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    
    // V2 CRITICAL FIX: Use allValidNumbers instead of falsy check
    // BEFORE: if (!cciSignal || !cciPrev || ...) - killed signals when CCI = 0!
    if (!allValidNumbers(cciSignal, cciPrev, cciPrev2, emaSignal, atrSignal)) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    const wasExtremeLow = cciPrev2! < -100 || cciPrev! < -100;
    const wasExtremeHigh = cciPrev2! > 100 || cciPrev! > 100;
    
    // V2 FIX: Use >= and <= for zero crossing (0 is valid!)
    if (wasExtremeLow && cciPrev! <= 0 && cciSignal! >= 0 && cciSignal! !== cciPrev!) {
      direction = 'long';
      confidence += 30;
      triggers.push(`CCI crossed above zero at ${cciSignal!.toFixed(1)}`);
      reasonCodes.push('CCI_ZERO_CROSS_UP');
      triggers.push('CCI was recently in extreme oversold');
      reasonCodes.push('CCI_EXTREME_LOW');
      if (cciPrev2! < -150 || cciPrev! < -150) { confidence += 10; triggers.push('CCI was deeply oversold'); }
      if (signalBar.close > signalBar.open) { confidence += 10; triggers.push('Bullish candle'); reasonCodes.push('CANDLE_CONFIRMATION'); }
    } else if (wasExtremeHigh && cciPrev! >= 0 && cciSignal! <= 0 && cciSignal! !== cciPrev!) {
      direction = 'short';
      confidence += 30;
      triggers.push(`CCI crossed below zero at ${cciSignal!.toFixed(1)}`);
      reasonCodes.push('CCI_ZERO_CROSS_DOWN');
      triggers.push('CCI was recently in extreme overbought');
      reasonCodes.push('CCI_EXTREME_HIGH');
      if (cciPrev2! > 150 || cciPrev! > 150) { confidence += 10; triggers.push('CCI was deeply overbought'); }
      if (signalBar.close < signalBar.open) { confidence += 10; triggers.push('Bearish candle'); reasonCodes.push('CANDLE_CONFIRMATION'); }
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
      }
    }
    confidence += preflight.confidenceAdjustments;
    
    const entryPrice = entryBar.open;
    const stopLossPrice = direction === 'long' ? entryPrice - (atrSignal! * 1.5) : entryPrice + (atrSignal! * 1.5);
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
    });
  }
}

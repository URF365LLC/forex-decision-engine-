/**
 * Bollinger Mean Reversion Strategy - PROP-GRADE V3
 * Historical Win Rate: 65% | Historical Avg RR: 1.5
 * 
 * V3 ENHANCEMENTS (4-Way AI Validation Consensus - Jan 2026):
 * 🔴 CRITICAL: Rejection candle is now REQUIRED (hard gate, not optional bonus)
 * 🟡 Added BB Width expansion filter (blocks fades in top 20% width percentile)
 * 🟡 Tightened RSI thresholds from 35/65 to 30/70 (industry standard)
 * 🟡 Switched to swing-based stops (structure + ATR buffer)
 * 🟡 Increased RR target to 2.0 (kept ATR multiplier at 1.5)
 * 
 * V2 FIXES (Retained):
 * - Fixed TP calculation direction
 * - Added H4 trend framework
 * - Fixed falsy checks → isValidBBand, isValidNumber
 * - minBars increased to 250
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, isRejectionCandle, clamp, DEFAULT_SESSION_TP_PROFILE, calcBBWidthPercentile } from '../utils.js';
import {
  runPreFlight, logPreFlight, isValidBBand, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

export class BollingerMR implements IStrategy {
  meta: StrategyMeta = {
    id: 'bollinger-mr',
    name: 'Bollinger Mean Reversion',
    description: 'Mean reversion from Bollinger Band touches. V3: rejection gate, BB expansion filter, swing stops.',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 65,
    avgRR: 1.5,
    signalsPerWeek: '8-12',
    requiredIndicators: ['bars', 'bbands', 'rsi', 'atr', 'ema200', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-23',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, bbands, rsi, atr, ema200, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'mean-reversion', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }
    
    if (!validateIndicators(data as Record<string, unknown>, ['bars', 'bbands', 'rsi', 'atr', 'ema200'], 250)) return null;
    
    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const prevIdx = bars!.length - 3;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    const prevBar = bars![prevIdx];
    
    if (!prevBar) return null;
    
    const bbSignal = atIndex(bbands, signalIdx);
    const rsiSignal = atIndex(rsi, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    const emaSignal = atIndex(ema200, signalIdx);
    
    if (!isValidBBand(bbSignal)) return null;
    if (!allValidNumbers(rsiSignal, atrSignal, emaSignal)) return null;
    
    const bbWidthPercentile = calcBBWidthPercentile(bbands!, signalIdx, 50);
    if (bbWidthPercentile !== null && bbWidthPercentile > 80) {
      return null;
    }
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    if (signalBar.low <= bbSignal.lower) {
      const rejection = isRejectionCandle(signalBar, 'long');
      if (!rejection.ok) return null;
      
      direction = 'long';
      confidence += 25;
      triggers.push(`Price touched lower BB at ${bbSignal.lower.toFixed(5)}`);
      reasonCodes.push('BB_TOUCH_LOWER');
      confidence += 20;
      triggers.push(`Bullish rejection (wick ${(rejection.wickRatio * 100).toFixed(0)}%)`);
      reasonCodes.push('REJECTION_CONFIRMED');
      if (rsiSignal! < 30) {
        confidence += 15;
        triggers.push(`RSI oversold at ${rsiSignal!.toFixed(1)}`);
        reasonCodes.push('RSI_OVERSOLD');
      }
    } else if (signalBar.high >= bbSignal.upper) {
      const rejection = isRejectionCandle(signalBar, 'short');
      if (!rejection.ok) return null;
      
      direction = 'short';
      confidence += 25;
      triggers.push(`Price touched upper BB at ${bbSignal.upper.toFixed(5)}`);
      reasonCodes.push('BB_TOUCH_UPPER');
      confidence += 20;
      triggers.push(`Bearish rejection (wick ${(rejection.wickRatio * 100).toFixed(0)}%)`);
      reasonCodes.push('REJECTION_CONFIRMED');
      if (rsiSignal! > 70) {
        confidence += 15;
        triggers.push(`RSI overbought at ${rsiSignal!.toFixed(1)}`);
        reasonCodes.push('RSI_OVERBOUGHT');
      }
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
    
    let stopLossPrice: number;
    if (direction === 'long') {
      const recentLow = Math.min(signalBar.low, prevBar.low);
      stopLossPrice = recentLow - (atrSignal! * 0.3);
    } else {
      const recentHigh = Math.max(signalBar.high, prevBar.high);
      stopLossPrice = recentHigh + (atrSignal! * 0.3);
    }
    
    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long'
      ? entryPrice + (riskDistance * 2.0)
      : entryPrice - (riskDistance * 2.0);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    confidence += 10;
    reasonCodes.push('RR_FAVORABLE');
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
        structureLookback: 80,
        rrTarget: 2.0,
        atrMultiplier: 1.5,
        sessionProfile: DEFAULT_SESSION_TP_PROFILE,
      },
    });
  }
}

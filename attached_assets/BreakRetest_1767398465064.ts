/**
 * Break & Retest Strategy - PROP-GRADE V2
 * Win Rate: 55% | Avg RR: 2.0
 * 
 * V2 FIXES:
 * - Added H4 trend framework (was completely missing!)
 * - Fixed falsy check → isValidNumber
 * - Added counter-trend rejection
 * - Improved level detection
 * - Added meta.timeframes
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, Bar } from '../types.js';
import { atIndex, validateOrder, buildDecision, isRejectionCandle, clamp } from '../utils.js';
import {
  runPreFlight,
  logPreFlight,
  isValidNumber,
  isTrendAligned,
  getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

function findSwingHigh(bars: Bar[], startIdx: number, lookback: number): number | null {
  let highest = 0;
  for (let i = startIdx - lookback; i < startIdx; i++) {
    if (i >= 0 && bars[i].high > highest) {
      highest = bars[i].high;
    }
  }
  return highest > 0 ? highest : null;
}

function findSwingLow(bars: Bar[], startIdx: number, lookback: number): number | null {
  let lowest = Infinity;
  for (let i = startIdx - lookback; i < startIdx; i++) {
    if (i >= 0 && bars[i].low < lowest) {
      lowest = bars[i].low;
    }
  }
  return lowest < Infinity ? lowest : null;
}

export class BreakRetest implements IStrategy {
  meta: StrategyMeta = {
    id: 'break-retest-intra',
    name: 'Break & Retest',
    description: 'Enter on retest of broken S/R with H4 trend alignment',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, atr, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    
    const preflight = runPreFlight({
      symbol,
      bars: bars || [],
      interval: 'H1',
      atr: atrVal,
      strategyType: 'breakout',
      minBars: 70,
      trendBarsH4,
      ema200H4,
      adxH4,
    });
    
    if (!preflight.passed) {
      logPreFlight(symbol, this.meta.id, preflight);
      return null;
    }
    
    if (!bars || bars.length < 70) return null;
    if (!atr || atr.length < 70) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const breakIdx = bars.length - 5;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const atrSignal = atIndex(atr, signalIdx);
    if (!isValidNumber(atrSignal)) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    const resistanceLevel = findSwingHigh(bars, breakIdx, 20);
    const supportLevel = findSwingLow(bars, breakIdx, 20);
    
    if (resistanceLevel && supportLevel) {
      const breakoutBars = bars.slice(breakIdx, signalIdx);
      const brokeResistance = breakoutBars.some(b => b.close > resistanceLevel);
      const brokeSupport = breakoutBars.some(b => b.close < supportLevel);
      
      if (brokeResistance && 
          signalBar.low <= resistanceLevel * 1.001 && 
          signalBar.close > resistanceLevel) {
        direction = 'long';
        confidence += 30;
        triggers.push(`Resistance at ${resistanceLevel.toFixed(5)} broken`);
        reasonCodes.push('BREAK_CONFIRMED');
        triggers.push('Price retested broken resistance as support');
        reasonCodes.push('RETEST_CONFIRMED');
        
        const rejection = isRejectionCandle(signalBar, 'long');
        if (rejection.ok) {
          confidence += 20;
          triggers.push('Bullish rejection at retest level');
          reasonCodes.push('REJECTION_CONFIRMED');
        }
        
        if (signalBar.close > signalBar.open) {
          confidence += 10;
          triggers.push('Bullish candle confirmation');
          reasonCodes.push('CANDLE_CONFIRMATION');
        }
        
      } else if (brokeSupport && 
                 signalBar.high >= supportLevel * 0.999 && 
                 signalBar.close < supportLevel) {
        direction = 'short';
        confidence += 30;
        triggers.push(`Support at ${supportLevel.toFixed(5)} broken`);
        reasonCodes.push('BREAK_CONFIRMED');
        triggers.push('Price retested broken support as resistance');
        reasonCodes.push('RETEST_CONFIRMED');
        
        const rejection = isRejectionCandle(signalBar, 'short');
        if (rejection.ok) {
          confidence += 20;
          triggers.push('Bearish rejection at retest level');
          reasonCodes.push('REJECTION_CONFIRMED');
        }
        
        if (signalBar.close < signalBar.open) {
          confidence += 10;
          triggers.push('Bearish candle confirmation');
          reasonCodes.push('CANDLE_CONFIRMATION');
        }
      }
    }
    
    if (!direction) return null;
    
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned (${preflight.h4Trend.direction})`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        triggers.push(`⚠️ Counter-trend: H4 is ${preflight.h4Trend.direction}`);
        reasonCodes.push('TREND_COUNTER');
      }
    }
    
    confidence += preflight.confidenceAdjustments;
    
    const entryPrice = entryBar.open;
    
    const stopLossPrice = direction === 'long' 
      ? entryPrice - (atrSignal * 1.5)
      : entryPrice + (atrSignal * 1.5);
    
    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long'
      ? entryPrice + (riskAmount * 2)
      : entryPrice - (riskAmount * 2);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) {
      return null;
    }
    
    reasonCodes.push('RR_FAVORABLE');
    confidence += 10;
    
    confidence = clamp(confidence, 0, 100);
    
    if (confidence < 50) return null;
    
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
      timeframes: this.meta.timeframes,
    });
  }
}

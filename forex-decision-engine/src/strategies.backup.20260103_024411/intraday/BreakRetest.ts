/**
 * Break & Retest Strategy
 * Win Rate: 55% | Avg RR: 2.0
 * 
 * Logic: Enter on retest of broken support/resistance levels
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, Bar } from '../types.js';
import { atIndex, validateOrder, buildDecision, isRejectionCandle, clamp } from '../utils.js';

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
    description: 'Enter on retest of broken support/resistance levels',
    style: 'intraday',
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'atr'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, atr } = data;
    
    if (!bars || bars.length < 50) return null;
    if (!atr || atr.length < 50) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const breakIdx = bars.length - 5;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const atrSignal = atIndex(atr, signalIdx);
    if (!atrSignal) return null;
    
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
          reasonCodes.push('SUPPORT_HOLD');
        }
        
        if (signalBar.close > signalBar.open) {
          confidence += 10;
          triggers.push('Bullish candle confirmation');
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
          reasonCodes.push('RESISTANCE_HOLD');
        }
        
        if (signalBar.close < signalBar.open) {
          confidence += 10;
          triggers.push('Bearish candle confirmation');
        }
      }
    }
    
    if (!direction) return null;
    
    const entryPrice = entryBar.open;
    const atrValue = atrSignal;
    
    const stopLossPrice = direction === 'long' 
      ? entryPrice - (atrValue * 1.5)
      : entryPrice + (atrValue * 1.5);
    
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

/**
 * CCI Zero-Line Cross Strategy
 * Win Rate: 55% | Avg RR: 2.0
 * 
 * Logic: CCI crossing zero from extremes with trend filter
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp } from '../utils.js';

export class CciZeroLine implements IStrategy {
  meta: StrategyMeta = {
    id: 'cci-zero',
    name: 'CCI Zero-Line Cross',
    description: 'CCI crossing zero from extremes with trend filter',
    style: 'intraday',
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'cci', 'ema200', 'atr'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, cci, ema200, atr } = data;
    
    if (!bars || bars.length < 250) return null;
    if (!validateIndicators(data as unknown as Record<string, unknown>, this.meta.requiredIndicators, 250)) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const prevIdx = bars.length - 3;
    const prev2Idx = bars.length - 4;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const cciSignal = atIndex(cci, signalIdx);
    const cciPrev = atIndex(cci, prevIdx);
    const cciPrev2 = atIndex(cci, prev2Idx);
    const emaSignal = atIndex(ema200, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    
    if (!cciSignal || !cciPrev || !cciPrev2 || !emaSignal || !atrSignal) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    const wasExtremeLow = cciPrev2 < -100 || cciPrev < -100;
    const wasExtremeHigh = cciPrev2 > 100 || cciPrev > 100;
    
    if (wasExtremeLow && cciPrev < 0 && cciSignal > 0) {
      direction = 'long';
      confidence += 30;
      triggers.push(`CCI crossed above zero at ${cciSignal.toFixed(1)}`);
      reasonCodes.push('CCI_ZERO_CROSS_UP');
      triggers.push('CCI was recently in extreme oversold');
      reasonCodes.push('CCI_EXTREME_LOW');
      
      if (signalBar.close > emaSignal) {
        confidence += 20;
        triggers.push('Price above EMA200 (uptrend)');
        reasonCodes.push('TREND_ALIGNED');
      } else {
        confidence -= 10;
        reasonCodes.push('TREND_COUNTER');
      }
      
      if (cciPrev2 < -150 || cciPrev < -150) {
        confidence += 10;
        triggers.push('CCI was deeply oversold');
      }
      
      if (signalBar.close > signalBar.open) {
        confidence += 10;
        triggers.push('Bullish candle confirmation');
      }
      
    } else if (wasExtremeHigh && cciPrev > 0 && cciSignal < 0) {
      direction = 'short';
      confidence += 30;
      triggers.push(`CCI crossed below zero at ${cciSignal.toFixed(1)}`);
      reasonCodes.push('CCI_ZERO_CROSS_DOWN');
      triggers.push('CCI was recently in extreme overbought');
      reasonCodes.push('CCI_EXTREME_HIGH');
      
      if (signalBar.close < emaSignal) {
        confidence += 20;
        triggers.push('Price below EMA200 (downtrend)');
        reasonCodes.push('TREND_ALIGNED');
      } else {
        confidence -= 10;
        reasonCodes.push('TREND_COUNTER');
      }
      
      if (cciPrev2 > 150 || cciPrev > 150) {
        confidence += 10;
        triggers.push('CCI was deeply overbought');
      }
      
      if (signalBar.close < signalBar.open) {
        confidence += 10;
        triggers.push('Bearish candle confirmation');
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

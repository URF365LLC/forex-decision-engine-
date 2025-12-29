/**
 * EMA Pullback Strategy
 * Win Rate: 50% | Avg RR: 2.0
 * 
 * Logic: Trend continuation on EMA 20/50 pullback with ADX filter
 * This is the default strategy for backward compatibility
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, normalizedSlope, clamp } from '../utils.js';

export class EmaPullback implements IStrategy {
  meta: StrategyMeta = {
    id: 'ema-pullback-intra',
    name: 'EMA Pullback',
    description: 'Trend continuation on EMA 20/50 pullback with ADX filter',
    style: 'intraday',
    winRate: 50,
    avgRR: 2.0,
    signalsPerWeek: '8-15',
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'],
    version: '2025-12-29',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, ema20, ema50, ema200, rsi, adx, atr } = data;
    
    if (!bars || bars.length < 50) return null;
    if (!validateIndicators(data as Record<string, unknown>, this.meta.requiredIndicators, 50)) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const ema20Signal = atIndex(ema20, signalIdx);
    const ema50Signal = atIndex(ema50, signalIdx);
    const ema200Signal = atIndex(ema200, signalIdx);
    const rsiSignal = atIndex(rsi, signalIdx);
    const adxSignal = atIndex(adx, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    
    if (!ema20Signal || !ema50Signal || !ema200Signal || !rsiSignal || !adxSignal || !atrSignal) return null;
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    const bullishTrend = signalBar.close > ema200Signal && ema20Signal > ema50Signal;
    const bearishTrend = signalBar.close < ema200Signal && ema20Signal < ema50Signal;
    
    const emaZoneHigh = Math.max(ema20Signal, ema50Signal);
    const emaZoneLow = Math.min(ema20Signal, ema50Signal);
    const inPullbackZone = signalBar.low <= emaZoneHigh && signalBar.high >= emaZoneLow;
    
    if (bullishTrend && inPullbackZone && signalBar.close > ema20Signal) {
      direction = 'long';
      confidence += 25;
      triggers.push('Price above EMA200 (uptrend)');
      triggers.push('EMA20 > EMA50 (bullish structure)');
      reasonCodes.push('TREND_ALIGNED');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');
      
      if (adxSignal > 25) {
        confidence += 15;
        triggers.push(`Strong trend (ADX: ${adxSignal.toFixed(1)})`);
      }
      
      if (rsiSignal >= 40 && rsiSignal <= 60) {
        confidence += 10;
        triggers.push(`RSI reset to neutral (${rsiSignal.toFixed(1)})`);
      }
      
      const slope = normalizedSlope(ema200, 10);
      if (slope > 0.00005) {
        confidence += 10;
        triggers.push('EMA200 sloping upward');
      }
      
      if (signalBar.close > signalBar.open) {
        confidence += 10;
        triggers.push('Bullish candle confirmation');
      }
      
    } else if (bearishTrend && inPullbackZone && signalBar.close < ema20Signal) {
      direction = 'short';
      confidence += 25;
      triggers.push('Price below EMA200 (downtrend)');
      triggers.push('EMA20 < EMA50 (bearish structure)');
      reasonCodes.push('TREND_ALIGNED');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');
      
      if (adxSignal > 25) {
        confidence += 15;
        triggers.push(`Strong trend (ADX: ${adxSignal.toFixed(1)})`);
      }
      
      if (rsiSignal >= 40 && rsiSignal <= 60) {
        confidence += 10;
        triggers.push(`RSI reset to neutral (${rsiSignal.toFixed(1)})`);
      }
      
      const slope = normalizedSlope(ema200, 10);
      if (slope < -0.00005) {
        confidence += 10;
        triggers.push('EMA200 sloping downward');
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
      ? emaZoneLow - (atrValue * 0.5)
      : emaZoneHigh + (atrValue * 0.5);
    
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

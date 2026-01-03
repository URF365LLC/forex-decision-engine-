/**
 * RSI Oversold Strategy - With-Trend Pullback - PROP-GRADE V2
 * Uses TRUE H4 EMA200+ADX>20 for trend confirmation
 * 
 * V2 FIXES: Added preflight, increased minBars to 250, isValidNumber checks
 * NOTE: Already had best architecture - minimal changes needed
 */

import type { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, SignalDirection, Bar } from '../types.js';
import { atIndex, validateOrder, buildDecision, clamp } from '../utils.js';
import { runPreFlight, logPreFlight, createPreflightRejection, isValidNumber } from '../SignalQualityGate.js';

const MIN_RSI_LOOKBACK = 3;
const SWING_LOOKBACK = 10;
const ATR_FALLBACK_MULT = 1.5;
const MIN_RR = 2.0;

function findSwingHighInBars(bars: Bar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  const recentBars = bars.slice(-lookback);
  let highestHigh = 0;
  for (const bar of recentBars) { if (bar.high > highestHigh) highestHigh = bar.high; }
  return highestHigh;
}

function findSwingLowInBars(bars: Bar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  const recentBars = bars.slice(-lookback);
  let lowestLow = Infinity;
  for (const bar of recentBars) { if (bar.low < lowestLow) lowestLow = bar.low; }
  return lowestLow === Infinity ? null : lowestLow;
}

export class RsiOversold implements IStrategy {
  meta: StrategyMeta = {
    id: 'rsi-oversold',
    name: 'RSI Oversold Pullback',
    description: 'With-trend pullback using H4 EMA200+ADX trend filter and RSI resets',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 62,
    avgRR: 2.0,
    signalsPerWeek: '10-20',
    requiredIndicators: ['bars', 'rsi', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, rsi, atr, trendBarsH4, ema200H4, adxH4, trendTimeframeUsed } = data;
    
    // V2: PRE-FLIGHT
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'trend-continuation', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return createPreflightRejection(symbol, this.meta, preflight); }
    
    // SEATBELT: H4 trend data check (kept from original - best practice)
    if (!trendBarsH4 || trendBarsH4.length < 50) return null;
    if (!ema200H4 || ema200H4.length === 0) return null;
    if (!adxH4 || adxH4.length === 0) return null;
    if (!bars || bars.length < 250) return null;
    if (!rsi || rsi.length < 250) return null;
    if (!atr || atr.length < 250) return null;

    const signalIdx = bars.length - 2;
    const entryIdx = bars.length - 1;
    const trendIdx = trendBarsH4.length - 1;
    
    const signalBar = bars[signalIdx];
    const entryBar = bars[entryIdx];
    
    const rsiSignal = atIndex(rsi, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    const ema200H4Val = ema200H4[trendIdx];
    const adxH4Val = adxH4[trendIdx];
    const trendBar = trendBarsH4[trendIdx];

    // V2: isValidNumber checks
    if (!isValidNumber(rsiSignal) || !isValidNumber(atrSignal) || 
        !isValidNumber(ema200H4Val) || !isValidNumber(adxH4Val)) return null;

    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: SignalDirection | null = null;

    const priceAboveEma200 = trendBar.close > ema200H4Val;
    const priceBelowEma200 = trendBar.close < ema200H4Val;
    const adxStrong = adxH4Val > 20;

    // Check 3-bar RSI lookback for recent oversold/overbought
    const rsiLookback: number[] = [];
    for (let i = 0; i < MIN_RSI_LOOKBACK; i++) {
      const val = atIndex(rsi, signalIdx - i);
      if (isValidNumber(val)) rsiLookback.push(val);
    }
    const minRsi = rsiLookback.length > 0 ? Math.min(...rsiLookback) : 100;
    const maxRsi = rsiLookback.length > 0 ? Math.max(...rsiLookback) : 0;
    
    // LONG: With uptrend only
    if (priceAboveEma200 && adxStrong && minRsi < 30) {
      direction = 'long';
      confidence += 40;
      triggers.push(`H4 trend bullish: price above EMA200 (${ema200H4Val.toFixed(5)})`);
      reasonCodes.push('TREND_ALIGNED');
      triggers.push(`H4 ADX strong at ${adxH4Val.toFixed(1)}`);
      triggers.push(`RSI recently oversold (min ${minRsi.toFixed(1)} in last 3 bars)`);
      reasonCodes.push('RSI_OVERSOLD');
      
      if (minRsi < 20) { 
        confidence += 10; 
        triggers.push('RSI extremely oversold'); 
        reasonCodes.push('RSI_EXTREME_LOW'); 
      }
      if (signalBar.close > signalBar.open) { 
        confidence += 10; 
        triggers.push('Bullish candle confirmation'); 
        reasonCodes.push('CANDLE_CONFIRMATION'); 
      }
      
    // SHORT: With downtrend only
    } else if (priceBelowEma200 && adxStrong && maxRsi > 70) {
      direction = 'short';
      confidence += 40;
      triggers.push(`H4 trend bearish: price below EMA200 (${ema200H4Val.toFixed(5)})`);
      reasonCodes.push('TREND_ALIGNED');
      triggers.push(`H4 ADX strong at ${adxH4Val.toFixed(1)}`);
      triggers.push(`RSI recently overbought (max ${maxRsi.toFixed(1)} in last 3 bars)`);
      reasonCodes.push('RSI_OVERBOUGHT');
      
      if (maxRsi > 80) { 
        confidence += 10; 
        triggers.push('RSI extremely overbought'); 
        reasonCodes.push('RSI_EXTREME_HIGH'); 
      }
      if (signalBar.close < signalBar.open) { 
        confidence += 10; 
        triggers.push('Bearish candle confirmation'); 
        reasonCodes.push('CANDLE_CONFIRMATION'); 
      }
    }
    
    if (!direction) return null;
    
    // Apply preflight adjustments
    confidence += preflight.confidenceAdjustments;
    
    // Entry and stops
    const entryPrice = entryBar.open;
    
    let stopLossPrice: number;
    if (direction === 'long') {
      const swingLow = findSwingLowInBars(bars, SWING_LOOKBACK);
      stopLossPrice = swingLow !== null && swingLow < entryPrice 
        ? swingLow 
        : entryPrice - (atrSignal * ATR_FALLBACK_MULT);
    } else {
      const swingHigh = findSwingHighInBars(bars, SWING_LOOKBACK);
      stopLossPrice = swingHigh !== null && swingHigh > entryPrice 
        ? swingHigh 
        : entryPrice + (atrSignal * ATR_FALLBACK_MULT);
    }
    
    const risk = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long' 
      ? entryPrice + (risk * MIN_RR) 
      : entryPrice - (risk * MIN_RR);
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    const rr = Math.abs(takeProfitPrice - entryPrice) / risk;
    if (rr >= MIN_RR) { 
      confidence += 10; 
      reasonCodes.push('RR_FAVORABLE'); 
    }

    if (trendTimeframeUsed === 'D1') {
      triggers.push('Note: Using D1 fallback for trend (H4 unavailable)');
    }
    
    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;
    
    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice, stopLoss: stopLossPrice, takeProfit: takeProfitPrice,
      triggers, reasonCodes, settings, timeframes: this.meta.timeframes,
    });
  }
}

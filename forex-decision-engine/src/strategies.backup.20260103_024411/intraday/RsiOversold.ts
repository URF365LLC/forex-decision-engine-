/**
 * RSI Oversold Strategy - With-Trend Pullback
 * Uses TRUE H4 EMA200+ADX>20 for trend confirmation
 * Version: 2026-01-01
 * 
 * SEATBELT 1: Fail-fast if H4 trend data is missing/invalid
 * SEATBELT 2: Separate trendIdx for H4 vs signalIdx for H1
 */

import type { 
  IStrategy, 
  StrategyMeta, 
  Decision, 
  IndicatorData,
  UserSettings, 
  ReasonCode,
  SignalDirection,
  Bar
} from '../types.js';
import { atIndex, validateOrder, buildDecision, clamp } from '../utils.js';

const MIN_RSI_LOOKBACK = 3;
const SWING_LOOKBACK = 10;
const ATR_FALLBACK_MULT = 1.5;
const MIN_RR = 2.0;

function findSwingHighInBars(bars: Bar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  const recentBars = bars.slice(-lookback);
  let highestHigh = 0;
  for (const bar of recentBars) {
    if (bar.high > highestHigh) {
      highestHigh = bar.high;
    }
  }
  return highestHigh;
}

function findSwingLowInBars(bars: Bar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  const recentBars = bars.slice(-lookback);
  let lowestLow = Infinity;
  for (const bar of recentBars) {
    if (bar.low < lowestLow) {
      lowestLow = bar.low;
    }
  }
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
    requiredIndicators: ['bars', 'rsi', 'atr', 'ema200', 'adx'],
    version: '2026-01-01',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, rsi, atr, trendBarsH4, ema200H4, adxH4, trendTimeframeUsed } = data;
    
    // ==========================================
    // SEATBELT 1: Fail-fast H4 trend data check
    // ==========================================
    if (!trendBarsH4 || trendBarsH4.length < 50) {
      return null;
    }
    if (!ema200H4 || ema200H4.length === 0) {
      return null;
    }
    if (!adxH4 || adxH4.length === 0) {
      return null;
    }
    
    if (!bars || bars.length < 50) return null;
    if (!rsi || rsi.length < 50) return null;
    if (!atr || atr.length < 50) return null;

    // ==========================================
    // SEATBELT 2: Separate indices for timeframes
    // ==========================================
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

    if (
      rsiSignal === null ||
      !Number.isFinite(rsiSignal) ||
      atrSignal === null ||
      !Number.isFinite(atrSignal) ||
      ema200H4Val === undefined ||
      !Number.isFinite(ema200H4Val) ||
      adxH4Val === undefined ||
      !Number.isFinite(adxH4Val)
    ) {
      return null;
    }

    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: SignalDirection | null = null;

    // H4 Trend Analysis
    const priceAboveEma200 = trendBar.close > ema200H4Val;
    const priceBelowEma200 = trendBar.close < ema200H4Val;
    const adxStrong = adxH4Val > 20;

    // Check 3-bar RSI lookback for recent oversold/overbought
    const rsiLookback: number[] = [];
    for (let i = 0; i < MIN_RSI_LOOKBACK; i++) {
      const val = atIndex(rsi, signalIdx - i);
      if (val !== null && Number.isFinite(val)) {
        rsiLookback.push(val);
      }
    }
    
    const minRsi = rsiLookback.length > 0 ? Math.min(...rsiLookback) : 100;
    const maxRsi = rsiLookback.length > 0 ? Math.max(...rsiLookback) : 0;
    
    // LONG: Price above H4 EMA200, ADX > 20, RSI recently touched oversold (<30)
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
      
    // SHORT: Price below H4 EMA200, ADX > 20, RSI recently touched overbought (>70)
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
    
    // Entry and stops
    const entryPrice = entryBar.open;
    
    // Swing-based stops (10 bars lookback) with ATR fallback
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
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) {
      return null;
    }
    
    const rr = Math.abs(takeProfitPrice - entryPrice) / risk;
    if (rr >= MIN_RR) {
      confidence += 10;
      reasonCodes.push('RR_FAVORABLE');
    }

    if (trendTimeframeUsed === 'D1') {
      triggers.push('Note: Using D1 fallback for trend (H4 unavailable)');
    }
    
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

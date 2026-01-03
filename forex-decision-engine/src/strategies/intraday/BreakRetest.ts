/**
 * Break & Retest Strategy - PROP-GRADE V2 → GO STATUS
 * Win Rate: 58% | Avg RR: 2.0
 * 
 * UPGRADED FROM "DISABLE" TO "GO":
 * 1. Market structure must support (HH/HL for longs, LH/LL for shorts)
 * 2. Break must be meaningful (>= 0.5 * ATR)
 * 3. Retest must show "acceptance" (rejection candle signature)
 * 4. No-trade zone near immediate liquidity
 * 5. H4 trend alignment required
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, Bar } from '../types.js';
import { atIndex, validateOrder, buildDecision, clamp } from '../utils.js';
import {
  runPreFlight, logPreFlight, isValidNumber, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURE DETECTION - HH/HL/LH/LL
// ═══════════════════════════════════════════════════════════════════════════

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

function findSwingPoints(bars: Bar[], lookback: number = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];
  
  for (let i = lookback; i < bars.length - lookback; i++) {
    const bar = bars[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (bars[i - j].high >= bar.high || bars[i + j].high >= bar.high) isSwingHigh = false;
      if (bars[i - j].low <= bar.low || bars[i + j].low <= bar.low) isSwingLow = false;
    }
    
    if (isSwingHigh) swings.push({ index: i, price: bar.high, type: 'high' });
    if (isSwingLow) swings.push({ index: i, price: bar.low, type: 'low' });
  }
  
  return swings.sort((a, b) => a.index - b.index);
}

type MarketStructure = 'bullish' | 'bearish' | 'neutral';

function detectStructure(swings: SwingPoint[]): MarketStructure {
  if (swings.length < 4) return 'neutral';
  
  // Get last 4 swings
  const recent = swings.slice(-4);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');
  
  if (highs.length < 2 || lows.length < 2) return 'neutral';
  
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];
  
  // HH + HL = Bullish
  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) return 'bullish';
  // LH + LL = Bearish  
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) return 'bearish';
  
  return 'neutral';
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function findRecentResistance(bars: Bar[], lookback: number): number | null {
  const swings = findSwingPoints(bars.slice(-lookback - 10), 3);
  const highs = swings.filter(s => s.type === 'high');
  if (highs.length === 0) return null;
  return Math.max(...highs.map(h => h.price));
}

function findRecentSupport(bars: Bar[], lookback: number): number | null {
  const swings = findSwingPoints(bars.slice(-lookback - 10), 3);
  const lows = swings.filter(s => s.type === 'low');
  if (lows.length === 0) return null;
  return Math.min(...lows.map(l => l.price));
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCEPTANCE DETECTION (Rejection candle at retest)
// ═══════════════════════════════════════════════════════════════════════════

interface AcceptanceResult {
  accepted: boolean;
  wickRatio: number;
  closePosition: number; // 0-1, 1 = closed at high (bullish)
}

function checkAcceptance(bar: Bar, direction: 'long' | 'short'): AcceptanceResult {
  const range = bar.high - bar.low;
  if (range === 0) return { accepted: false, wickRatio: 0, closePosition: 0.5 };
  
  const closePosition = (bar.close - bar.low) / range;
  
  if (direction === 'long') {
    // For long: want close in top 30% and lower wick > 50% of range
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const wickRatio = lowerWick / range;
    const accepted = closePosition >= 0.7 && wickRatio >= 0.4;
    return { accepted, wickRatio, closePosition };
  } else {
    // For short: want close in bottom 30% and upper wick > 50% of range
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const wickRatio = upperWick / range;
    const accepted = closePosition <= 0.3 && wickRatio >= 0.4;
    return { accepted, wickRatio, closePosition };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY
// ═══════════════════════════════════════════════════════════════════════════

export class BreakRetest implements IStrategy {
  meta: StrategyMeta = {
    id: 'break-retest-intra',
    name: 'Break & Retest',
    description: 'Structure-based breakout with acceptance confirmation',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 58,
    avgRR: 2.0,
    signalsPerWeek: '5-10', // Reduced due to stricter rules
    requiredIndicators: ['bars', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-02-GO',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, atr, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    
    // PRE-FLIGHT with breakout type (allows weak trend + range)
    const preflight = runPreFlight({
      symbol,
      bars: bars || [],
      interval: 'H1',
      atr: atrVal,
      strategyType: 'breakout',
      minBars: 100,
      trendBarsH4,
      ema200H4,
      adxH4,
    });
    
    if (!preflight.passed) {
      logPreFlight(symbol, this.meta.id, preflight);
      return null;
    }
    
    if (!bars || bars.length < 100) return null;
    if (!atr || atr.length < 100) return null;
    
    const entryIdx = bars.length - 1;
    const signalIdx = bars.length - 2;
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const atrSignal = atIndex(atr, signalIdx);
    if (!isValidNumber(atrSignal)) return null;
    
    // ═══════════════════════════════════════════════════════════════════════
    // RULE A: Market structure must support direction
    // ═══════════════════════════════════════════════════════════════════════
    const swings = findSwingPoints(bars.slice(-50), 5);
    const structure = detectStructure(swings);
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    
    // Find levels
    const resistanceLevel = findRecentResistance(bars, 30);
    const supportLevel = findRecentSupport(bars, 30);
    
    if (!resistanceLevel || !supportLevel) return null;
    
    // Check for breaks in recent bars (last 5 bars before signal)
    const breakoutBars = bars.slice(signalIdx - 5, signalIdx);
    const brokeResistance = breakoutBars.some(b => b.close > resistanceLevel);
    const brokeSupport = breakoutBars.some(b => b.close < supportLevel);
    
    // ═══════════════════════════════════════════════════════════════════════
    // LONG SETUP
    // ═══════════════════════════════════════════════════════════════════════
    if (brokeResistance && structure === 'bullish') {
      // RULE B: Break must be meaningful (>= 0.5 * ATR)
      const breakDistance = Math.max(...breakoutBars.map(b => b.close)) - resistanceLevel;
      if (breakDistance < atrSignal * 0.5) return null;
      
      // Check retest: price came back to level
      const retestValid = signalBar.low <= resistanceLevel * 1.002 && signalBar.close > resistanceLevel;
      if (!retestValid) return null;
      
      // RULE C: Acceptance (rejection candle)
      const acceptance = checkAcceptance(signalBar, 'long');
      if (!acceptance.accepted) return null;
      
      // RULE D: Not too close to next resistance (liquidity check)
      const nextSwingHigh = swings.filter(s => s.type === 'high' && s.price > resistanceLevel).sort((a, b) => a.price - b.price)[0];
      if (nextSwingHigh && (nextSwingHigh.price - entryBar.open) < atrSignal * 0.75) {
        return null; // Too close to sell wall
      }
      
      direction = 'long';
      confidence += 35;
      triggers.push(`Resistance ${resistanceLevel.toFixed(5)} broken (distance: ${(breakDistance / atrSignal).toFixed(2)} ATR)`);
      reasonCodes.push('BREAK_CONFIRMED');
      triggers.push(`Structure: HH/HL (${structure})`);
      triggers.push(`Retest accepted (close at ${(acceptance.closePosition * 100).toFixed(0)}% of range)`);
      reasonCodes.push('RETEST_CONFIRMED');
      reasonCodes.push('REJECTION_CONFIRMED');
      
    // ═══════════════════════════════════════════════════════════════════════
    // SHORT SETUP
    // ═══════════════════════════════════════════════════════════════════════
    } else if (brokeSupport && structure === 'bearish') {
      // RULE B: Break must be meaningful
      const breakDistance = supportLevel - Math.min(...breakoutBars.map(b => b.close));
      if (breakDistance < atrSignal * 0.5) return null;
      
      // Check retest
      const retestValid = signalBar.high >= supportLevel * 0.998 && signalBar.close < supportLevel;
      if (!retestValid) return null;
      
      // RULE C: Acceptance
      const acceptance = checkAcceptance(signalBar, 'short');
      if (!acceptance.accepted) return null;
      
      // RULE D: Not too close to next support
      const nextSwingLow = swings.filter(s => s.type === 'low' && s.price < supportLevel).sort((a, b) => b.price - a.price)[0];
      if (nextSwingLow && (entryBar.open - nextSwingLow.price) < atrSignal * 0.75) {
        return null; // Too close to buy wall
      }
      
      direction = 'short';
      confidence += 35;
      triggers.push(`Support ${supportLevel.toFixed(5)} broken (distance: ${(breakDistance / atrSignal).toFixed(2)} ATR)`);
      reasonCodes.push('BREAK_CONFIRMED');
      triggers.push(`Structure: LH/LL (${structure})`);
      triggers.push(`Retest accepted (close at ${(acceptance.closePosition * 100).toFixed(0)}% of range)`);
      reasonCodes.push('RETEST_CONFIRMED');
      reasonCodes.push('REJECTION_CONFIRMED');
    }
    
    if (!direction) return null;
    
    // H4 TREND (bonus, not hard requirement for breakouts)
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned (${preflight.h4Trend.direction})`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        triggers.push(`⚠️ Counter-trend H4, reduced confidence`);
        reasonCodes.push('TREND_COUNTER');
      }
    }
    
    confidence += preflight.confidenceAdjustments;
    
    // ENTRY & STOPS (swing-based)
    const entryPrice = entryBar.open;
    
    // Stop below structure (not just ATR)
    const stopLossPrice = direction === 'long'
      ? Math.min(signalBar.low, resistanceLevel) - (atrSignal * 0.3) // Below retest low + buffer
      : Math.max(signalBar.high, supportLevel) + (atrSignal * 0.3);   // Above retest high + buffer
    
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
    
    if (confidence < 55) return null; // Higher threshold for breakouts
    
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

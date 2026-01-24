/**
 * EMA Pullback Strategy - PROP-GRADE V3
 * Historical Win Rate: 50% | Historical Avg RR: 2.0
 *
 * V3 ENHANCEMENTS (4-Way AI Validation Consensus - Jan 2026):
 * 🔴 CRITICAL: ADX unconditional +15 replaced with tiered scoring
 * 🟡 Replaced candle color with close-in-range momentum confirmation (0.7/0.3)
 * 🟡 Added EMA50 reclaim bonus (conditional on touch)
 * 🟡 Added RSI extension CONDITIONAL handling (penalty in strong trends, block in weak)
 * 🟡 TP authority aligned (preferStructure: false)
 * 🟡 atrMultiplier reduced to 1.5 for consistency
 *
 * V2 FIXES (Retained):
 * - Added H4 trend framework
 * - Fixed falsy checks
 * - Counter-trend rejection
 * - minBars: 250
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, normalizedSlope, clamp, DEFAULT_SESSION_TP_PROFILE } from '../utils.js';
import {
  runPreFlight, logPreFlight, allValidNumbers, isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';
import { createLogger } from '../../services/logger.js';

const logger = createLogger('EmaPullback');

export class EmaPullback implements IStrategy {
  meta: StrategyMeta = {
    id: 'ema-pullback-intra',
    name: 'EMA Pullback',
    description: 'Trend continuation on EMA 20/50 pullback with tiered ADX, close-in-range confirmation, and RSI extension filter',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 50,
    avgRR: 2.0,
    signalsPerWeek: '6-12',
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-24',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, ema20, ema50, ema200, rsi, adx, atr, trendBarsH4, ema200H4, adxH4 } = data;

    // V2: PRE-FLIGHT
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'trend-continuation', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }

    if (!validateIndicators(data as unknown as Record<string, unknown>, ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'], 250)) return null;

    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];

    const ema20Signal = atIndex(ema20, signalIdx);
    const ema50Signal = atIndex(ema50, signalIdx);
    const ema200Signal = atIndex(ema200, signalIdx);
    const rsiSignal = atIndex(rsi, signalIdx);
    const adxSignal = atIndex(adx, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);

    // V2: Fix falsy check
    if (!allValidNumbers(ema20Signal, ema50Signal, ema200Signal, rsiSignal, adxSignal, atrSignal)) return null;

    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;

    const bullishTrend = signalBar.close > ema200Signal! && ema20Signal! > ema50Signal!;
    const bearishTrend = signalBar.close < ema200Signal! && ema20Signal! < ema50Signal!;
    const emaZoneHigh = Math.max(ema20Signal!, ema50Signal!);
    const emaZoneLow = Math.min(ema20Signal!, ema50Signal!);
    const inPullbackZone = signalBar.low <= emaZoneHigh && signalBar.high >= emaZoneLow;

    // V3: Calculate close-in-range for momentum confirmation
    const range = signalBar.high - signalBar.low;
    const closeRatio = range > 0 ? (signalBar.close - signalBar.low) / range : 0.5;

    if (bullishTrend && inPullbackZone && signalBar.close > ema20Signal!) {
      direction = 'long';
      confidence += 25;
      triggers.push('Price above EMA200 (uptrend)');
      triggers.push('EMA20 > EMA50 (bullish structure)');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');

      // V3: ADX tiered scoring (replaces unconditional +15)
      if (adxSignal! >= 35) {
        confidence += 15;
        triggers.push(`Very strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else if (adxSignal! >= 25) {
        confidence += 10;
        triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else if (adxSignal! >= 18) {
        confidence += 5;
        triggers.push(`Moderate trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else {
        triggers.push(`Weak trend (ADX: ${adxSignal!.toFixed(1)})`);
      }

      // RSI neutral reset bonus (existing)
      if (rsiSignal! >= 40 && rsiSignal! <= 60) {
        confidence += 10;
        triggers.push(`RSI reset to neutral (${rsiSignal!.toFixed(1)})`);
      }

      // EMA200 slope bonus (existing)
      const slope = normalizedSlope(ema200!, 10);
      if (slope > 0.00005) {
        confidence += 10;
        triggers.push('EMA200 sloping upward');
      }

      // V3: Close-in-range replaces candle color
      if (closeRatio > 0.7) {
        confidence += 15;
        triggers.push('Strong close (top 30% of range)');
        reasonCodes.push('CANDLE_CONFIRMATION');
      }

      // V3: EMA50 reclaim bonus (conditional on touch)
      if (signalBar.low <= ema50Signal! && signalBar.close > ema50Signal!) {
        confidence += 10;
        triggers.push('Deep pullback with EMA50 reclaim');
      }

    } else if (bearishTrend && inPullbackZone && signalBar.close < ema20Signal!) {
      direction = 'short';
      confidence += 25;
      triggers.push('Price below EMA200 (downtrend)');
      triggers.push('EMA20 < EMA50 (bearish structure)');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');

      // V3: ADX tiered scoring (replaces unconditional +15)
      if (adxSignal! >= 35) {
        confidence += 15;
        triggers.push(`Very strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else if (adxSignal! >= 25) {
        confidence += 10;
        triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else if (adxSignal! >= 18) {
        confidence += 5;
        triggers.push(`Moderate trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else {
        triggers.push(`Weak trend (ADX: ${adxSignal!.toFixed(1)})`);
      }

      // RSI neutral reset bonus (existing)
      if (rsiSignal! >= 40 && rsiSignal! <= 60) {
        confidence += 10;
        triggers.push(`RSI reset to neutral (${rsiSignal!.toFixed(1)})`);
      }

      // EMA200 slope bonus (existing)
      const slope = normalizedSlope(ema200!, 10);
      if (slope < -0.00005) {
        confidence += 10;
        triggers.push('EMA200 sloping downward');
      }

      // V3: Close-in-range replaces candle color
      if (closeRatio < 0.3) {
        confidence += 15;
        triggers.push('Strong close (bottom 30% of range)');
        reasonCodes.push('CANDLE_CONFIRMATION');
      }

      // V3: EMA50 reclaim bonus (conditional on touch)
      if (signalBar.high >= ema50Signal! && signalBar.close < ema50Signal!) {
        confidence += 10;
        triggers.push('Deep pullback with EMA50 reclaim');
      }
    }

    if (!direction) return null;

    // V3: CONDITIONAL RSI extension handling (NOT hard block)
    // Strong trends can sustain extended RSI - only penalize, don't kill
    // Weak/moderate trends with extended RSI = exhaustion risk = block
    // Unknown/missing trend = allow with bigger penalty
    if (direction === 'long' && rsiSignal! > 70) {
      if (preflight.h4Trend?.strength === 'weak' || preflight.h4Trend?.strength === 'moderate') {
        return null; // Block only in EXPLICITLY weak/moderate trends
      } else if (preflight.h4Trend?.strength === 'strong') {
        confidence -= 10;
        triggers.push(`RSI extended but strong trend allows (${rsiSignal!.toFixed(1)})`);
      } else {
        confidence -= 15; // Unknown/missing H4 trend = bigger penalty
        triggers.push(`RSI extended, H4 trend unknown (${rsiSignal!.toFixed(1)})`);
      }
    }
    if (direction === 'short' && rsiSignal! < 30) {
      if (preflight.h4Trend?.strength === 'weak' || preflight.h4Trend?.strength === 'moderate') {
        return null; // Block only in EXPLICITLY weak/moderate trends
      } else if (preflight.h4Trend?.strength === 'strong') {
        confidence -= 10;
        triggers.push(`RSI extended but strong trend allows (${rsiSignal!.toFixed(1)})`);
      } else {
        confidence -= 15; // Unknown/missing H4 trend = bigger penalty
        triggers.push(`RSI extended, H4 trend unknown (${rsiSignal!.toFixed(1)})`);
      }
    }

    // V2: H4 TREND (reject counter-trend for trend strategy)
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned (${preflight.h4Trend.direction})`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        return null; // V2: Reject counter-trend for trend-continuation strategy
      }
    }
    confidence += preflight.confidenceAdjustments;

    const entryPrice = entryBar.open;
    const stopLossPrice = direction === 'long' ? emaZoneLow - (atrSignal! * 0.5) : emaZoneHigh + (atrSignal! * 0.5);
    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long' ? entryPrice + (riskAmount * 2) : entryPrice - (riskAmount * 2);

    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;

    reasonCodes.push('RR_FAVORABLE');
    confidence += 10;
    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;

    // V3: PHASE1_SIGNAL logging for validation tracking (raw numbers for analysis)
    const adxTier = adxSignal! >= 35 ? 'very-strong' : adxSignal! >= 25 ? 'strong' : adxSignal! >= 18 ? 'moderate' : 'weak';
    const ema50Touched = direction === 'long' ? signalBar.low <= ema50Signal! : signalBar.high >= ema50Signal!;
    const ema50Reclaim = direction === 'long' ? signalBar.close > ema50Signal! : signalBar.close < ema50Signal!;
    logger.info('PHASE1_SIGNAL', {
      symbol,
      timestamp: signalBar.timestamp,
      direction,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      targetRR: 2.0,
      adxSignal: adxSignal!,       // Raw number
      adxTier,
      closeRatio,                   // Raw number
      rsiSignal: rsiSignal!,        // Raw number
      ema50Touched,
      ema50Reclaim,                 // Corrected field name (was ema50Reclaimed)
      h4TrendDirection: preflight.h4Trend?.direction ?? 'unknown',
      h4TrendStrength: preflight.h4Trend?.strength ?? 'unknown',
      confidence,
    });

    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice, stopLoss: stopLossPrice, takeProfit: takeProfitPrice,
      triggers, reasonCodes, settings, timeframes: this.meta.timeframes,
      bars,
      atr: atrSignal ?? null,
      takeProfitConfig: {
        preferStructure: false,  // V3: Deterministic RR
        structureLookback: 60,
        rrTarget: 2,
        atrMultiplier: 1.5,  // V3: Reduced from 2.0 for consistency
        sessionProfile: DEFAULT_SESSION_TP_PROFILE,
      },
    });
  }
}

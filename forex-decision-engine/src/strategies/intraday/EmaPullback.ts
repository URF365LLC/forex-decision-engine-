/**
 * EMA Pullback Strategy - PROP-GRADE V3.1
 * Historical Win Rate: 50% | Historical Avg RR: 2.0
 *
 * V3.1 HARDENING (3-Way AI Forensic Audit Consensus - Jan 31, 2026):
 * 🔴 GATE 1: H4 Trend Must Exist - hard require (was optional)
 * 🔴 GATE 2: H4 ADX >= 20 - hard floor (was never read)
 * 🔴 GATE 3: H1 ADX >= 18 - hard floor (was tiered scoring only)
 * 🟡 GATE 4: EMA Zone Width <= 3 ATR - prevent wide-zone false pullbacks
 * 🟡 GATE 5: Close-in-Range Floor - 0.6 long / 0.4 short minimum
 * 🟡 GATE 6: EMA200 Slope Enforcement - directional gate, not just bonus
 * 🟡 GATE 7: Entry Bar EMA200 Check - prevent counter-trend entry drift
 * 🟢 GATE_CONFIG: Centralized thresholds for runtime tuning
 *
 * V3 ENHANCEMENTS (Retained):
 * - ADX tiered scoring (after floor gate)
 * - Close-in-range momentum confirmation
 * - EMA50 reclaim bonus
 * - RSI extension conditional handling
 *
 * V2 FIXES (Retained):
 * - H4 trend framework
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

// V3.1: Centralized gate configuration for runtime tuning
const GATE_CONFIG = {
  // Gate 2: H4 ADX minimum
  h4AdxMin: 20,
  // Gate 3: H1 ADX minimum
  h1AdxMin: 18,
  // Gate 4: EMA zone max width (ATR multiplier)
  emaZoneMaxAtr: 3,
  // Gate 5: Close-in-range floors
  closeRatioMinLong: 0.6,
  closeRatioMaxShort: 0.4,
  // Gate 6: EMA200 slope minimums
  ema200SlopeMinLong: 0.00002,
  ema200SlopeMaxShort: -0.00002,
  // Gate 6: EMA200 slope bonus thresholds (existing)
  ema200SlopeBonusLong: 0.00005,
  ema200SlopeBonusShort: -0.00005,
};

export class EmaPullback implements IStrategy {
  meta: StrategyMeta = {
    id: 'ema-pullback-intra',
    name: 'EMA Pullback',
    description: 'Trend continuation on EMA 20/50 pullback with 7-gate quality filter (H4 trend, ADX floors, zone width, close ratio, slope, entry validation)',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 50,
    avgRR: 2.0,
    signalsPerWeek: '2-4',  // V3.1: Reduced from 6-12 due to gate filtering
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-31',  // V3.1 Gate-First Architecture
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

    // ═══════════════════════════════════════════════════════════════════════════
    // V3.1 CRITICAL GATES - "Gate-First" Architecture
    // These gates MUST pass before any confidence scoring begins
    // ═══════════════════════════════════════════════════════════════════════════

    // GATE 1: H4 Trend Must Exist [CRITICAL - 30-40% block rate]
    // A trend-continuation strategy MUST have higher-timeframe context
    if (!preflight.h4Trend) {
      logger.warn('GATE1_BLOCKED', { symbol, reason: 'No H4 trend data' });
      return null;
    }

    // GATE 2: H4 ADX >= 20 [CRITICAL - 10-15% block rate]
    // H4 trend must have sufficient directional momentum
    if (preflight.h4Trend.adxValue < GATE_CONFIG.h4AdxMin) {
      logger.warn('GATE2_BLOCKED', {
        symbol,
        h4Adx: preflight.h4Trend.adxValue,
        threshold: GATE_CONFIG.h4AdxMin,
      });
      return null;
    }

    // GATE 3: H1 ADX >= 18 [CRITICAL - 20-30% block rate]
    // Entry timeframe must show trending conditions, not chop
    if (adxSignal! < GATE_CONFIG.h1AdxMin) {
      logger.warn('GATE3_BLOCKED', {
        symbol,
        h1Adx: adxSignal!,
        threshold: GATE_CONFIG.h1AdxMin,
      });
      return null;
    }

    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;

    const bullishTrend = signalBar.close > ema200Signal! && ema20Signal! > ema50Signal!;
    const bearishTrend = signalBar.close < ema200Signal! && ema20Signal! < ema50Signal!;
    const emaZoneHigh = Math.max(ema20Signal!, ema50Signal!);
    const emaZoneLow = Math.min(ema20Signal!, ema50Signal!);
    const emaZoneWidth = Math.abs(ema20Signal! - ema50Signal!);

    // GATE 4: EMA Zone Width <= 3 ATR [HIGH - 5-10% block rate]
    // Wide zones in ranging markets = "price exists in range", not "pullback"
    if (emaZoneWidth > atrSignal! * GATE_CONFIG.emaZoneMaxAtr) {
      logger.warn('GATE4_BLOCKED', {
        symbol,
        zoneWidthPips: emaZoneWidth,
        atrPips: atrSignal!,
        widthAtr: (emaZoneWidth / atrSignal!).toFixed(2),
        threshold: GATE_CONFIG.emaZoneMaxAtr,
      });
      return null;
    }

    const inPullbackZone = signalBar.low <= emaZoneHigh && signalBar.high >= emaZoneLow;

    // V3: Calculate close-in-range for momentum confirmation
    const range = signalBar.high - signalBar.low;
    const closeRatio = range > 0 ? (signalBar.close - signalBar.low) / range : 0.5;

    if (bullishTrend && inPullbackZone && signalBar.close > ema20Signal!) {
      direction = 'long';

      // GATE 5: Close-in-Range Floor (Long) [HIGH - 10-15% block rate]
      // Weak close = structurally incomplete setup
      if (closeRatio < GATE_CONFIG.closeRatioMinLong) {
        logger.warn('GATE5_BLOCKED', {
          symbol,
          direction: 'long',
          closeRatio: closeRatio.toFixed(3),
          threshold: GATE_CONFIG.closeRatioMinLong,
        });
        return null;
      }

      // GATE 6: EMA200 Slope Enforcement (Long) [HIGH - 10-15% block rate]
      // Trend-continuation requires EMA200 supporting the direction
      const slope = normalizedSlope(ema200!, 10);
      if (slope < GATE_CONFIG.ema200SlopeMinLong) {
        logger.warn('GATE6_BLOCKED', {
          symbol,
          direction: 'long',
          slope: slope.toFixed(8),
          threshold: GATE_CONFIG.ema200SlopeMinLong,
        });
        return null;
      }

      confidence += 25;
      triggers.push('Price above EMA200 (uptrend)');
      triggers.push('EMA20 > EMA50 (bullish structure)');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');

      // V3: ADX tiered scoring (after Gate 3 floor ensures ADX >= 18)
      if (adxSignal! >= 35) {
        confidence += 15;
        triggers.push(`Very strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else if (adxSignal! >= 25) {
        confidence += 10;
        triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else {
        confidence += 5;
        triggers.push(`Moderate trend (ADX: ${adxSignal!.toFixed(1)})`);
      }

      // RSI neutral reset bonus (existing)
      if (rsiSignal! >= 40 && rsiSignal! <= 60) {
        confidence += 10;
        triggers.push(`RSI reset to neutral (${rsiSignal!.toFixed(1)})`);
      }

      // EMA200 slope bonus (after Gate 6 ensures minimum slope)
      if (slope > GATE_CONFIG.ema200SlopeBonusLong) {
        confidence += 10;
        triggers.push('EMA200 sloping upward');
      }

      // V3.1: Close-in-range bonus (after Gate 5 ensures minimum)
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

      // GATE 5: Close-in-Range Floor (Short) [HIGH - 10-15% block rate]
      // Weak close = structurally incomplete setup (for shorts, close should be low in range)
      if (closeRatio > GATE_CONFIG.closeRatioMaxShort) {
        logger.warn('GATE5_BLOCKED', {
          symbol,
          direction: 'short',
          closeRatio: closeRatio.toFixed(3),
          threshold: GATE_CONFIG.closeRatioMaxShort,
        });
        return null;
      }

      // GATE 6: EMA200 Slope Enforcement (Short) [HIGH - 10-15% block rate]
      // Trend-continuation requires EMA200 supporting the direction
      const slope = normalizedSlope(ema200!, 10);
      if (slope > GATE_CONFIG.ema200SlopeMaxShort) {
        logger.warn('GATE6_BLOCKED', {
          symbol,
          direction: 'short',
          slope: slope.toFixed(8),
          threshold: GATE_CONFIG.ema200SlopeMaxShort,
        });
        return null;
      }

      confidence += 25;
      triggers.push('Price below EMA200 (downtrend)');
      triggers.push('EMA20 < EMA50 (bearish structure)');
      triggers.push('Price pulled back to EMA20/50 zone');
      reasonCodes.push('EMA_PULLBACK');

      // V3: ADX tiered scoring (after Gate 3 floor ensures ADX >= 18)
      if (adxSignal! >= 35) {
        confidence += 15;
        triggers.push(`Very strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else if (adxSignal! >= 25) {
        confidence += 10;
        triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
      } else {
        confidence += 5;
        triggers.push(`Moderate trend (ADX: ${adxSignal!.toFixed(1)})`);
      }

      // RSI neutral reset bonus (existing)
      if (rsiSignal! >= 40 && rsiSignal! <= 60) {
        confidence += 10;
        triggers.push(`RSI reset to neutral (${rsiSignal!.toFixed(1)})`);
      }

      // EMA200 slope bonus (after Gate 6 ensures minimum slope)
      if (slope < GATE_CONFIG.ema200SlopeBonusShort) {
        confidence += 10;
        triggers.push('EMA200 sloping downward');
      }

      // V3.1: Close-in-range bonus (after Gate 5 ensures minimum)
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

    // GATE 7: Entry Bar EMA200 Check [HIGH - 5-10% block rate]
    // Price can gap through EMA200 between signal close and entry open
    // This prevents counter-trend entries with collapsed RR
    const ema200Entry = atIndex(ema200, entryIdx);
    if (!ema200Entry) {
      logger.warn('GATE7_BLOCKED', { symbol, reason: 'No EMA200 at entry bar' });
      return null;
    }
    if (direction === 'long' && entryPrice < ema200Entry) {
      logger.warn('GATE7_BLOCKED', {
        symbol,
        direction: 'long',
        entryPrice,
        ema200Entry,
        reason: 'Entry below EMA200 (counter-trend)',
      });
      return null;
    }
    if (direction === 'short' && entryPrice > ema200Entry) {
      logger.warn('GATE7_BLOCKED', {
        symbol,
        direction: 'short',
        entryPrice,
        ema200Entry,
        reason: 'Entry above EMA200 (counter-trend)',
      });
      return null;
    }

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

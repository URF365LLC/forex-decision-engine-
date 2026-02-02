/**
 * EMA Pullback Strategy - PROP-GRADE V3.1
 * Historical Win Rate: 50% | Historical Avg RR: 2.0
 *
 * V3.1 HARDENING (Gate-First Architecture - Jan 31, 2026):
 * 🔴 GATE 1: H4 Trend Must Exist (hard require)
 * 🔴 GATE 2: H4 ADX >= min (hard floor)
 * 🔴 GATE 3: H1 ADX >= min (hard floor)
 * 🟡 GATE 4: EMA20/50 Zone Width <= N * ATR (prevents wide-zone chop)
 * 🟡 GATE 5: Close-in-Range Floor (long >= x, short <= y)
 * 🟡 GATE 6: EMA200 Slope Enforcement (directional gate)
 * 🟡 GATE 7: Entry Bar EMA200 Re-check (prevents drift/gap)
 *
 * Retained V3 features (now subordinate to gates):
 * - ADX tiered scoring (after GATE 3)
 * - Close-in-range momentum bonus (after GATE 5)
 * - EMA50 reclaim bonus (conditional on touch)
 * - RSI extension conditional handling (strong trends allow with penalty)
 *
 * Retained V2 features:
 * - H4 trend framework
 * - Counter-trend rejection
 * - minBars: 250
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, getPipInfo, formatPrice } from '../types.js';
import {
  atIndex,
  validateOrder,
  validateIndicators,
  buildDecision,
  normalizedSlope,
  clamp,
  DEFAULT_SESSION_TP_PROFILE,
} from '../utils.js';
import {
  runPreFlight,
  logPreFlight,
  allValidNumbers,
  isTrendAligned,
  getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';
import { createLogger } from '../../services/logger.js';

// Execution integrity configuration
const EXEC_CONFIG = {
  maxDriftAtrMultiple: 0.25,  // Max 25% of ATR drift allowed between signal close and entry open
  barSpacingToleranceSec: 900, // 15 minutes tolerance for H1 bar spacing (~3600s expected)
};

const logger = createLogger('EmaPullback');

// V3.1: Centralized gate configuration (tune without rewriting logic)
const GATE_CONFIG = {
  // Gate 2: H4 ADX minimum
  h4AdxMin: 20,

  // Gate 3: H1 ADX minimum
  h1AdxMin: 18,

  // Gate 4: EMA20/50 zone max width expressed in ATR multiples
  emaZoneMaxAtr: 3,

  // Gate 5: Close-in-range floors
  closeRatioMinLong: 0.6,
  closeRatioMaxShort: 0.4,

  // Gate 6: EMA200 slope minimums (normalizedSlope output domain)
  ema200SlopeMinLong: 0.00002,
  ema200SlopeMaxShort: -0.00002,

  // Bonus thresholds (not gates)
  ema200SlopeBonusLong: 0.00005,
  ema200SlopeBonusShort: -0.00005,

  // Optional: "RSI reset" stricter bonus (not a gate)
  rsiResetLookbackBars: 2,
  rsiWasOversold: 35,
  rsiWasOverbought: 65,
  rsiNeutralLow: 45,
  rsiNeutralHigh: 55,

  // Risk/structure
  stopAtrBuffer: 0.5,
  rrTarget: 2,
  tpAtrMultiplier: 1.5,
};

export class EmaPullback implements IStrategy {
  meta: StrategyMeta = {
    id: 'ema-pullback-intra',
    name: 'EMA Pullback',
    description:
      'Trend continuation on EMA 20/50 pullback with 7-gate quality filter (H4 trend + ADX floors + zone width + close ratio + slope + entry validation)',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 50,
    avgRR: 2.0,
    signalsPerWeek: '2-4',
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-31',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, ema20, ema50, ema200, rsi, adx, atr, adxH1, trendBarsH4, ema200H4, adxH4, trendTimeframeUsed } = data;

    // ─────────────────────────────────────────────────────────────
    // INPUT_SNAPSHOT: Data flow verification (proves pipeline is fresh)
    // ─────────────────────────────────────────────────────────────
    const entryIdxSnap = bars && bars.length > 0 ? bars.length - 1 : -1;
    const signalIdxSnap = bars && bars.length > 1 ? bars.length - 2 : -1;
    logger.debug('INPUT_SNAPSHOT', {
      symbol,
      barsLength: bars?.length ?? 0,
      entryBarTimestamp: entryIdxSnap >= 0 ? bars![entryIdxSnap].timestamp : null,
      signalBarTimestamp: signalIdxSnap >= 0 ? bars![signalIdxSnap].timestamp : null,
      ema20Last: ema20 && ema20.length > 0 ? atIndex(ema20, signalIdxSnap) : null,
      ema50Last: ema50 && ema50.length > 0 ? atIndex(ema50, signalIdxSnap) : null,
      ema200Last: ema200 && ema200.length > 0 ? atIndex(ema200, signalIdxSnap) : null,
      adxLast: adx && adx.length > 0 ? atIndex(adx, signalIdxSnap) : null,
      rsiLast: rsi && rsi.length > 0 ? atIndex(rsi, signalIdxSnap) : null,
      atrLast: atr && atr.length > 0 ? atIndex(atr, signalIdxSnap) : null,
      h4BarsLength: trendBarsH4?.length ?? 0,
      h4LastTimestamp: trendBarsH4 && trendBarsH4.length > 0 ? trendBarsH4[trendBarsH4.length - 1].timestamp : null,
      adxH4Last: adxH4 && adxH4.length > 0 ? adxH4[adxH4.length - 1] : null,
    });

    // ─────────────────────────────────────────────────────────────
    // Preflight
    // ─────────────────────────────────────────────────────────────
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;

    const preflight = runPreFlight({
      symbol,
      bars: bars || [],
      interval: 'H1',
      atr: atrVal,
      strategyType: 'trend-continuation',
      minBars: 250,
      trendBarsH4,
      ema200H4,
      adxH4,
    });

    if (!preflight.passed) {
      logPreFlight(symbol, this.meta.id, preflight);
      return null;
    }

    if (
      !validateIndicators(
        data as unknown as Record<string, unknown>,
        ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'],
        250,
      )
    ) {
      return null;
    }

    const entryIdx = bars!.length - 1; // current bar (entry uses OPEN)
    const signalIdx = bars!.length - 2; // last closed bar (signal uses CLOSE)
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];

    const ema20Signal = atIndex(ema20, signalIdx);
    const ema50Signal = atIndex(ema50, signalIdx);
    const ema200Signal = atIndex(ema200, signalIdx);
    const rsiSignal = atIndex(rsi, signalIdx);
    const adxSignal = atIndex(adx, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);
    // H1 ADX: Use its own array length (ADX array may be shorter than bars due to warm-up period)
    const adxH1Arr = adxH1 && Array.isArray(adxH1) ? adxH1 as { timestamp: string; value: number }[] : [];
    const adxH1SignalIdx = adxH1Arr.length >= 2 ? adxH1Arr.length - 2 : -1;
    const adxH1SignalVal = adxH1SignalIdx >= 0 ? adxH1Arr[adxH1SignalIdx]?.value ?? null : null;
    
    // Debug: Log adxH1 array info for troubleshooting
    if (!adxH1SignalVal || !Number.isFinite(adxH1SignalVal)) {
      logger.warn('ADX_H1_DEBUG', {
        symbol,
        adxH1Defined: !!adxH1,
        adxH1IsArray: Array.isArray(adxH1),
        adxH1Length: adxH1Arr.length,
        adxH1SignalIdx,
        adxH1SignalVal,
        adxH1Sample: adxH1Arr.length > 0 ? adxH1Arr.slice(-3) : 'empty',
      });
    }

    // Entry bar indicators for comprehensive NaN check
    const ema20Entry = atIndex(ema20, entryIdx);
    const ema50Entry = atIndex(ema50, entryIdx);
    const atrEntry = atIndex(atr, entryIdx);
    // H1 ADX at entry bar (last element in adxH1 array)
    const adxH1EntryIdx = adxH1Arr.length >= 1 ? adxH1Arr.length - 1 : -1;
    const adxH1EntryVal = adxH1EntryIdx >= 0 ? adxH1Arr[adxH1EntryIdx]?.value ?? null : null;
    const rsiEntry = atIndex(rsi, entryIdx);

    // Comprehensive NaN check at BOTH signal and entry bars
    const indicatorChecks = [
      { name: 'ema20Signal', value: ema20Signal },
      { name: 'ema50Signal', value: ema50Signal },
      { name: 'ema200Signal', value: ema200Signal },
      { name: 'atrSignal', value: atrSignal },
      { name: 'adxH1Signal', value: adxH1SignalVal },
      { name: 'rsiSignal', value: rsiSignal },
      { name: 'ema20Entry', value: ema20Entry },
      { name: 'ema50Entry', value: ema50Entry },
      { name: 'atrEntry', value: atrEntry },
    ];

    for (const check of indicatorChecks) {
      if (!Number.isFinite(check.value)) {
        logger.warn('INDICATOR_NAN_BLOCKED', {
          symbol,
          indicator: check.name,
          value: check.value,
          reason: 'NaN or invalid indicator value',
        });
        return null;
      }
    }

    if (!allValidNumbers(ema20Signal, ema50Signal, ema200Signal, rsiSignal, adxSignal, atrSignal, adxH1SignalVal)) return null;

    // ─────────────────────────────────────────────────────────────
    // V3.1 GATE-FIRST ARCHITECTURE (Gates must pass before scoring)
    // ─────────────────────────────────────────────────────────────

    // GATE 0: H4 timeframe required (HARD BLOCK D1 fallback or missing H4)
    if (trendTimeframeUsed !== 'H4') {
      logger.warn('GATE0_H4_REQUIRED_BLOCKED', {
        symbol,
        reason: trendTimeframeUsed === 'D1' 
          ? 'D1 fallback not allowed for intraday strategy - H4 data required'
          : 'H4 trend data unavailable - intraday strategy requires H4 timeframe',
        trendTimeframeUsed: trendTimeframeUsed ?? 'undefined',
      });
      return null;
    }

    // GATE 1: H4 Trend must exist
    if (!preflight.h4Trend) {
      logger.warn('GATE1_BLOCKED', { symbol, reason: 'No H4 trend data' });
      return null;
    }

    // GATE 2: H4 ADX must be >= threshold
    if (preflight.h4Trend.adxValue < GATE_CONFIG.h4AdxMin) {
      logger.warn('GATE2_BLOCKED', {
        symbol,
        h4Adx: preflight.h4Trend.adxValue,
        threshold: GATE_CONFIG.h4AdxMin,
      });
      return null;
    }

    // GATE 3: H1 ADX must be >= threshold (using ACTUAL H1 ADX from API)
    if (!adxH1SignalVal || adxH1SignalVal < GATE_CONFIG.h1AdxMin) {
      logger.warn('GATE3_BLOCKED', {
        symbol,
        h1Adx: adxH1SignalVal,
        threshold: GATE_CONFIG.h1AdxMin,
        source: 'H1',
      });
      return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // E2: EXECUTION DRIFT GATE
    // Reject if entry price gaps too far from signal bar close
    // ═══════════════════════════════════════════════════════════════
    const { pipSize } = getPipInfo(symbol);
    const driftDistance = Math.abs(entryBar.open - signalBar.close);
    const maxDrift = atrSignal! * EXEC_CONFIG.maxDriftAtrMultiple;

    if (driftDistance > maxDrift) {
      logger.warn('EXEC_E2_BLOCKED', {
        symbol,
        reason: 'Entry price drifted too far from signal close',
        driftPips: (driftDistance / pipSize).toFixed(1),
        maxDriftPips: (maxDrift / pipSize).toFixed(1),
        entryOpen: formatPrice(entryBar.open, symbol),
        signalClose: formatPrice(signalBar.close, symbol),
        atr: atrSignal!.toFixed(5),
      });
      return null;
    }

    // Setup geometry
    const bullishTrend = signalBar.close > ema200Signal! && ema20Signal! > ema50Signal!;
    const bearishTrend = signalBar.close < ema200Signal! && ema20Signal! < ema50Signal!;
    const emaZoneHigh = Math.max(ema20Signal!, ema50Signal!);
    const emaZoneLow = Math.min(ema20Signal!, ema50Signal!);
    const emaZoneWidth = Math.abs(ema20Signal! - ema50Signal!);

    // GATE 4: EMA zone width must be <= N * ATR
    if (emaZoneWidth > atrSignal! * GATE_CONFIG.emaZoneMaxAtr) {
      logger.warn('GATE4_BLOCKED', {
        symbol,
        zoneWidth: emaZoneWidth,
        atr: atrSignal!,
        widthAtr: (emaZoneWidth / atrSignal!).toFixed(2),
        thresholdAtr: GATE_CONFIG.emaZoneMaxAtr,
      });
      return null;
    }

    const inPullbackZone = signalBar.low <= emaZoneHigh && signalBar.high >= emaZoneLow;

    // Candle momentum metric
    const range = signalBar.high - signalBar.low;
    const closeRatio = range > 0 ? (signalBar.close - signalBar.low) / range : 0.5;

    // Decide direction (still not scoring)
    let direction: 'long' | 'short' | null = null;
    if (bullishTrend && inPullbackZone && signalBar.close > ema20Signal!) direction = 'long';
    if (bearishTrend && inPullbackZone && signalBar.close < ema20Signal!) direction = 'short';
    if (!direction) return null;

    // Enforce H4 alignment (trend continuation strategy)
    if (!isTrendAligned(preflight.h4Trend, direction)) {
      logger.warn('TREND_BLOCKED', {
        symbol,
        direction,
        h4Direction: preflight.h4Trend.direction,
        reason: 'Counter-trend vs H4',
      });
      return null;
    }

    // GATE 5: Close-in-range floor
    if (direction === 'long' && closeRatio < GATE_CONFIG.closeRatioMinLong) {
      logger.warn('GATE5_BLOCKED', { symbol, direction, closeRatio, min: GATE_CONFIG.closeRatioMinLong });
      return null;
    }
    if (direction === 'short' && closeRatio > GATE_CONFIG.closeRatioMaxShort) {
      logger.warn('GATE5_BLOCKED', { symbol, direction, closeRatio, max: GATE_CONFIG.closeRatioMaxShort });
      return null;
    }

    // GATE 6: EMA200 slope enforcement
    const slope = normalizedSlope(ema200!, 10);
    if (direction === 'long' && slope < GATE_CONFIG.ema200SlopeMinLong) {
      logger.warn('GATE6_BLOCKED', { symbol, direction, slope, min: GATE_CONFIG.ema200SlopeMinLong });
      return null;
    }
    if (direction === 'short' && slope > GATE_CONFIG.ema200SlopeMaxShort) {
      logger.warn('GATE6_BLOCKED', { symbol, direction, slope, max: GATE_CONFIG.ema200SlopeMaxShort });
      return null;
    }

    // ─────────────────────────────────────────────────────────────
    // Scoring (ONLY after gates pass)
    // ─────────────────────────────────────────────────────────────
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;

    confidence += 25;
    triggers.push(direction === 'long' ? 'Price above EMA200 (uptrend)' : 'Price below EMA200 (downtrend)');
    triggers.push(direction === 'long' ? 'EMA20 > EMA50 (bullish structure)' : 'EMA20 < EMA50 (bearish structure)');
    triggers.push('Price pulled back to EMA20/50 zone');
    reasonCodes.push('EMA_PULLBACK');

    // H4 trend confidence adjustment (now guaranteed to exist + be aligned)
    confidence += getTrendConfidenceAdjustment(preflight.h4Trend, direction);
    triggers.push(`H4 trend aligned (${preflight.h4Trend.direction})`);
    reasonCodes.push('TREND_ALIGNED');

    // Include any preflight adjustments (freshness/quality/etc.)
    confidence += preflight.confidenceAdjustments;

    // ADX tiered scoring using ACTUAL H1 ADX (GATE 3 already enforced ADX >= 18)
    if (adxH1SignalVal! >= 35) {
      confidence += 15;
      triggers.push(`Very strong H1 trend (ADX: ${adxH1SignalVal!.toFixed(1)})`);
    } else if (adxH1SignalVal! >= 25) {
      confidence += 10;
      triggers.push(`Strong H1 trend (ADX: ${adxH1SignalVal!.toFixed(1)})`);
    } else {
      confidence += 5;
      triggers.push(`Moderate H1 trend (ADX: ${adxH1SignalVal!.toFixed(1)})`);
    }

    // EMA200 slope bonus (not gate)
    if (direction === 'long' && slope > GATE_CONFIG.ema200SlopeBonusLong) {
      confidence += 10;
      triggers.push('EMA200 strongly sloping upward');
    }
    if (direction === 'short' && slope < GATE_CONFIG.ema200SlopeBonusShort) {
      confidence += 10;
      triggers.push('EMA200 strongly sloping downward');
    }

    // Close-in-range "dominance" bonus (not gate, gate already enforced floor)
    if (direction === 'long' && closeRatio > 0.7) {
      confidence += 15;
      triggers.push('Strong close (top 30% of range)');
      reasonCodes.push('CANDLE_CONFIRMATION');
    }
    if (direction === 'short' && closeRatio < 0.3) {
      confidence += 15;
      triggers.push('Strong close (bottom 30% of range)');
      reasonCodes.push('CANDLE_CONFIRMATION');
    }

    // EMA50 reclaim bonus
    const ema50Reclaim =
      direction === 'long'
        ? signalBar.low <= ema50Signal! && signalBar.close > ema50Signal!
        : signalBar.high >= ema50Signal! && signalBar.close < ema50Signal!;
    if (ema50Reclaim) {
      confidence += 10;
      triggers.push('Deep pullback with EMA50 reclaim');
    }

    // RSI "actual reset" bonus (optional quality, not a gate)
    // Only award if RSI was extreme in recent bars AND has returned to neutral zone.
    const rsiPrev1 = atIndex(rsi, signalIdx - 1);
    const rsiPrev2 = atIndex(rsi, signalIdx - 2);
    const recent = [rsiPrev1, rsiPrev2].filter((x) => typeof x === 'number') as number[];

    if (recent.length > 0) {
      const nowNeutral = rsiSignal! >= GATE_CONFIG.rsiNeutralLow && rsiSignal! <= GATE_CONFIG.rsiNeutralHigh;

      if (direction === 'long') {
        const wasOversold = recent.some((v) => v < GATE_CONFIG.rsiWasOversold);
        if (wasOversold && nowNeutral) {
          confidence += 10;
          triggers.push(`RSI reset from oversold → neutral (${rsiSignal!.toFixed(1)})`);
        }
      } else {
        const wasOverbought = recent.some((v) => v > GATE_CONFIG.rsiWasOverbought);
        if (wasOverbought && nowNeutral) {
          confidence += 10;
          triggers.push(`RSI reset from overbought → neutral (${rsiSignal!.toFixed(1)})`);
        }
      }
    }

    // RSI extension handling (strong trends allow with penalty; otherwise block)
    if (direction === 'long' && rsiSignal! > 70) {
      if (preflight.h4Trend.strength === 'strong') {
        confidence -= 10;
        triggers.push(`RSI extended but strong trend allows (${rsiSignal!.toFixed(1)})`);
      } else {
        logger.warn('RSI_EXT_BLOCKED', { symbol, direction, rsi: rsiSignal!, h4Strength: preflight.h4Trend.strength });
        return null;
      }
    }
    if (direction === 'short' && rsiSignal! < 30) {
      if (preflight.h4Trend.strength === 'strong') {
        confidence -= 10;
        triggers.push(`RSI extended but strong trend allows (${rsiSignal!.toFixed(1)})`);
      } else {
        logger.warn('RSI_EXT_BLOCKED', { symbol, direction, rsi: rsiSignal!, h4Strength: preflight.h4Trend.strength });
        return null;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Entry/Order construction
    // ─────────────────────────────────────────────────────────────
    const entryPrice = entryBar.open;

    // GATE 7: Entry bar EMA200 re-check
    const ema200Entry = atIndex(ema200, entryIdx);
    if (!ema200Entry) {
      logger.warn('GATE7_BLOCKED', { symbol, reason: 'Missing EMA200 on entry bar' });
      return null;
    }
    if (direction === 'long' && entryPrice < ema200Entry) {
      logger.warn('GATE7_BLOCKED', { symbol, direction, entryPrice, ema200Entry, reason: 'Entry below EMA200' });
      return null;
    }
    if (direction === 'short' && entryPrice > ema200Entry) {
      logger.warn('GATE7_BLOCKED', { symbol, direction, entryPrice, ema200Entry, reason: 'Entry above EMA200' });
      return null;
    }

    const stopLossPrice =
      direction === 'long'
        ? emaZoneLow - atrSignal! * GATE_CONFIG.stopAtrBuffer
        : emaZoneHigh + atrSignal! * GATE_CONFIG.stopAtrBuffer;

    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice =
      direction === 'long'
        ? entryPrice + riskAmount * GATE_CONFIG.rrTarget
        : entryPrice - riskAmount * GATE_CONFIG.rrTarget;

    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;

    reasonCodes.push('RR_FAVORABLE');
    confidence += 10;

    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;

    // Diagnostics: signal breakdown (you'll use this to prove data + gates are working)
    const adxTier = adxSignal! >= 35 ? 'very-strong' : adxSignal! >= 25 ? 'strong' : 'moderate';
    logger.info('PHASE1_SIGNAL', {
      symbol,
      timestamp: signalBar.timestamp,
      direction,
      entryIdx,
      signalIdx,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      targetRR: GATE_CONFIG.rrTarget,
      adxSignal: adxSignal!,
      adxTier,
      closeRatio,
      rsiSignal: rsiSignal!,
      emaZoneWidth,
      atrSignal: atrSignal!,
      widthAtr: (emaZoneWidth / atrSignal!).toFixed(2),
      ema200Slope: slope,
      h4TrendDirection: preflight.h4Trend.direction,
      h4TrendStrength: preflight.h4Trend.strength,
      h4Adx: preflight.h4Trend.adxValue,
      confidence,
    });

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
      bars,
      atr: atrSignal ?? null,
      takeProfitConfig: {
        preferStructure: false,
        structureLookback: 60,
        rrTarget: GATE_CONFIG.rrTarget,
        atrMultiplier: GATE_CONFIG.tpAtrMultiplier,
        sessionProfile: DEFAULT_SESSION_TP_PROFILE,
      },
    });
  }
}

/**
 * CCI Zero-Line Cross Strategy - PROP-GRADE V3
 * Historical Win Rate: 55% | Historical Avg RR: 2.0
 *
 * V3 ENHANCEMENTS (3-Way AI Validation Consensus - Jan 2026):
 * 🔴 CRITICAL: EMA200 now enforced as directional gate (was required but unused!)
 * 🟡 Replaced candle color check with close-in-range momentum confirmation
 * 🟡 Replaced ATR×1.5 stops with setup-invalidation (2-bar + 0.4 ATR buffer)
 * 🟡 Added strong counter-trend hard block
 * 🟡 Added CCI slope bonus for conviction filtering
 * 🟡 TP authority aligned (preferStructure: false for deterministic TP)
 *
 * V2 FIXES (Retained):
 * - Fixed falsy check (CCI=0 was killing signals!)
 * - Added H4 trend framework
 * - minBars increased to 250
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode } from '../types.js';
import { atIndex, validateOrder, validateIndicators, buildDecision, clamp, DEFAULT_SESSION_TP_PROFILE } from '../utils.js';
import {
  runPreFlight, logPreFlight, allValidNumbers,
  isTrendAligned, getTrendConfidenceAdjustment,
} from '../SignalQualityGate.js';
import { createLogger } from '../../services/logger.js';

const logger = createLogger('CciZeroLine');

export class CciZeroLine implements IStrategy {
  meta: StrategyMeta = {
    id: 'cci-zero',
    name: 'CCI Zero-Line Cross',
    description: 'CCI zero-cross with EMA200 direction, close-in-range confirmation, setup-invalidation stops, and H4 trend context',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '8-12',
    requiredIndicators: ['bars', 'cci', 'ema200', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-24',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, cci, ema200, atr, trendBarsH4, ema200H4, adxH4 } = data;

    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    const preflight = runPreFlight({
      symbol, bars: bars || [], interval: 'H1', atr: atrVal,
      strategyType: 'momentum', minBars: 250,
      trendBarsH4, ema200H4, adxH4,
    });
    if (!preflight.passed) { logPreFlight(symbol, this.meta.id, preflight); return null; }

    if (!validateIndicators(data as Record<string, unknown>, ['bars', 'cci', 'ema200', 'atr'], 250)) return null;

    const entryIdx = bars!.length - 1;
    const signalIdx = bars!.length - 2;
    const prevIdx = bars!.length - 3;
    const prev2Idx = bars!.length - 4;
    const entryBar = bars![entryIdx];
    const signalBar = bars![signalIdx];
    const prevBar = bars![prevIdx];  // V3: Added for setup-invalidation stops

    // Early exit if prevBar undefined (defensive)
    if (!prevBar) return null;

    const cciSignal = atIndex(cci, signalIdx);
    const cciPrev = atIndex(cci, prevIdx);
    const cciPrev2 = atIndex(cci, prev2Idx);
    const emaSignal = atIndex(ema200, signalIdx);
    const atrSignal = atIndex(atr, signalIdx);

    // V2 CRITICAL FIX: Use allValidNumbers instead of falsy check
    if (!allValidNumbers(cciSignal, cciPrev, cciPrev2, emaSignal, atrSignal)) return null;

    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;

    const wasExtremeLow = cciPrev2! < -100 || cciPrev! < -100;
    const wasExtremeHigh = cciPrev2! > 100 || cciPrev! > 100;

    // V3: Calculate close-in-range for momentum confirmation
    const range = signalBar.high - signalBar.low;
    const closeRatio = range > 0 ? (signalBar.close - signalBar.low) / range : 0.5;

    // V2 FIX: Use >= and <= for zero crossing (0 is valid!)
    if (wasExtremeLow && cciPrev! <= 0 && cciSignal! >= 0 && cciSignal! !== cciPrev!) {
      direction = 'long';
      confidence += 30;
      triggers.push(`CCI crossed above zero at ${cciSignal!.toFixed(1)}`);
      reasonCodes.push('CCI_ZERO_CROSS_UP');
      triggers.push('CCI was recently in extreme oversold');

      // Deep extreme bonus
      if (cciPrev2! < -150 || cciPrev! < -150) {
        confidence += 10;
        triggers.push('CCI was deeply oversold');
      }

      // V3: Close-in-range replaces candle color check
      if (closeRatio > 0.7) {
        confidence += 15;
        triggers.push('Strong close (top 30% of range)');
        reasonCodes.push('CANDLE_CONFIRMATION');
      }

    } else if (wasExtremeHigh && cciPrev! >= 0 && cciSignal! <= 0 && cciSignal! !== cciPrev!) {
      direction = 'short';
      confidence += 30;
      triggers.push(`CCI crossed below zero at ${cciSignal!.toFixed(1)}`);
      reasonCodes.push('CCI_ZERO_CROSS_DOWN');
      triggers.push('CCI was recently in extreme overbought');

      // Deep extreme bonus
      if (cciPrev2! > 150 || cciPrev! > 150) {
        confidence += 10;
        triggers.push('CCI was deeply overbought');
      }

      // V3: Close-in-range replaces candle color check
      if (closeRatio < 0.3) {
        confidence += 15;
        triggers.push('Strong close (bottom 30% of range)');
        reasonCodes.push('CANDLE_CONFIRMATION');
      }
    }

    if (!direction) return null;

    // V3: EMA200 DIRECTIONAL HARD GATE (previously required but unused!)
    // Momentum long must be above EMA200; momentum short must be below EMA200
    if (direction === 'long' && signalBar.close <= emaSignal!) return null;
    if (direction === 'short' && signalBar.close >= emaSignal!) return null;

    if (direction === 'long') {
      triggers.push('Above EMA200 (momentum context)');
      reasonCodes.push('EMA_BULLISH_STACK');
    } else {
      triggers.push('Below EMA200 (momentum context)');
      reasonCodes.push('EMA_BEARISH_STACK');
    }

    // V3: CCI slope bonus - filters lazy crosses
    const cciDelta = Math.abs(cciSignal! - cciPrev!);
    if (cciDelta >= 10) {
      confidence += 10;
      triggers.push(`CCI momentum confirmed (delta ${cciDelta.toFixed(1)})`);
    }

    // H4 Trend handling with V3 strong counter-trend block
    if (preflight.h4Trend) {
      const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
      confidence += trendAdj;
      if (isTrendAligned(preflight.h4Trend, direction)) {
        triggers.push(`H4 trend aligned`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        triggers.push(`Counter-trend`);
        reasonCodes.push('TREND_COUNTER');
        // V3: Hard block strong counter-trend trades
        if (preflight.h4Trend.strength === 'strong') return null;
      }
    }
    confidence += preflight.confidenceAdjustments;

    const entryPrice = entryBar.open;

    // V3: Setup-invalidation stops (2-bar + 0.4 ATR buffer)
    // If price breaks the setup extreme, the momentum thesis is invalidated
    const buffer = atrSignal! * 0.4;
    let stopLossPrice: number;
    if (direction === 'long') {
      const setupLow = Math.min(signalBar.low, prevBar.low);
      stopLossPrice = setupLow - buffer;
    } else {
      const setupHigh = Math.max(signalBar.high, prevBar.high);
      stopLossPrice = setupHigh + buffer;
    }

    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const takeProfitPrice = direction === 'long'
      ? entryPrice + (riskDistance * 2)
      : entryPrice - (riskDistance * 2);

    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;

    reasonCodes.push('RR_FAVORABLE');
    confidence += 10;
    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;

    // PHASE 1 LOGGING: Capture validation data for strategy optimization
    const stopDistanceATR = riskDistance / atrSignal!;
    logger.info('PHASE1_SIGNAL', {
      symbol,
      timestamp: signalBar.timestamp,
      direction,
      entryPrice,
      stopLossPrice,
      stopDistanceATR: Math.round(stopDistanceATR * 100) / 100,
      takeProfitPrice,
      targetRR: 2.0,
      bufferUsed: 0.4,
      cciSignal: cciSignal!.toFixed(1),
      cciDelta: cciDelta.toFixed(1),
      closeRatio: closeRatio.toFixed(2),
      emaSignal: emaSignal!.toFixed(5),
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
        preferStructure: false,  // V3: Deterministic TP - no structure override
        structureLookback: 60,
        rrTarget: 2,
        atrMultiplier: 1.5,
        sessionProfile: DEFAULT_SESSION_TP_PROFILE,
      },
    });
  }
}

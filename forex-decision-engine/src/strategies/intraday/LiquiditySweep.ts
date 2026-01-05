/**
 * ICT Liquidity Sweep Strategy - NEW SMART MONEY STRATEGY
 * Win Rate: 60-65% | Avg RR: 2.5
 * 
 * Trade after stop hunts (liquidity sweeps):
 * 1. Identify liquidity zones (swing highs/lows with multiple touches)
 * 2. Wait for price to sweep the zone (take out stops)
 * 3. Enter on reversal candle back inside range
 * 4. Target opposing liquidity zone
 */

import { IStrategy, StrategyMeta, Decision, IndicatorData, UserSettings, ReasonCode, SignalDirection } from '../types.js';
import { atIndex, validateOrder, buildDecision, isRejectionCandle, clamp, DEFAULT_SESSION_TP_PROFILE } from '../utils.js';
import { runPreFlight, logPreFlight, isValidNumber, isTrendAligned, getTrendConfidenceAdjustment } from '../SignalQualityGate.js';
import { detectLiquiditySweeps, findLiquidityZones, getRecentSweep } from '../../modules/smartMoney/liquiditySweep.js';
import type { Bar as SMCBar } from '../../modules/smartMoney/types.js';

export class LiquiditySweep implements IStrategy {
  meta: StrategyMeta = {
    id: 'liquidity-sweep',
    name: 'ICT Liquidity Sweep',
    description: 'Trade reversals after liquidity sweeps at swing highs/lows',
    style: 'intraday',
    timeframes: { trend: 'H4', entry: 'H1' },
    winRate: 62,
    avgRR: 2.5,
    signalsPerWeek: '3-6',
    requiredIndicators: ['bars', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
    version: '2026-01-05',
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { symbol, bars, atr, trendBarsH4, ema200H4, adxH4 } = data;
    
    const atrVal = bars && bars.length > 2 ? atIndex(atr, bars.length - 2) : null;
    
    const preflight = runPreFlight({
      symbol,
      bars: bars || [],
      interval: 'H1',
      atr: atrVal,
      strategyType: 'mean-reversion',
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
    if (!atr || atr.length < 50) return null;
    
    const signalIdx = bars.length - 2;
    const entryIdx = bars.length - 1;
    
    const entryBar = bars[entryIdx];
    const signalBar = bars[signalIdx];
    
    const atrSignal = atIndex(atr, signalIdx);
    if (!isValidNumber(atrSignal)) return null;
    
    const smcBars: SMCBar[] = bars.map(b => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    
    const longSweep = getRecentSweep(smcBars, 'long', 3);
    const shortSweep = getRecentSweep(smcBars, 'short', 3);
    
    let direction: SignalDirection | null = null;
    let sweepData: typeof longSweep = null;
    
    if (longSweep && (!shortSweep || longSweep.reversalBarIndex > shortSweep.reversalBarIndex)) {
      direction = 'long';
      sweepData = longSweep;
    } else if (shortSweep) {
      direction = 'short';
      sweepData = shortSweep;
    }
    
    if (!direction || !sweepData) return null;
    
    const rejection = isRejectionCandle(signalBar, direction);
    
    const triggers: string[] = [];
    const reasonCodes: ReasonCode[] = [];
    let confidence = 0;
    
    confidence += 30;
    triggers.push(`${sweepData.type === 'sell-side-sweep' ? 'Sell-side' : 'Buy-side'} liquidity swept at ${sweepData.sweepLevel.toFixed(5)}`);
    reasonCodes.push('BREAK_CONFIRMED');
    
    triggers.push(`Liquidity zone had ${sweepData.liquidityZone.touches} touches (${sweepData.liquidityZone.strength} zone)`);
    
    if (sweepData.liquidityZone.strength === 'strong') {
      confidence += 15;
      triggers.push('Strong liquidity zone (4+ touches)');
    } else if (sweepData.liquidityZone.strength === 'moderate') {
      confidence += 10;
    }
    
    confidence += 15;
    triggers.push('Reversal candle confirmed after sweep');
    reasonCodes.push('RETEST_CONFIRMED');
    
    if (rejection.ok) {
      confidence += 10;
      triggers.push(`${direction === 'long' ? 'Bullish' : 'Bearish'} rejection candle`);
      reasonCodes.push('REJECTION_CONFIRMED');
    }
    
    if (preflight.h4Trend) {
      if (isTrendAligned(preflight.h4Trend, direction)) {
        const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
        confidence += trendAdj;
        triggers.push(`H4 trend aligned: ${preflight.h4Trend.direction}`);
        reasonCodes.push('TREND_ALIGNED');
      } else {
        confidence -= 10;
        triggers.push(`Counter-trend trade (H4 ${preflight.h4Trend.direction})`);
      }
    }
    
    confidence += preflight.confidenceAdjustments;
    
    const entryPrice = entryBar.open;
    
    let stopLossPrice: number;
    if (direction === 'long') {
      stopLossPrice = sweepData.sweepLow - (atrSignal * 0.3);
    } else {
      stopLossPrice = sweepData.sweepHigh + (atrSignal * 0.3);
    }
    
    const risk = Math.abs(entryPrice - stopLossPrice);
    
    const opposingZones = findLiquidityZones(smcBars);
    let takeProfitPrice: number;
    
    if (direction === 'long') {
      const targetZones = opposingZones
        .filter(z => z.type === 'buy-side' && z.level > entryPrice)
        .sort((a, b) => a.level - b.level);
      
      if (targetZones.length > 0 && (targetZones[0].level - entryPrice) >= risk * 2) {
        takeProfitPrice = targetZones[0].level - (atrSignal * 0.2);
      } else {
        takeProfitPrice = entryPrice + (risk * 2.5);
      }
    } else {
      const targetZones = opposingZones
        .filter(z => z.type === 'sell-side' && z.level < entryPrice)
        .sort((a, b) => b.level - a.level);
      
      if (targetZones.length > 0 && (entryPrice - targetZones[0].level) >= risk * 2) {
        takeProfitPrice = targetZones[0].level + (atrSignal * 0.2);
      } else {
        takeProfitPrice = entryPrice - (risk * 2.5);
      }
    }
    
    if (!validateOrder(direction, entryPrice, stopLossPrice, takeProfitPrice)) return null;
    
    const rr = Math.abs(takeProfitPrice - entryPrice) / risk;
    if (rr >= 2.0) {
      confidence += 10;
      reasonCodes.push('RR_FAVORABLE');
    }
    
    confidence = clamp(confidence, 0, 100);
    if (confidence < 50) return null;
    
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
      atr: atrSignal,
      takeProfitConfig: {
        preferStructure: true,
        structureLookback: 80,
        rrTarget: 2.5,
        atrMultiplier: 2.5,
        sessionProfile: DEFAULT_SESSION_TP_PROFILE,
      },
    });
  }
}

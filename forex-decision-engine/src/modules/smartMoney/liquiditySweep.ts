/**
 * Liquidity Sweep Detection Module
 * Identifies stop-hunt patterns where price sweeps liquidity zones then reverses
 * 
 * Liquidity Zone: Swing highs/lows with multiple touches (stop clusters)
 * Sweep: Price spikes through liquidity zone then reverses
 */

import type { Bar, LiquidityZone, LiquiditySweep, MarketStructurePoint, StructureBreak } from './types.js';

export interface LiquidityConfig {
  swingLookback: number;
  minTouches: number;
  touchTolerancePercent: number;
  lookbackBars: number;
  minSweepPercent: number;
}

const DEFAULT_CONFIG: LiquidityConfig = {
  swingLookback: 5,
  minTouches: 2,
  touchTolerancePercent: 0.05,
  lookbackBars: 100,
  minSweepPercent: 0.03,
};

export function findSwingPoints(bars: Bar[], lookback: number = 5): MarketStructurePoint[] {
  const points: MarketStructurePoint[] = [];
  
  if (bars.length < lookback * 2 + 1) return points;
  
  for (let i = lookback; i < bars.length - lookback; i++) {
    const bar = bars[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= bar.high) isSwingHigh = false;
      if (bars[j].low <= bar.low) isSwingLow = false;
    }
    
    if (isSwingHigh) {
      points.push({
        type: 'swing-high',
        price: bar.high,
        barIndex: i,
        timestamp: bar.timestamp,
        broken: false,
      });
    }
    
    if (isSwingLow) {
      points.push({
        type: 'swing-low',
        price: bar.low,
        barIndex: i,
        timestamp: bar.timestamp,
        broken: false,
      });
    }
  }
  
  return points;
}

export function findLiquidityZones(
  bars: Bar[],
  config: Partial<LiquidityConfig> = {}
): LiquidityZone[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const zones: LiquidityZone[] = [];
  
  if (bars.length < cfg.lookbackBars) return zones;
  
  const startIdx = Math.max(0, bars.length - cfg.lookbackBars);
  const swingPoints = findSwingPoints(bars.slice(startIdx), cfg.swingLookback);
  
  const groupedHighs: Map<number, { level: number; indices: number[] }> = new Map();
  const groupedLows: Map<number, { level: number; indices: number[] }> = new Map();
  
  for (const point of swingPoints) {
    const tolerance = point.price * (cfg.touchTolerancePercent / 100);
    const roundedPrice = Math.round(point.price / tolerance) * tolerance;
    
    if (point.type === 'swing-high') {
      const existing = groupedHighs.get(roundedPrice);
      if (existing) {
        existing.indices.push(point.barIndex + startIdx);
      } else {
        groupedHighs.set(roundedPrice, { level: point.price, indices: [point.barIndex + startIdx] });
      }
    } else {
      const existing = groupedLows.get(roundedPrice);
      if (existing) {
        existing.indices.push(point.barIndex + startIdx);
      } else {
        groupedLows.set(roundedPrice, { level: point.price, indices: [point.barIndex + startIdx] });
      }
    }
  }
  
  for (const [, group] of groupedHighs) {
    if (group.indices.length >= cfg.minTouches) {
      zones.push({
        type: 'buy-side',
        level: group.level,
        touches: group.indices.length,
        barIndices: group.indices,
        strength: group.indices.length >= 4 ? 'strong' : group.indices.length >= 3 ? 'moderate' : 'weak',
        swept: false,
      });
    }
  }
  
  for (const [, group] of groupedLows) {
    if (group.indices.length >= cfg.minTouches) {
      zones.push({
        type: 'sell-side',
        level: group.level,
        touches: group.indices.length,
        barIndices: group.indices,
        strength: group.indices.length >= 4 ? 'strong' : group.indices.length >= 3 ? 'moderate' : 'weak',
        swept: false,
      });
    }
  }
  
  return zones;
}

export function detectLiquiditySweeps(
  bars: Bar[],
  config: Partial<LiquidityConfig> = {}
): LiquiditySweep[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const zones = findLiquidityZones(bars, config);
  const sweeps: LiquiditySweep[] = [];
  
  if (bars.length < 3) return sweeps;
  
  for (let i = bars.length - 10; i < bars.length - 1; i++) {
    if (i < 0) continue;
    
    const bar = bars[i];
    const nextBar = bars[i + 1];
    
    for (const zone of zones) {
      if (zone.swept) continue;
      
      const tolerance = zone.level * (cfg.minSweepPercent / 100);
      
      if (zone.type === 'buy-side') {
        if (bar.high > zone.level && nextBar.close < zone.level) {
          const sweepMagnitude = bar.high - zone.level;
          if (sweepMagnitude >= tolerance) {
            zone.swept = true;
            zone.sweepBarIndex = i;
            
            sweeps.push({
              type: 'buy-side-sweep',
              sweepLevel: zone.level,
              sweepHigh: bar.high,
              sweepLow: bar.low,
              reversalBar: nextBar,
              reversalBarIndex: i + 1,
              magnitude: sweepMagnitude,
              liquidityZone: zone,
            });
          }
        }
      } else {
        if (bar.low < zone.level && nextBar.close > zone.level) {
          const sweepMagnitude = zone.level - bar.low;
          if (sweepMagnitude >= tolerance) {
            zone.swept = true;
            zone.sweepBarIndex = i;
            
            sweeps.push({
              type: 'sell-side-sweep',
              sweepLevel: zone.level,
              sweepHigh: bar.high,
              sweepLow: bar.low,
              reversalBar: nextBar,
              reversalBarIndex: i + 1,
              magnitude: sweepMagnitude,
              liquidityZone: zone,
            });
          }
        }
      }
    }
  }
  
  return sweeps;
}

export function findStructureBreaks(
  bars: Bar[],
  lookback: number = 20
): StructureBreak[] {
  const breaks: StructureBreak[] = [];
  const swingPoints = findSwingPoints(bars, 3);
  
  if (swingPoints.length < 2) return breaks;
  
  const startIdx = Math.max(0, bars.length - lookback);
  
  for (let i = startIdx; i < bars.length; i++) {
    const bar = bars[i];
    
    const recentHighs = swingPoints.filter(p => 
      p.type === 'swing-high' && 
      p.barIndex < i && 
      p.barIndex >= i - 20
    ).sort((a, b) => b.price - a.price);
    
    const recentLows = swingPoints.filter(p => 
      p.type === 'swing-low' && 
      p.barIndex < i && 
      p.barIndex >= i - 20
    ).sort((a, b) => a.price - b.price);
    
    if (recentHighs.length > 0) {
      const highestHigh = recentHighs[0];
      if (!highestHigh.broken && bar.close > highestHigh.price) {
        highestHigh.broken = true;
        
        const prevTrend = detectPreviousTrend(bars, i, 10);
        
        breaks.push({
          type: prevTrend === 'bearish' ? 'CHOCH' : 'BOS',
          direction: 'bullish',
          brokenLevel: highestHigh.price,
          breakBarIndex: i,
          timestamp: bar.timestamp,
          previousStructure: highestHigh,
        });
      }
    }
    
    if (recentLows.length > 0) {
      const lowestLow = recentLows[0];
      if (!lowestLow.broken && bar.close < lowestLow.price) {
        lowestLow.broken = true;
        
        const prevTrend = detectPreviousTrend(bars, i, 10);
        
        breaks.push({
          type: prevTrend === 'bullish' ? 'CHOCH' : 'BOS',
          direction: 'bearish',
          brokenLevel: lowestLow.price,
          breakBarIndex: i,
          timestamp: bar.timestamp,
          previousStructure: lowestLow,
        });
      }
    }
  }
  
  return breaks;
}

function detectPreviousTrend(bars: Bar[], currentIdx: number, lookback: number): 'bullish' | 'bearish' | 'neutral' {
  const startIdx = Math.max(0, currentIdx - lookback);
  const slice = bars.slice(startIdx, currentIdx);
  
  if (slice.length < 3) return 'neutral';
  
  const firstClose = slice[0].close;
  const lastClose = slice[slice.length - 1].close;
  const change = (lastClose - firstClose) / firstClose;
  
  if (change > 0.002) return 'bullish';
  if (change < -0.002) return 'bearish';
  return 'neutral';
}

export function getRecentSweep(
  bars: Bar[],
  direction: 'long' | 'short',
  maxAgeBars: number = 5
): LiquiditySweep | null {
  const sweeps = detectLiquiditySweeps(bars);
  
  const relevantSweeps = sweeps.filter(s => {
    const age = bars.length - 1 - s.reversalBarIndex;
    if (age > maxAgeBars) return false;
    
    if (direction === 'long') {
      return s.type === 'sell-side-sweep';
    } else {
      return s.type === 'buy-side-sweep';
    }
  });
  
  if (relevantSweeps.length === 0) return null;
  
  return relevantSweeps.sort((a, b) => b.reversalBarIndex - a.reversalBarIndex)[0];
}

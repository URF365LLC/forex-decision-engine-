/**
 * Fair Value Gap (FVG) Detection Module
 * Identifies price imbalances that tend to get filled
 * 
 * Bullish FVG: Gap between candle 1's high and candle 3's low (price moved up fast)
 * Bearish FVG: Gap between candle 1's low and candle 3's high (price moved down fast)
 */

import type { Bar, FairValueGap } from './types.js';

export interface FVGConfig {
  minGapSizePercent: number;
  lookbackBars: number;
  maxFVGAge: number;
}

const DEFAULT_CONFIG: FVGConfig = {
  minGapSizePercent: 0.05,
  lookbackBars: 50,
  maxFVGAge: 100,
};

export function findFairValueGaps(
  bars: Bar[],
  direction: 'bullish' | 'bearish' | 'both' = 'both',
  config: Partial<FVGConfig> = {}
): FairValueGap[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  if (bars.length < 5) {
    return [];
  }
  
  const fairValueGaps: FairValueGap[] = [];
  const startIdx = Math.max(2, bars.length - cfg.maxFVGAge);
  
  for (let i = startIdx; i < bars.length - 2; i++) {
    const bar1 = bars[i - 2];
    const bar2 = bars[i - 1];
    const bar3 = bars[i];
    
    if (!bar1 || !bar2 || !bar3) continue;
    
    const price = bar2.close;
    const minGapSize = price * (cfg.minGapSizePercent / 100);
    
    if (direction === 'bullish' || direction === 'both') {
      const fvg = detectBullishFVG(bar1, bar2, bar3, i - 2, minGapSize, price);
      if (fvg) {
        const { filled, fillPercent } = checkFVGFill(bars, fvg, i);
        fvg.filled = filled;
        fvg.fillPercent = fillPercent;
        fairValueGaps.push(fvg);
      }
    }
    
    if (direction === 'bearish' || direction === 'both') {
      const fvg = detectBearishFVG(bar1, bar2, bar3, i - 2, minGapSize, price);
      if (fvg) {
        const { filled, fillPercent } = checkFVGFill(bars, fvg, i);
        fvg.filled = filled;
        fvg.fillPercent = fillPercent;
        fairValueGaps.push(fvg);
      }
    }
  }
  
  return fairValueGaps.filter(fvg => !fvg.filled);
}

function detectBullishFVG(
  bar1: Bar,
  bar2: Bar,
  bar3: Bar,
  startIndex: number,
  minGapSize: number,
  price: number
): FairValueGap | null {
  const gapLow = bar1.high;
  const gapHigh = bar3.low;
  
  if (gapHigh <= gapLow) return null;
  
  const gapSize = gapHigh - gapLow;
  if (gapSize < minGapSize) return null;
  
  const gapSizePercent = (gapSize / price) * 100;
  
  return {
    type: 'bullish',
    high: gapHigh,
    low: gapLow,
    midpoint: (gapHigh + gapLow) / 2,
    gapSize,
    gapSizePercent,
    startIndex,
    timestamp: bar1.timestamp,
    filled: false,
    fillPercent: 0,
  };
}

function detectBearishFVG(
  bar1: Bar,
  bar2: Bar,
  bar3: Bar,
  startIndex: number,
  minGapSize: number,
  price: number
): FairValueGap | null {
  const gapHigh = bar1.low;
  const gapLow = bar3.high;
  
  if (gapHigh <= gapLow) return null;
  
  const gapSize = gapHigh - gapLow;
  if (gapSize < minGapSize) return null;
  
  const gapSizePercent = (gapSize / price) * 100;
  
  return {
    type: 'bearish',
    high: gapHigh,
    low: gapLow,
    midpoint: (gapHigh + gapLow) / 2,
    gapSize,
    gapSizePercent,
    startIndex,
    timestamp: bar1.timestamp,
    filled: false,
    fillPercent: 0,
  };
}

function checkFVGFill(
  bars: Bar[],
  fvg: FairValueGap,
  fvgEndIdx: number
): { filled: boolean; fillPercent: number } {
  let maxFillPercent = 0;
  
  for (let i = fvgEndIdx + 1; i < bars.length; i++) {
    const bar = bars[i];
    
    if (fvg.type === 'bullish') {
      if (bar.low <= fvg.midpoint) {
        const fillAmount = fvg.high - Math.max(bar.low, fvg.low);
        const fillPercent = Math.min(100, (fillAmount / fvg.gapSize) * 100);
        maxFillPercent = Math.max(maxFillPercent, fillPercent);
        
        if (bar.low <= fvg.low) {
          return { filled: true, fillPercent: 100 };
        }
      }
    } else {
      if (bar.high >= fvg.midpoint) {
        const fillAmount = Math.min(bar.high, fvg.high) - fvg.low;
        const fillPercent = Math.min(100, (fillAmount / fvg.gapSize) * 100);
        maxFillPercent = Math.max(maxFillPercent, fillPercent);
        
        if (bar.high >= fvg.high) {
          return { filled: true, fillPercent: 100 };
        }
      }
    }
  }
  
  return { filled: false, fillPercent: maxFillPercent };
}

export function isPriceInFVG(price: number, fvg: FairValueGap): boolean {
  return price >= fvg.low && price <= fvg.high;
}

export function findNearestFVG(
  currentPrice: number,
  fvgs: FairValueGap[],
  direction: 'bullish' | 'bearish'
): FairValueGap | null {
  const relevantFVGs = fvgs.filter(fvg => {
    if (direction === 'bullish') {
      return fvg.type === 'bullish' && currentPrice > fvg.high;
    } else {
      return fvg.type === 'bearish' && currentPrice < fvg.low;
    }
  });
  
  if (relevantFVGs.length === 0) return null;
  
  relevantFVGs.sort((a, b) => {
    const distA = direction === 'bullish'
      ? currentPrice - a.high
      : a.low - currentPrice;
    const distB = direction === 'bullish'
      ? currentPrice - b.high
      : b.low - currentPrice;
    return distA - distB;
  });
  
  return relevantFVGs[0];
}

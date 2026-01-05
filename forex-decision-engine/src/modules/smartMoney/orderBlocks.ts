/**
 * Order Block Detection Module
 * Identifies institutional order blocks based on ICT methodology
 * 
 * Order Block: The last opposing candle before a significant impulsive move (>2 ATR)
 * These zones represent areas where institutions placed orders
 */

import type { Bar, OrderBlock } from './types.js';

export interface OrderBlockConfig {
  minImpulseATRMultiple: number;
  lookbackBars: number;
  maxOrderBlockAge: number;
}

const DEFAULT_CONFIG: OrderBlockConfig = {
  minImpulseATRMultiple: 2.0,
  lookbackBars: 50,
  maxOrderBlockAge: 100,
};

function calculateATR(bars: Bar[], period: number = 14): number[] {
  const atrValues: number[] = [];
  
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      atrValues.push(bars[i].high - bars[i].low);
      continue;
    }
    
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    
    if (i < period) {
      atrValues.push(tr);
    } else {
      const prevATR = atrValues[i - 1];
      atrValues.push((prevATR * (period - 1) + tr) / period);
    }
  }
  
  return atrValues;
}

function isBullishCandle(bar: Bar): boolean {
  return bar.close > bar.open;
}

function isBearishCandle(bar: Bar): boolean {
  return bar.close < bar.open;
}

function getCandleBody(bar: Bar): number {
  return Math.abs(bar.close - bar.open);
}

export function findOrderBlocks(
  bars: Bar[],
  direction: 'bullish' | 'bearish' | 'both' = 'both',
  config: Partial<OrderBlockConfig> = {}
): OrderBlock[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  if (bars.length < cfg.lookbackBars) {
    return [];
  }
  
  const atr = calculateATR(bars);
  const orderBlocks: OrderBlock[] = [];
  const startIdx = Math.max(0, bars.length - cfg.maxOrderBlockAge);
  
  for (let i = startIdx + 3; i < bars.length - 1; i++) {
    const currentATR = atr[i] || atr[atr.length - 1];
    const minImpulse = currentATR * cfg.minImpulseATRMultiple;
    
    if (direction === 'bullish' || direction === 'both') {
      const ob = detectBullishOrderBlock(bars, i, minImpulse);
      if (ob) {
        const mitigated = checkMitigation(bars, ob, i);
        ob.mitigated = mitigated;
        orderBlocks.push(ob);
      }
    }
    
    if (direction === 'bearish' || direction === 'both') {
      const ob = detectBearishOrderBlock(bars, i, minImpulse);
      if (ob) {
        const mitigated = checkMitigation(bars, ob, i);
        ob.mitigated = mitigated;
        orderBlocks.push(ob);
      }
    }
  }
  
  return orderBlocks.filter(ob => !ob.mitigated);
}

function detectBullishOrderBlock(bars: Bar[], impulseStartIdx: number, minImpulse: number): OrderBlock | null {
  const impulseBar = bars[impulseStartIdx];
  const prevBar = bars[impulseStartIdx - 1];
  const nextBar = bars[impulseStartIdx + 1];
  
  if (!impulseBar || !prevBar || !nextBar) return null;
  
  const impulseMove = nextBar.close - prevBar.close;
  if (impulseMove < minImpulse) return null;
  
  let obBarIdx = impulseStartIdx - 1;
  for (let j = impulseStartIdx - 1; j >= Math.max(0, impulseStartIdx - 3); j--) {
    if (isBearishCandle(bars[j])) {
      obBarIdx = j;
      break;
    }
  }
  
  const obBar = bars[obBarIdx];
  if (!obBar || !isBearishCandle(obBar)) return null;
  
  const bodySize = getCandleBody(obBar);
  const avgBody = bars.slice(Math.max(0, obBarIdx - 10), obBarIdx)
    .reduce((sum, b) => sum + getCandleBody(b), 0) / 10;
  
  let strength: 'strong' | 'moderate' | 'weak' = 'weak';
  if (bodySize > avgBody * 1.5 && impulseMove > minImpulse * 1.5) strength = 'strong';
  else if (bodySize > avgBody || impulseMove > minImpulse * 1.2) strength = 'moderate';
  
  return {
    type: 'bullish',
    high: obBar.high,
    low: obBar.low,
    midpoint: (obBar.high + obBar.low) / 2,
    barIndex: obBarIdx,
    timestamp: obBar.timestamp,
    strength,
    impulseMagnitude: impulseMove,
    touched: false,
    mitigated: false,
  };
}

function detectBearishOrderBlock(bars: Bar[], impulseStartIdx: number, minImpulse: number): OrderBlock | null {
  const impulseBar = bars[impulseStartIdx];
  const prevBar = bars[impulseStartIdx - 1];
  const nextBar = bars[impulseStartIdx + 1];
  
  if (!impulseBar || !prevBar || !nextBar) return null;
  
  const impulseMove = prevBar.close - nextBar.close;
  if (impulseMove < minImpulse) return null;
  
  let obBarIdx = impulseStartIdx - 1;
  for (let j = impulseStartIdx - 1; j >= Math.max(0, impulseStartIdx - 3); j--) {
    if (isBullishCandle(bars[j])) {
      obBarIdx = j;
      break;
    }
  }
  
  const obBar = bars[obBarIdx];
  if (!obBar || !isBullishCandle(obBar)) return null;
  
  const bodySize = getCandleBody(obBar);
  const avgBody = bars.slice(Math.max(0, obBarIdx - 10), obBarIdx)
    .reduce((sum, b) => sum + getCandleBody(b), 0) / 10;
  
  let strength: 'strong' | 'moderate' | 'weak' = 'weak';
  if (bodySize > avgBody * 1.5 && impulseMove > minImpulse * 1.5) strength = 'strong';
  else if (bodySize > avgBody || impulseMove > minImpulse * 1.2) strength = 'moderate';
  
  return {
    type: 'bearish',
    high: obBar.high,
    low: obBar.low,
    midpoint: (obBar.high + obBar.low) / 2,
    barIndex: obBarIdx,
    timestamp: obBar.timestamp,
    strength,
    impulseMagnitude: impulseMove,
    touched: false,
    mitigated: false,
  };
}

function checkMitigation(bars: Bar[], ob: OrderBlock, obFoundIdx: number): boolean {
  for (let i = obFoundIdx + 1; i < bars.length; i++) {
    if (ob.type === 'bullish') {
      if (bars[i].close < ob.low) return true;
    } else {
      if (bars[i].close > ob.high) return true;
    }
  }
  return false;
}

export function isPriceInOrderBlock(price: number, ob: OrderBlock): boolean {
  return price >= ob.low && price <= ob.high;
}

export function findNearestOrderBlock(
  currentPrice: number,
  orderBlocks: OrderBlock[],
  direction: 'bullish' | 'bearish'
): OrderBlock | null {
  const relevantOBs = orderBlocks.filter(ob => {
    if (direction === 'bullish') {
      return ob.type === 'bullish' && currentPrice > ob.high;
    } else {
      return ob.type === 'bearish' && currentPrice < ob.low;
    }
  });
  
  if (relevantOBs.length === 0) return null;
  
  relevantOBs.sort((a, b) => {
    const distA = direction === 'bullish' 
      ? currentPrice - a.high 
      : a.low - currentPrice;
    const distB = direction === 'bullish'
      ? currentPrice - b.high
      : b.low - currentPrice;
    return distA - distB;
  });
  
  return relevantOBs[0];
}

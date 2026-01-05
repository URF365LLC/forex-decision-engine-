/**
 * Smart Money Concepts (SMC) Type Definitions
 * Based on ICT methodology and institutional trading patterns
 */

export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBlock {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  midpoint: number;
  barIndex: number;
  timestamp: string;
  strength: 'strong' | 'moderate' | 'weak';
  impulseMagnitude: number;
  touched: boolean;
  mitigated: boolean;
}

export interface FairValueGap {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  midpoint: number;
  gapSize: number;
  gapSizePercent: number;
  startIndex: number;
  timestamp: string;
  filled: boolean;
  fillPercent: number;
}

export interface LiquidityZone {
  type: 'buy-side' | 'sell-side';
  level: number;
  touches: number;
  barIndices: number[];
  strength: 'strong' | 'moderate' | 'weak';
  swept: boolean;
  sweepBarIndex?: number;
}

export interface LiquiditySweep {
  type: 'buy-side-sweep' | 'sell-side-sweep';
  sweepLevel: number;
  sweepHigh: number;
  sweepLow: number;
  reversalBar: Bar;
  reversalBarIndex: number;
  magnitude: number;
  liquidityZone: LiquidityZone;
}

export interface MarketStructurePoint {
  type: 'swing-high' | 'swing-low';
  price: number;
  barIndex: number;
  timestamp: string;
  broken: boolean;
}

export interface StructureBreak {
  type: 'BOS' | 'CHOCH';
  direction: 'bullish' | 'bearish';
  brokenLevel: number;
  breakBarIndex: number;
  timestamp: string;
  previousStructure: MarketStructurePoint;
}

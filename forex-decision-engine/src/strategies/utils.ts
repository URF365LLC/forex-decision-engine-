/**
 * UDO Multi-Strategy System - Shared Utilities
 * Version: 2025-12-29
 * 
 * IMPORTANT: Indicator arrays must be generated 1:1 with bars length, aligned by bar index.
 * Use atIndex() for aligned access - it only works if indicator.length === bars.length.
 */

import { 
  Bar, 
  Decision, 
  SignalDirection, 
  SignalGrade, 
  UserSettings, 
  RequiredIndicator,
  ReasonCode,
  getPipInfo, 
  formatPrice, 
  calculatePips 
} from './types.js';

export function latest<T>(arr: T[] | undefined): T | null {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1];
}

export function atIndex<T>(arr: T[] | undefined, idx: number): T | null {
  if (!arr || idx < 0 || idx >= arr.length) return null;
  return arr[idx];
}

export function safeDiv(n: number, d: number, fallback = 0): number {
  return d === 0 ? fallback : n / d;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function validateOrder(
  direction: 'long' | 'short',
  entry: number,
  sl: number,
  tp: number
): boolean {
  if (![entry, sl, tp].every(n => typeof n === 'number' && Number.isFinite(n))) return false;
  if (direction === 'long') return sl < entry && tp > entry;
  return sl > entry && tp < entry;
}

export function isRejectionCandle(
  bar: Bar,
  direction: 'long' | 'short',
  minWickRatio = 0.5,
  maxBodyRatio = 0.5
): { ok: boolean; wickRatio: number; bodyRatio: number } {
  const range = bar.high - bar.low;
  if (range <= 0) return { ok: false, wickRatio: 0, bodyRatio: 0 };

  const body = Math.abs(bar.close - bar.open);
  const bodyRatio = safeDiv(body, range, 1);

  if (direction === 'long') {
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const wickRatio = safeDiv(lowerWick, range, 0);
    const ok = wickRatio >= minWickRatio && bodyRatio <= maxBodyRatio && bar.close > bar.open;
    return { ok, wickRatio, bodyRatio };
  } else {
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const wickRatio = safeDiv(upperWick, range, 0);
    const ok = wickRatio >= minWickRatio && bodyRatio <= maxBodyRatio && bar.close < bar.open;
    return { ok, wickRatio, bodyRatio };
  }
}

export function normalizedSlope(series: number[] | undefined, lookback: number): number {
  if (!series || series.length < lookback + 1) return 0;
  const end = series[series.length - 1];
  const start = series[series.length - 1 - lookback];
  if (!Number.isFinite(end) || !Number.isFinite(start) || start === 0) return 0;

  const raw = end - start;
  const pct = raw / start;
  return pct / lookback;
}

export function validateIndicators(
  data: Record<string, unknown>,
  required: RequiredIndicator[],
  minBars: number = 50
): boolean {
  if (!data.bars || !Array.isArray(data.bars) || data.bars.length < minBars) {
    return false;
  }
  
  for (const ind of required) {
    if (ind === 'bars') continue;
    const indicator = data[ind];
    if (!indicator || !Array.isArray(indicator)) return false;
    if (indicator.length < minBars) return false;
    if (indicator.length !== (data.bars as unknown[]).length) {
      console.warn(`Indicator ${ind} length mismatch: ${indicator.length} vs ${(data.bars as unknown[]).length} bars`);
    }
  }
  return true;
}

export function calculateGrade(confidence: number): SignalGrade {
  if (confidence >= 90) return 'A+';
  if (confidence >= 80) return 'A';
  if (confidence >= 70) return 'B+';
  if (confidence >= 60) return 'B';
  if (confidence >= 50) return 'C';
  return 'no-trade';
}

export function calculatePositionSize(
  symbol: string,
  accountSize: number,
  riskPercent: number,
  stopLossPips: number,
  entryPrice: number
): { lots: number; units: number; riskAmount: number; isApproximate: boolean } {
  const riskAmount = accountSize * (riskPercent / 100);
  const { pipValue } = getPipInfo(symbol);
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BNB', 'BCH', 'LTC'].some(c => symbol.includes(c));
  
  let units: number;
  if (isCrypto) {
    units = riskAmount / (stopLossPips * pipValue);
  } else {
    units = riskAmount / (stopLossPips * pipValue);
  }
  
  const lots = units / 100000;
  const isApproximate = !isCrypto;
  
  return { 
    lots: Math.round(lots * 100) / 100, 
    units: Math.round(units), 
    riskAmount: Math.round(riskAmount * 100) / 100,
    isApproximate
  };
}

export interface DecisionParams {
  symbol: string;
  strategyId: string;
  strategyName: string;
  direction: SignalDirection;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  triggers: string[];
  reasonCodes: ReasonCode[];
  settings: UserSettings;
}

export function buildDecision(params: DecisionParams): Decision {
  const {
    symbol,
    strategyId,
    strategyName,
    direction,
    confidence,
    entryPrice,
    stopLoss,
    takeProfit,
    triggers,
    reasonCodes,
    settings,
  } = params;

  const grade = calculateGrade(confidence);
  const { pipSize, digits } = getPipInfo(symbol);
  
  const stopLossPips = Math.abs(entryPrice - stopLoss) / pipSize;
  const takeProfitPips = Math.abs(takeProfit - entryPrice) / pipSize;
  const rr = safeDiv(takeProfitPips, stopLossPips, 0);
  
  const position = calculatePositionSize(
    symbol,
    settings.accountSize,
    settings.riskPercent,
    stopLossPips,
    entryPrice
  );
  
  const warnings: string[] = [];
  if (position.isApproximate) {
    warnings.push('Lot size is approximate - verify with broker');
  }

  const now = new Date();
  const validUntil = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  return {
    symbol,
    displayName: symbol,
    strategyId,
    strategyName,
    direction,
    grade,
    confidence,
    entryPrice,
    entryZone: null,
    stopLoss: {
      price: stopLoss,
      pips: Math.round(stopLossPips * 10) / 10,
      formatted: formatPrice(stopLoss, symbol),
    },
    takeProfit: {
      price: takeProfit,
      pips: Math.round(takeProfitPips * 10) / 10,
      rr: Math.round(rr * 10) / 10,
      formatted: formatPrice(takeProfit, symbol),
    },
    position,
    reason: triggers.join('. '),
    triggers,
    reasonCodes,
    warnings,
    style: settings.style,
    executionModel: 'NEXT_OPEN',
    timeframes: { trend: 'daily', entry: '60min' },
    timestamp: now.toISOString(),
    validUntil: validUntil.toISOString(),
  };
}

/**
 * UDO Multi-Strategy System - Shared Utilities
 * Version: 1.0.0
 * 
 * Helper functions used by all strategy implementations.
 */

import {
  Bar,
  Decision,
  SignalDirection,
  SignalGrade,
  UserSettings,
  PipInfo,
  getPipInfo,
  formatPrice,
  calculatePips,
  TradingStyle,
} from './types';

// ═══════════════════════════════════════════════════════════════
// ARRAY HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Get the most recent value from an indicator array
 */
export function latest<T>(arr: T[] | undefined): T | null {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1];
}

/**
 * Get a previous value (0 = current, 1 = previous, etc.)
 */
export function previous<T>(arr: T[] | undefined, barsBack: number): T | null {
  if (!arr || arr.length <= barsBack) return null;
  return arr[arr.length - 1 - barsBack];
}

/**
 * Get the last N values from an array
 */
export function lastN<T>(arr: T[] | undefined, n: number): T[] {
  if (!arr || arr.length === 0) return [];
  return arr.slice(-n);
}

// ═══════════════════════════════════════════════════════════════
// CROSSOVER DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Check if fast crossed above slow (bullish crossover)
 */
export function crossedAbove(
  fast: number[] | undefined,
  slow: number[] | undefined
): boolean {
  if (!fast || !slow || fast.length < 2 || slow.length < 2) return false;
  
  const fastNow = fast[fast.length - 1];
  const fastPrev = fast[fast.length - 2];
  const slowNow = slow[slow.length - 1];
  const slowPrev = slow[slow.length - 2];
  
  return fastPrev <= slowPrev && fastNow > slowNow;
}

/**
 * Check if fast crossed below slow (bearish crossover)
 */
export function crossedBelow(
  fast: number[] | undefined,
  slow: number[] | undefined
): boolean {
  if (!fast || !slow || fast.length < 2 || slow.length < 2) return false;
  
  const fastNow = fast[fast.length - 1];
  const fastPrev = fast[fast.length - 2];
  const slowNow = slow[slow.length - 1];
  const slowPrev = slow[slow.length - 2];
  
  return fastPrev >= slowPrev && fastNow < slowNow;
}

// ═══════════════════════════════════════════════════════════════
// TREND HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate slope of an indicator over N periods
 */
export function calculateSlope(arr: number[] | undefined, periods: number = 3): number {
  if (!arr || arr.length < periods + 1) return 0;
  
  const recent = arr[arr.length - 1];
  const past = arr[arr.length - 1 - periods];
  
  return (recent - past) / periods;
}

/**
 * Check if indicator is rising
 */
export function isRising(arr: number[] | undefined, periods: number = 3): boolean {
  return calculateSlope(arr, periods) > 0;
}

/**
 * Check if indicator is falling
 */
export function isFalling(arr: number[] | undefined, periods: number = 3): boolean {
  return calculateSlope(arr, periods) < 0;
}

/**
 * Check if price is above EMA (bullish trend)
 */
export function priceAboveEma(bars: Bar[], ema: number[] | undefined): boolean {
  if (!ema || ema.length === 0 || bars.length === 0) return false;
  const price = bars[bars.length - 1].close;
  const emaValue = ema[ema.length - 1];
  return price > emaValue;
}

/**
 * Check if price is below EMA (bearish trend)
 */
export function priceBelowEma(bars: Bar[], ema: number[] | undefined): boolean {
  if (!ema || ema.length === 0 || bars.length === 0) return false;
  const price = bars[bars.length - 1].close;
  const emaValue = ema[ema.length - 1];
  return price < emaValue;
}

// ═══════════════════════════════════════════════════════════════
// SWING HIGH/LOW DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Find the most recent swing high within lookback period
 */
export function findSwingHigh(bars: Bar[], lookback: number = 10): number {
  if (bars.length === 0) return 0;
  
  const recentBars = bars.slice(-lookback);
  return Math.max(...recentBars.map(b => b.high));
}

/**
 * Find the most recent swing low within lookback period
 */
export function findSwingLow(bars: Bar[], lookback: number = 10): number {
  if (bars.length === 0) return 0;
  
  const recentBars = bars.slice(-lookback);
  return Math.min(...recentBars.map(b => b.low));
}

// ═══════════════════════════════════════════════════════════════
// POSITION SIZING
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate position size based on risk
 */
export function calculatePositionSize(
  accountSize: number,
  riskPercent: number,
  entryPrice: number,
  stopLossPrice: number,
  symbol: string
): { lots: number; units: number; riskAmount: number } {
  const riskAmount = accountSize * (riskPercent / 100);
  const pipInfo = getPipInfo(symbol);
  const stopPips = calculatePips(entryPrice, stopLossPrice, symbol);
  
  if (stopPips === 0) {
    return { lots: 0, units: 0, riskAmount };
  }
  
  // For forex: 1 standard lot = 100,000 units, 1 pip = $10 for most pairs
  // For crypto: position in units of the crypto
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BCH', 'BNB', 'LTC'].some(c => symbol.includes(c));
  
  if (isCrypto) {
    const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
    const units = riskAmount / riskPerUnit;
    return { lots: units, units, riskAmount };
  } else {
    // Forex lot calculation
    const pipValuePerLot = symbol.includes('JPY') ? 1000 : 10; // Approximate
    const lots = riskAmount / (stopPips * pipValuePerLot);
    const roundedLots = Math.floor(lots * 100) / 100; // Round down to 0.01
    return { lots: roundedLots, units: roundedLots * 100000, riskAmount };
  }
}

// ═══════════════════════════════════════════════════════════════
// GRADING SYSTEM
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate grade based on confidence score
 */
export function calculateGrade(confidence: number): SignalGrade {
  if (confidence >= 90) return 'A+';
  if (confidence >= 80) return 'A';
  if (confidence >= 70) return 'B+';
  if (confidence >= 60) return 'B';
  if (confidence >= 50) return 'C';
  return 'no-trade';
}

// ═══════════════════════════════════════════════════════════════
// DECISION BUILDER
// ═══════════════════════════════════════════════════════════════

export interface DecisionParams {
  symbol: string;
  strategyId: string;
  strategyName: string;
  direction: SignalDirection;
  confidence: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  reason: string;
  triggers: string[];
  warnings?: string[];
  settings: UserSettings;
}

/**
 * Build a complete Decision object
 */
export function buildDecision(params: DecisionParams): Decision {
  const {
    symbol,
    strategyId,
    strategyName,
    direction,
    confidence,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    reason,
    triggers,
    warnings = [],
    settings,
  } = params;
  
  const pipInfo = getPipInfo(symbol);
  const grade = calculateGrade(confidence);
  
  // Calculate pips
  const stopPips = calculatePips(entryPrice, stopLossPrice, symbol);
  const tpPips = calculatePips(entryPrice, takeProfitPrice, symbol);
  const rr = stopPips > 0 ? tpPips / stopPips : 0;
  
  // Position sizing
  const position = calculatePositionSize(
    settings.accountSize,
    settings.riskPercent,
    entryPrice,
    stopLossPrice,
    symbol
  );
  
  // Format display name
  const displayName = symbol.replace('USD', '/USD').replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2');
  
  // Timeframes based on style
  const timeframes = settings.style === 'intraday'
    ? { trend: 'D1', entry: 'H1' }
    : { trend: 'D1', entry: 'H4' };
  
  // Valid until (4 candles for intraday, 6 for swing)
  const validHours = settings.style === 'intraday' ? 4 : 24;
  const validUntil = new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString();
  
  return {
    symbol,
    displayName,
    strategyId,
    strategyName,
    direction,
    grade,
    confidence,
    entryZone: {
      low: entryPrice * 0.9998,  // Slight zone
      high: entryPrice * 1.0002,
      formatted: formatPrice(entryPrice, symbol),
    },
    stopLoss: {
      price: stopLossPrice,
      pips: Math.round(stopPips),
      formatted: formatPrice(stopLossPrice, symbol),
    },
    takeProfit: {
      price: takeProfitPrice,
      pips: Math.round(tpPips),
      rr: Math.round(rr * 10) / 10,
      formatted: formatPrice(takeProfitPrice, symbol),
    },
    position,
    reason,
    triggers,
    warnings,
    style: settings.style,
    timeframes,
    timestamp: new Date().toISOString(),
    validUntil,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Check if we have enough data for analysis
 */
export function hasEnoughData(
  arr: unknown[] | undefined,
  minLength: number
): boolean {
  return arr !== undefined && arr.length >= minLength;
}

/**
 * Validate all required indicators are present
 */
export function validateIndicators(
  data: Record<string, unknown>,
  required: string[],
  minBars: number = 50
): boolean {
  for (const key of required) {
    if (key === 'bars') {
      if (!hasEnoughData(data.bars as unknown[], minBars)) return false;
    } else {
      if (!hasEnoughData(data[key] as unknown[], minBars)) return false;
    }
  }
  return true;
}

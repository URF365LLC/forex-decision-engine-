/**
 * UDO Multi-Strategy System - Shared Types
 * Version: 1.0.0
 * 
 * All strategies implement these interfaces for consistency.
 */

// ═══════════════════════════════════════════════════════════════
// TRADING STYLE
// ═══════════════════════════════════════════════════════════════

export type TradingStyle = 'intraday' | 'swing';

export type SignalDirection = 'long' | 'short';

export type SignalGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'no-trade';

// ═══════════════════════════════════════════════════════════════
// OHLCV BAR DATA
// ═══════════════════════════════════════════════════════════════

export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR DATA (from Alpha Vantage)
// ═══════════════════════════════════════════════════════════════

export interface IndicatorData {
  symbol: string;
  bars: Bar[];
  
  // Moving Averages
  ema20?: number[];
  ema50?: number[];
  ema200?: number[];
  sma20?: number[];
  sma200?: number[];
  
  // Momentum
  rsi?: number[];
  rsi2?: number[];           // RSI with period 2 (for RSI2 Extreme strategy)
  stoch?: { k: number; d: number }[];
  willr?: number[];          // Williams %R
  cci?: number[];            // Commodity Channel Index
  macd?: { macd: number; signal: number; histogram: number }[];
  
  // Volatility
  atr?: number[];
  bbands?: { upper: number; middle: number; lower: number }[];
  
  // Trend
  adx?: number[];
  
  // Volume
  obv?: number[];
}

// ═══════════════════════════════════════════════════════════════
// USER SETTINGS
// ═══════════════════════════════════════════════════════════════

export interface UserSettings {
  accountSize: number;
  riskPercent: number;
  style: TradingStyle;
  timezone: string;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY METADATA
// ═══════════════════════════════════════════════════════════════

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  style: TradingStyle;
  winRate: number;              // Expected win rate (e.g., 72 for 72%)
  avgRR: number;                // Average risk:reward (e.g., 1.5 for 1:1.5)
  signalsPerWeek: string;       // e.g., "3-5" or "1-2"
  
  // What indicators this strategy needs (for optimized API calls)
  requiredIndicators: RequiredIndicator[];
}

export type RequiredIndicator = 
  | 'bars'
  | 'ema20' | 'ema50' | 'ema200'
  | 'sma20' | 'sma200'
  | 'rsi' | 'rsi2'
  | 'stoch' | 'willr' | 'cci'
  | 'macd'
  | 'atr' | 'bbands'
  | 'adx'
  | 'obv';

// ═══════════════════════════════════════════════════════════════
// DECISION OUTPUT (matches your current system)
// ═══════════════════════════════════════════════════════════════

export interface Decision {
  // Identity
  symbol: string;
  displayName: string;
  strategyId: string;
  strategyName: string;
  
  // Signal
  direction: SignalDirection;
  grade: SignalGrade;
  confidence: number;          // 0-100
  
  // Trade Levels
  entryZone: {
    low: number;
    high: number;
    formatted: string;
  } | null;
  
  stopLoss: {
    price: number;
    pips: number;
    formatted: string;
  } | null;
  
  takeProfit: {
    price: number;
    pips: number;
    rr: number;
    formatted: string;
  } | null;
  
  // Position Sizing
  position: {
    lots: number;
    units: number;
    riskAmount: number;
  } | null;
  
  // Context
  reason: string;              // Human-readable explanation
  triggers: string[];          // What conditions fired
  warnings: string[];          // Any concerns
  
  // Metadata
  style: TradingStyle;
  timeframes: {
    trend: string;
    entry: string;
  };
  timestamp: string;
  validUntil: string;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface IStrategy {
  meta: StrategyMeta;
  
  /**
   * Analyze a symbol and return a trading decision
   * Returns null if no valid setup found
   */
  analyze(
    data: IndicatorData,
    settings: UserSettings
  ): Promise<Decision | null>;
}

// ═══════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════

export interface PipInfo {
  pipSize: number;
  pipValue: number;
  digits: number;
}

export function getPipInfo(symbol: string): PipInfo {
  const isJpy = symbol.includes('JPY');
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BCH', 'BNB', 'LTC'].some(c => symbol.includes(c));
  
  if (isCrypto) {
    return { pipSize: 1, pipValue: 1, digits: 2 };
  } else if (isJpy) {
    return { pipSize: 0.01, pipValue: 0.01, digits: 3 };
  } else {
    return { pipSize: 0.0001, pipValue: 0.0001, digits: 5 };
  }
}

export function formatPrice(price: number, symbol: string): string {
  const { digits } = getPipInfo(symbol);
  return price.toFixed(digits);
}

export function calculatePips(price1: number, price2: number, symbol: string): number {
  const { pipSize } = getPipInfo(symbol);
  return Math.abs(price1 - price2) / pipSize;
}

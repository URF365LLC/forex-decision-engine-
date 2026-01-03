/**
 * UDO Multi-Strategy System - Shared Types
 * Version: 2025-12-29
 */

export type TradingStyle = 'intraday' | 'swing';
export type SignalDirection = 'long' | 'short';
export type SignalGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'no-trade';

export type RequiredIndicator = 
  | 'bars' 
  | 'ema20' 
  | 'ema50' 
  | 'ema200' 
  | 'sma20' 
  | 'rsi' 
  | 'stoch' 
  | 'willr' 
  | 'cci' 
  | 'bbands' 
  | 'atr' 
  | 'adx' 
  | 'macd';

export type ReasonCode = 
  // RSI conditions
  | 'RSI_OVERSOLD'
  | 'RSI_OVERBOUGHT'
  | 'RSI_EXTREME_LOW'
  | 'RSI_EXTREME_HIGH'
  // Bollinger Band conditions
  | 'BB_TOUCH_LOWER'
  | 'BB_TOUCH_UPPER'
  | 'BB_SQUEEZE'
  | 'BB_EXPANSION'
  // Candle patterns
  | 'REJECTION_CONFIRMED'
  | 'ENGULFING_BULL'
  | 'ENGULFING_BEAR'
  | 'CANDLE_CONFIRMATION'
  // Trend conditions
  | 'TREND_ALIGNED'
  | 'TREND_COUNTER'
  | 'EMA_BULLISH_STACK'
  | 'EMA_BEARISH_STACK'
  | 'EMA_PULLBACK'
  // Momentum
  | 'STOCH_OVERSOLD'
  | 'STOCH_OVERBOUGHT'
  | 'STOCH_CROSS_UP'
  | 'STOCH_CROSS_DOWN'
  | 'WILLR_OVERSOLD'
  | 'WILLR_OVERBOUGHT'
  | 'CCI_ZERO_CROSS_UP'
  | 'CCI_ZERO_CROSS_DOWN'
  | 'CCI_EXTREME_LOW'
  | 'CCI_EXTREME_HIGH'
  // Structure
  | 'BREAK_CONFIRMED'
  | 'RETEST_CONFIRMED'
  | 'SUPPORT_HOLD'
  | 'RESISTANCE_HOLD'
  // Risk
  | 'RR_FAVORABLE'
  | 'ATR_NORMAL'
  | 'ATR_ELEVATED';

export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorData {
  symbol: string;
  bars: Bar[];
  ema20?: number[];
  ema50?: number[];
  ema200?: number[];
  sma20?: number[];
  rsi?: number[];
  stoch?: { k: number; d: number }[];
  willr?: number[];
  cci?: number[];
  bbands?: { upper: number; middle: number; lower: number }[];
  atr?: number[];
  adx?: number[];
  ema8?: number[];
  ema21?: number[];
  ema55?: number[];
  macd?: { macd: number; signal: number; histogram: number }[];
  obv?: number[];
  
  // H4 Trend Data (NEW - parallel to existing D1)
  trendBarsH4?: Bar[];
  ema200H4?: number[];
  adxH4?: number[];
  trendTimeframeUsed?: 'H4' | 'D1';
  trendFallbackUsed?: boolean;
}

export interface UserSettings {
  accountSize: number;
  riskPercent: number;
  style: TradingStyle;
  timezone?: string;
  paperTrading?: boolean;
  equity?: number;
  accountId?: string;
  startOfDayEquity?: number;
  peakEquity?: number;
  dailyLossLimitPct?: number;
  maxDrawdownPct?: number;
}

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  style: TradingStyle;
  winRate: number;
  avgRR: number;
  signalsPerWeek: string;
  requiredIndicators: RequiredIndicator[];
  timeframes: { trend: string; entry: string };
  version: string;
}

export type VolatilityLevel = 'low' | 'normal' | 'high' | 'extreme';

export interface GatingInfo {
  cooldownBlocked: boolean;
  cooldownReason?: string;
  cooldownUntil?: string;
  volatilityBlocked: boolean;
  volatilityLevel: VolatilityLevel;
  volatilityReason?: string;
}

export interface GradeUpgrade {
  symbol: string;
  strategyId: string;
  strategyName: string;
  previousGrade: SignalGrade;
  newGrade: SignalGrade;
  direction: SignalDirection;
  upgradeType: 'new-signal' | 'grade-improvement' | 'direction-flip';
  timestamp: string;
  message: string;
}

export interface SignalTiming {
  firstDetected: string;
  signalAge: {
    ms: number;
    display: string;
  };
  validUntil: string;
  isStale: boolean;
}

export interface SentimentData {
  rating: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  score: number;
  confidence: number;
  summary: string;
  timestamp: string;
}

export interface Decision {
  symbol: string;
  displayName: string;
  strategyId: string;
  strategyName: string;
  direction: SignalDirection;
  grade: SignalGrade;
  confidence: number;
  entryPrice: number;
  entry: {
    price: number;
    formatted: string;
  };
  entryZone: null;
  stopLoss: { price: number; pips: number; formatted: string } | null;
  takeProfit: { price: number; pips: number; rr: number; formatted: string } | null;
  position: { 
    lots: number; 
    units: number; 
    riskAmount: number; 
    isApproximate: boolean;
  } | null;
  reason: string;
  triggers: string[];
  reasonCodes: ReasonCode[];
  warnings: string[];
  style: TradingStyle;
  executionModel: 'NEXT_OPEN';
  timeframes: { trend: string; entry: string };
  timestamp: string;
  validUntil: string;
  timing?: SignalTiming;
  gating?: GatingInfo;
  upgrade?: GradeUpgrade;
  sentiment?: SentimentData;
}

export interface IStrategy {
  meta: StrategyMeta;
  analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null>;
}

export function getPipInfo(symbol: string): { pipSize: number; pipValue: number; digits: number } {
  const isJpy = symbol.includes('JPY');
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BNB', 'BCH', 'LTC'].some(c => symbol.includes(c));
  if (isCrypto) return { pipSize: 1, pipValue: 1, digits: 2 };
  if (isJpy) return { pipSize: 0.01, pipValue: 0.01, digits: 3 };
  return { pipSize: 0.0001, pipValue: 0.0001, digits: 5 };
}

export function formatPrice(price: number, symbol: string): string {
  const { digits } = getPipInfo(symbol);
  return price.toFixed(digits);
}

export function calculatePips(price1: number, price2: number, symbol: string): number {
  const { pipSize } = getPipInfo(symbol);
  return Math.abs(price1 - price2) / pipSize;
}

/**
 * UDO Multi-Strategy System - Shared Types
 * Version: 2025-12-29
 */

import { getInstrumentSpec } from '../config/e8InstrumentSpecs.js';

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
  | 'macd'
  | 'trendBarsH4'
  | 'ema200H4'
  | 'adxH4';

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
  [key: string]: unknown;
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
  degradeAfter: string;
  optimalWindowMinutes: number;
  expiryMinutes: number;
  state: 'optimal' | 'degrading' | 'expired';
  isStale: boolean;
  optimalEntryWindow: number; // Minutes from detection for best entry (default: 30)
}

/**
 * Tiered Exit Management
 * Addresses the core problem: trades going up but missing TP, then reversing to hit SL
 */
export interface TieredExit {
  level: 1 | 2 | 3;
  price: number;
  pips: number;
  rr: number;
  formatted: string;
  action: 'close_50%' | 'close_25%' | 'close_remaining' | 'trail';
  description: string;
}

export interface ExitManagement {
  mode: 'tiered' | 'fixed' | 'trailing';
  tieredExits: TieredExit[];
  breakEvenTrigger: {
    afterTP: 1 | 2; // Move SL to BE after TP1 or TP2 hit
    price: number;
    formatted: string;
  };
  trailingStop?: {
    activateAfterR: number; // Activate trailing after +1R
    trailDistance: number; // Trail X pips behind price
    trailDistancePips: number;
  };
  instructions: string[]; // Human-readable exit instructions
}

export interface ExitTarget {
  label: string;
  price: number;
  pips: number;
  rr: number;
  percent: number;
  action: string;
  formatted: string;
}

export interface RunnerPlan {
  percent: number;
  trail?: {
    type: 'atr' | 'structure';
    activateAtRr: number;
    offsetPips: number;
    notes?: string;
  };
}

export interface TieredExitPlan {
  tp1: ExitTarget;
  tp2: ExitTarget;
  runner: RunnerPlan;
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
  takeProfitSource?: 'rr' | 'structure' | 'atr' | 'manual' | 'session-adjusted';
  takeProfitNotes?: string[];
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
  exitPlan?: TieredExitPlan;
  gating?: GatingInfo;
  upgrade?: GradeUpgrade;
  sentiment?: SentimentData;
}

export interface IStrategy {
  meta: StrategyMeta;
  analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null>;
}

export function getPipInfo(symbol: string): { pipSize: number; pipValue: number; digits: number } {
  const spec = getInstrumentSpec(symbol);
  if (spec) {
    return {
      pipSize: spec.pipSize,
      pipValue: spec.pipValue,
      digits: spec.digits,
    };
  }

  const normalized = symbol.toUpperCase();
  const isJpy = normalized.includes('JPY');
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BNB', 'BCH', 'LTC'].some(c => normalized.includes(c));
  if (isCrypto) return { pipSize: 1, pipValue: 1, digits: 2 };
  if (isJpy) return { pipSize: 0.01, pipValue: 8.5, digits: 3 };
  return { pipSize: 0.0001, pipValue: 10, digits: 5 };
}

export function formatPrice(price: number, symbol: string): string {
  const { digits } = getPipInfo(symbol);
  return price.toFixed(digits);
}

export function calculatePips(price1: number, price2: number, symbol: string): number {
  const { pipSize } = getPipInfo(symbol);
  return Math.abs(price1 - price2) / pipSize;
}

/**
 * Calculate tiered exit management for a trade
 *
 * Default tiered exit strategy:
 * - TP1: 1.0R (close 50%, move SL to breakeven)
 * - TP2: 2.0R (close remaining 50%)
 * - Optional: Trail after TP1
 *
 * This addresses the core problem: trades going up but missing TP, then reversing to hit SL
 */
export function calculateTieredExits(
  symbol: string,
  direction: SignalDirection,
  entryPrice: number,
  stopLossPrice: number,
  atr?: number
): ExitManagement {
  const { pipSize, digits } = getPipInfo(symbol);

  // Calculate risk distance (1R)
  const riskDistance = Math.abs(entryPrice - stopLossPrice);
  const riskPips = riskDistance / pipSize;

  // Direction multiplier
  const mult = direction === 'long' ? 1 : -1;

  // Calculate TP levels
  const tp1Price = entryPrice + (riskDistance * 1.0 * mult); // 1R
  const tp2Price = entryPrice + (riskDistance * 2.0 * mult); // 2R
  const tp3Price = entryPrice + (riskDistance * 3.0 * mult); // 3R (trail target)

  const tp1Pips = riskPips * 1.0;
  const tp2Pips = riskPips * 2.0;
  const tp3Pips = riskPips * 3.0;

  // Trail distance (0.5R behind price)
  const trailDistancePips = riskPips * 0.5;
  const trailDistance = riskDistance * 0.5;

  const tieredExits: TieredExit[] = [
    {
      level: 1,
      price: tp1Price,
      pips: Math.round(tp1Pips * 10) / 10,
      rr: 1.0,
      formatted: tp1Price.toFixed(digits),
      action: 'close_50%',
      description: 'TP1: Close 50% at +1R, move SL to breakeven',
    },
    {
      level: 2,
      price: tp2Price,
      pips: Math.round(tp2Pips * 10) / 10,
      rr: 2.0,
      formatted: tp2Price.toFixed(digits),
      action: 'close_remaining',
      description: 'TP2: Close remaining 50% at +2R',
    },
    {
      level: 3,
      price: tp3Price,
      pips: Math.round(tp3Pips * 10) / 10,
      rr: 3.0,
      formatted: tp3Price.toFixed(digits),
      action: 'trail',
      description: 'TP3: Optional extended target if trailing',
    },
  ];

  const instructions = [
    `1. Enter at ${entryPrice.toFixed(digits)}`,
    `2. Set SL at ${stopLossPrice.toFixed(digits)} (${Math.round(riskPips)} pips risk)`,
    `3. When price hits TP1 (${tp1Price.toFixed(digits)}): Close 50%, move SL to breakeven`,
    `4. When price hits TP2 (${tp2Price.toFixed(digits)}): Close remaining position`,
    `5. If trailing: After TP1, trail stop ${Math.round(trailDistancePips)} pips behind price`,
  ];

  return {
    mode: 'tiered',
    tieredExits,
    breakEvenTrigger: {
      afterTP: 1,
      price: entryPrice,
      formatted: entryPrice.toFixed(digits),
    },
    trailingStop: {
      activateAfterR: 1.0,
      trailDistance,
      trailDistancePips: Math.round(trailDistancePips * 10) / 10,
    },
    instructions,
  };
}

/**
 * Calculate validity window for a signal
 *
 * Intraday (H1 entry): Valid for ~1 hour from detection (next bar)
 * Swing (H4 entry): Valid for ~4 hours from detection
 *
 * Optimal entry: First 30 minutes after detection for best pricing
 */
export function calculateValidityWindow(
  style: TradingStyle,
  detectionTime: Date,
  timezone: string = 'America/New_York'
): SignalTiming {
  const now = detectionTime;
  const optimalWindowMinutes = 30;

  // Validity duration based on style and timeframe
  const validityMinutes = style === 'swing' ? 240 : 60; // 4 hours for swing, 1 hour for intraday

  const validUntil = new Date(now.getTime() + validityMinutes * 60 * 1000);

  // Format times for display
  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  };

  const tzAbbrev = timezone === 'America/New_York' ? 'EST' :
                   timezone === 'America/Chicago' ? 'CST' :
                   timezone === 'Europe/London' ? 'GMT' : 'UTC';

  const validWindow = `Valid ${formatTime(now)} - ${formatTime(validUntil)} ${tzAbbrev}`;

  return {
    firstDetected: now.toISOString(),
    signalAge: {
      ms: 0,
      display: 'Just detected',
    },
    validUntil: validUntil.toISOString(),
    validFrom: now.toISOString(),
    validWindow,
    isStale: false,
    optimalEntryWindow: optimalWindowMinutes,
  };
}

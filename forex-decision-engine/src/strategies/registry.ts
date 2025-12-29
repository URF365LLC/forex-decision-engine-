/**
 * Strategy Registry - Central lookup for all strategies
 * Version: 2025-12-29
 */

import type { IStrategy, TradingStyle, StrategyMeta, RequiredIndicator } from './types.js';

import { RsiBounce } from './intraday/RsiBounce.js';
import { StochasticOversold } from './intraday/StochasticOversold.js';
import { BollingerMR } from './intraday/BollingerMR.js';
import { WilliamsEma } from './intraday/WilliamsEma.js';
import { TripleEma } from './intraday/TripleEma.js';
import { BreakRetest } from './intraday/BreakRetest.js';
import { CciZeroLine } from './intraday/CciZeroLine.js';
import { EmaPullback } from './intraday/EmaPullback.js';

const STRATEGIES: Record<string, IStrategy> = {
  'rsi-bounce': new RsiBounce(),
  'stoch-oversold': new StochasticOversold(),
  'bollinger-mr': new BollingerMR(),
  'williams-ema': new WilliamsEma(),
  'triple-ema': new TripleEma(),
  'break-retest-intra': new BreakRetest(),
  'cci-zero': new CciZeroLine(),
  'ema-pullback-intra': new EmaPullback(),
};

const INTRADAY_STRATEGIES: StrategyMeta[] = [
  { 
    id: 'rsi-bounce', 
    name: 'RSI Oversold Bounce', 
    description: 'Mean reversion from RSI extremes with Bollinger Band confirmation', 
    style: 'intraday', 
    winRate: 72, 
    avgRR: 1.2, 
    signalsPerWeek: '15-25', 
    requiredIndicators: ['bars', 'rsi', 'bbands', 'atr', 'sma20'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
  { 
    id: 'stoch-oversold', 
    name: 'Stochastic Oversold', 
    description: 'Stochastic crossover in extreme zones', 
    style: 'intraday', 
    winRate: 65, 
    avgRR: 1.5, 
    signalsPerWeek: '20-30', 
    requiredIndicators: ['bars', 'stoch', 'atr', 'ema200'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
  { 
    id: 'bollinger-mr', 
    name: 'Bollinger Mean Reversion', 
    description: 'Mean reversion from Bollinger Band touches with rejection candle', 
    style: 'intraday', 
    winRate: 65, 
    avgRR: 1.5, 
    signalsPerWeek: '15-20', 
    requiredIndicators: ['bars', 'bbands', 'rsi', 'atr', 'ema200'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
  { 
    id: 'williams-ema', 
    name: 'Williams %R + EMA', 
    description: 'Williams %R with EMA trend filter', 
    style: 'intraday', 
    winRate: 58, 
    avgRR: 1.5, 
    signalsPerWeek: '15-20', 
    requiredIndicators: ['bars', 'willr', 'ema50', 'atr'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
  { 
    id: 'triple-ema', 
    name: 'Triple EMA Crossover', 
    description: 'EMA8/21/55 alignment with pullback entry', 
    style: 'intraday', 
    winRate: 56, 
    avgRR: 2.0, 
    signalsPerWeek: '10-15', 
    requiredIndicators: ['bars', 'atr'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
  { 
    id: 'break-retest-intra', 
    name: 'Break & Retest', 
    description: 'Enter on retest of broken levels', 
    style: 'intraday', 
    winRate: 55, 
    avgRR: 2.0, 
    signalsPerWeek: '10-15', 
    requiredIndicators: ['bars', 'atr'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
  { 
    id: 'cci-zero', 
    name: 'CCI Zero-Line Cross', 
    description: 'CCI crossing zero from extremes with trend filter', 
    style: 'intraday', 
    winRate: 55, 
    avgRR: 2.0, 
    signalsPerWeek: '10-15', 
    requiredIndicators: ['bars', 'cci', 'ema200', 'atr'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
  { 
    id: 'ema-pullback-intra', 
    name: 'EMA Pullback', 
    description: 'Trend continuation on EMA 20/50 pullback', 
    style: 'intraday', 
    winRate: 50, 
    avgRR: 2.0, 
    signalsPerWeek: '8-15', 
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'],
    timeframes: { trend: 'H4', entry: 'H1' },
    version: '2025-12-29'
  },
];

const SWING_STRATEGIES: StrategyMeta[] = [
  { 
    id: 'ema-pullback-swing', 
    name: 'EMA Pullback (Swing)', 
    description: 'Trend continuation on H4 timeframe', 
    style: 'swing', 
    winRate: 50, 
    avgRR: 2.0, 
    signalsPerWeek: '2-4', 
    requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'],
    timeframes: { trend: 'D1', entry: 'H4' },
    version: '2025-12-29'
  },
];

export function getStrategyOptions(style: TradingStyle): StrategyMeta[] {
  const strategies = style === 'intraday' ? INTRADAY_STRATEGIES : SWING_STRATEGIES;
  return strategies.sort((a, b) => b.winRate - a.winRate);
}

export function getStrategyMeta(strategyId: string): StrategyMeta | undefined {
  return [...INTRADAY_STRATEGIES, ...SWING_STRATEGIES].find(s => s.id === strategyId);
}

export function getRequiredIndicators(strategyId: string): RequiredIndicator[] {
  const meta = getStrategyMeta(strategyId);
  return meta?.requiredIndicators || ['bars', 'rsi', 'atr'];
}

export function getStrategy(strategyId: string): IStrategy | undefined {
  return STRATEGIES[strategyId];
}

export function getAllStrategies(): IStrategy[] {
  return Object.values(STRATEGIES);
}

export const strategyRegistry = {
  get: getStrategy,
  getMeta: getStrategyMeta,
  getByStyle: getStrategyOptions,
  getIndicators: getRequiredIndicators,
  getAll: getAllStrategies,
  list: () => [...INTRADAY_STRATEGIES, ...SWING_STRATEGIES],
  get timeframes() {
    return {
      intraday: { trend: 'H4', entry: 'H1' },
      swing: { trend: 'D1', entry: 'H4' },
    };
  },
};

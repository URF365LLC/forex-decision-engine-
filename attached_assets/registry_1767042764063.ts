/**
 * UDO Multi-Strategy System - Strategy Registry
 * 
 * Central registry for all trading strategies.
 * Provides filtering by style (intraday/swing) for the UI dropdown.
 */

import { IStrategy, TradingStyle, StrategyMeta } from './types';

// ═══════════════════════════════════════════════════════════════
// IMPORT ALL INTRADAY STRATEGIES
// ═══════════════════════════════════════════════════════════════

import { emaPullbackIntraday } from './intraday/EmaPullback';
import { rsiBounceIntraday } from './intraday/RsiBounce';
import { stochasticOversoldIntraday } from './intraday/StochasticOversold';
import { bollingerMRIntraday } from './intraday/BollingerMR';
import { tripleEmaIntraday } from './intraday/TripleEma';
import { breakRetestIntraday } from './intraday/BreakRetest';
import { williamsEmaIntraday } from './intraday/WilliamsEma';
import { cciZeroLineIntraday } from './intraday/CciZeroLine';

// ═══════════════════════════════════════════════════════════════
// IMPORT ALL SWING STRATEGIES (TODO: Implement these next)
// ═══════════════════════════════════════════════════════════════

// import { emaPullbackSwing } from './swing/EmaPullback';
// import { rsi2ExtremeSwing } from './swing/Rsi2Extreme';
// import { macdRsiSwing } from './swing/MacdRsi';
// ... etc

// ═══════════════════════════════════════════════════════════════
// STRATEGY REGISTRY
// ═══════════════════════════════════════════════════════════════

/**
 * All registered strategies indexed by ID
 */
export const STRATEGIES: Record<string, IStrategy> = {
  // ── INTRADAY STRATEGIES ──────────────────────────────────────
  'ema-pullback-intra': emaPullbackIntraday,
  'rsi-bounce': rsiBounceIntraday,
  'stoch-oversold': stochasticOversoldIntraday,
  'bollinger-mr': bollingerMRIntraday,
  'triple-ema': tripleEmaIntraday,
  'break-retest-intra': breakRetestIntraday,
  'williams-ema': williamsEmaIntraday,
  'cci-zero': cciZeroLineIntraday,
  
  // ── SWING STRATEGIES (TODO) ──────────────────────────────────
  // 'ema-pullback-swing': emaPullbackSwing,
  // 'rsi2-extreme': rsi2ExtremeSwing,
  // 'macd-rsi': macdRsiSwing,
  // 'macd-bollinger': macdBollingerSwing,
  // 'adx-trend': adxTrendSwing,
  // 'macd-divergence': macdDivergenceSwing,
  // 'rsi-divergence': rsiDivergenceSwing,
  // 'break-retest-swing': breakRetestSwing,
  // 'donchian': donchianSwing,
  // 'aroon-trend': aroonTrendSwing,
};

// ═══════════════════════════════════════════════════════════════
// REGISTRY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get all strategies
 */
export function getAllStrategies(): IStrategy[] {
  return Object.values(STRATEGIES);
}

/**
 * Get strategies filtered by trading style
 * This is what populates the dropdown in the Watchlist screen
 */
export function getStrategiesByStyle(style: TradingStyle): IStrategy[] {
  return Object.values(STRATEGIES).filter(s => s.meta.style === style);
}

/**
 * Get a single strategy by ID
 */
export function getStrategy(id: string): IStrategy | undefined {
  return STRATEGIES[id];
}

/**
 * Get strategy metadata for dropdown display
 * Returns array sorted by win rate (highest first)
 */
export function getStrategyOptions(style: TradingStyle): StrategyMeta[] {
  return getStrategiesByStyle(style)
    .map(s => s.meta)
    .sort((a, b) => b.winRate - a.winRate);
}

/**
 * Get required indicators for a strategy
 * Used to optimize API calls - only fetch what's needed
 */
export function getRequiredIndicators(strategyId: string): string[] {
  const strategy = STRATEGIES[strategyId];
  return strategy ? strategy.meta.requiredIndicators : [];
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY SUMMARY (for reference)
// ═══════════════════════════════════════════════════════════════

/**
 * INTRADAY STRATEGIES (8 total)
 * ────────────────────────────────────────────────────────────────
 * ID                  | Name                    | Win Rate | R:R
 * ────────────────────────────────────────────────────────────────
 * ema-pullback-intra  | EMA Pullback            | 50%      | 1:2
 * rsi-bounce          | RSI Oversold Bounce     | 72%      | 1:1.2
 * stoch-oversold      | Stochastic Oversold     | 65%      | 1:1.5
 * bollinger-mr        | Bollinger Mean Reversion| 65%      | 1:1.5
 * triple-ema          | Triple EMA Crossover    | 55%      | 1:2
 * break-retest-intra  | Break & Retest          | 55%      | 1:2
 * williams-ema        | Williams %R + EMA       | 58%      | 1:1.5
 * cci-zero            | CCI Zero-Line Cross     | 55%      | 1:2
 * 
 * 
 * SWING STRATEGIES (10 total) - TODO
 * ────────────────────────────────────────────────────────────────
 * ID                  | Name                    | Win Rate | R:R
 * ────────────────────────────────────────────────────────────────
 * ema-pullback-swing  | EMA Pullback            | 50%      | 1:2
 * rsi2-extreme        | RSI(2) Extreme          | 88%      | 1:0.75
 * macd-rsi            | MACD + RSI Confluence   | 73%      | 1:1.5
 * macd-bollinger      | MACD + Bollinger        | 78%      | 1:1.5
 * adx-trend           | ADX Trend Strength      | 60%      | 1:2
 * macd-divergence     | MACD Divergence         | 62%      | 1:2
 * rsi-divergence      | RSI Divergence          | 58%      | 1:2
 * break-retest-swing  | Break & Retest          | 60%      | 1:2
 * donchian            | Donchian Channel        | 45%      | 1:3
 * aroon-trend         | Aroon Trend Detection   | 58%      | 1:2
 */

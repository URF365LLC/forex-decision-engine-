/**
 * UDO Multi-Strategy System
 * Version: 1.0.0
 * 
 * Main entry point - exports all types, utilities, and strategies.
 * 
 * USAGE:
 * ══════════════════════════════════════════════════════════════
 * 
 * // Get strategies for dropdown
 * import { getStrategyOptions } from './strategies';
 * const intradayOptions = getStrategyOptions('intraday');
 * 
 * // Run a specific strategy
 * import { getStrategy } from './strategies';
 * const strategy = getStrategy('rsi-bounce');
 * const decision = await strategy.analyze(data, settings);
 * 
 * // Get required indicators for a strategy (to optimize API calls)
 * import { getRequiredIndicators } from './strategies';
 * const indicators = getRequiredIndicators('rsi-bounce');
 * // => ['bars', 'rsi', 'bbands', 'atr', 'sma20']
 * 
 * ══════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type {
  TradingStyle,
  SignalDirection,
  SignalGrade,
  Bar,
  IndicatorData,
  UserSettings,
  StrategyMeta,
  RequiredIndicator,
  Decision,
  IStrategy,
  PipInfo,
} from './types';

export {
  getPipInfo,
  formatPrice,
  calculatePips,
} from './types';

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

export {
  latest,
  previous,
  lastN,
  crossedAbove,
  crossedBelow,
  calculateSlope,
  isRising,
  isFalling,
  priceAboveEma,
  priceBelowEma,
  findSwingHigh,
  findSwingLow,
  calculatePositionSize,
  calculateGrade,
  buildDecision,
  hasEnoughData,
  validateIndicators,
} from './utils';

// ═══════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════

export {
  STRATEGIES,
  getAllStrategies,
  getStrategiesByStyle,
  getStrategy,
  getStrategyOptions,
  getRequiredIndicators,
} from './registry';

// ═══════════════════════════════════════════════════════════════
// INTRADAY STRATEGIES
// ═══════════════════════════════════════════════════════════════

export { emaPullbackIntraday } from './intraday/EmaPullback';
export { rsiBounceIntraday } from './intraday/RsiBounce';
export { stochasticOversoldIntraday } from './intraday/StochasticOversold';
export { bollingerMRIntraday } from './intraday/BollingerMR';
export { tripleEmaIntraday } from './intraday/TripleEma';
export { breakRetestIntraday } from './intraday/BreakRetest';
export { williamsEmaIntraday } from './intraday/WilliamsEma';
export { cciZeroLineIntraday } from './intraday/CciZeroLine';

// ═══════════════════════════════════════════════════════════════
// SWING STRATEGIES (TODO)
// ═══════════════════════════════════════════════════════════════

// export { emaPullbackSwing } from './swing/EmaPullback';
// export { rsi2ExtremeSwing } from './swing/Rsi2Extreme';
// export { macdRsiSwing } from './swing/MacdRsi';
// ... etc

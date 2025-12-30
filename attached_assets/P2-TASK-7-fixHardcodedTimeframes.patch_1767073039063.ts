/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P2 TASK #7: FIX HARDCODED TIMEFRAMES IN UTILS.TS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: Line 80 in src/strategies/utils.ts has hardcoded H4/H1 timeframes
 *          instead of using the strategy's registry.meta.timeframes
 * 
 * IMPACT: If a strategy uses different timeframes (e.g., D1/H4), the utils
 *         would still assume H4/H1, causing incorrect analysis
 * 
 * FILE TO MODIFY: src/strategies/utils.ts (around line 80)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CURRENT CODE (PROBLEMATIC)
// ═══════════════════════════════════════════════════════════════════════════════

/*
// Around line 80 in src/strategies/utils.ts - BEFORE:

export function getTimeframes(style: TradingStyle): { trend: string; entry: string } {
  // Hardcoded - doesn't respect strategy-specific timeframes
  return {
    trend: 'H4',
    entry: 'H1',
  };
}
*/


// ═══════════════════════════════════════════════════════════════════════════════
// FIXED CODE
// ═══════════════════════════════════════════════════════════════════════════════

import { TradingStyle } from '../types/settings.js';
import { StrategyMeta } from '../types/strategy.js';

/**
 * Style-based default timeframes (used when strategy doesn't specify)
 */
const STYLE_TIMEFRAMES: Record<TradingStyle, { trend: string; entry: string }> = {
  intraday: {
    trend: 'H4',
    entry: 'H1',
  },
  swing: {
    trend: 'D1',
    entry: 'H4',
  },
  position: {
    trend: 'W1',
    entry: 'D1',
  },
};

/**
 * Get timeframes for a trading style
 * 
 * @param style - Trading style (intraday, swing, position)
 * @returns Object with trend and entry timeframe strings
 */
export function getTimeframes(style: TradingStyle): { trend: string; entry: string } {
  return STYLE_TIMEFRAMES[style] || STYLE_TIMEFRAMES.intraday;
}

/**
 * Get timeframes from strategy metadata, with style-based fallback
 * 
 * This is the PREFERRED function to use when you have access to strategy meta.
 * It respects strategy-specific timeframe overrides.
 * 
 * @param meta - Strategy metadata from registry
 * @param style - Trading style (fallback if meta doesn't specify)
 * @returns Object with trend and entry timeframe strings
 */
export function getStrategyTimeframes(
  meta: StrategyMeta,
  style: TradingStyle
): { trend: string; entry: string } {
  // Use strategy-specific timeframes if defined
  if (meta.timeframes) {
    return {
      trend: meta.timeframes.trend,
      entry: meta.timeframes.entry,
    };
  }
  
  // Fall back to style-based defaults
  return getTimeframes(style);
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE: Any code that calls getTimeframes() with strategy context
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BEFORE (in various files):
 * 
 *   const timeframes = getTimeframes(settings.style);
 * 
 * AFTER (when strategy meta is available):
 * 
 *   const timeframes = getStrategyTimeframes(strategy.meta, settings.style);
 */


// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE: Update in strategyAnalyzer.ts
// ═══════════════════════════════════════════════════════════════════════════════

/*
// BEFORE (around line 95):
const timeframes = getTimeframes(settings.style);

// AFTER:
import { getStrategyTimeframes } from '../strategies/utils.js';

const timeframes = getStrategyTimeframes(strategy.meta, settings.style);
*/


// ═══════════════════════════════════════════════════════════════════════════════
// ENSURE StrategyMeta INTERFACE HAS TIMEFRAMES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In src/types/strategy.ts, ensure StrategyMeta has optional timeframes:
 */

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  category: 'trend' | 'momentum' | 'reversal' | 'breakout' | 'multi-timeframe';
  
  // Optional: Strategy-specific timeframe overrides
  timeframes?: {
    trend: string;  // e.g., 'D1', 'H4', 'W1'
    entry: string;  // e.g., 'H4', 'H1', 'D1'
  };
  
  // Other fields...
  indicators: string[];
  riskReward: {
    min: number;
    target: number;
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION CHECKLIST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Files to update:
 * 
 * 1. src/strategies/utils.ts
 *    - Add STYLE_TIMEFRAMES constant
 *    - Update getTimeframes() to use constant
 *    - Add new getStrategyTimeframes() function
 * 
 * 2. src/types/strategy.ts
 *    - Add optional timeframes field to StrategyMeta
 * 
 * 3. src/engine/strategyAnalyzer.ts
 *    - Import getStrategyTimeframes
 *    - Replace getTimeframes(style) with getStrategyTimeframes(meta, style)
 * 
 * 4. Any strategy files that define custom timeframes
 *    - Add timeframes to meta object
 *    - Example: Multi-Timeframe Alignment might use D1/H4 even for intraday
 */

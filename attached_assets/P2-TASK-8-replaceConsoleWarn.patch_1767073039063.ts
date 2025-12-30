/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P2 TASK #8: REPLACE CONSOLE.WARN WITH LOGGER
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: Lines 17 and 24 in src/strategies/utils.ts use console.warn
 *          instead of the structured logger service
 * 
 * IMPACT: 
 *   - Inconsistent log formatting
 *   - Missing timestamps and context
 *   - Can't filter/search logs effectively
 *   - Won't appear in log files if using file transport
 * 
 * FILE TO MODIFY: src/strategies/utils.ts (lines 17, 24)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: ADD LOGGER IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

// At top of src/strategies/utils.ts, add:
import { createLogger } from '../services/logger.js';

const logger = createLogger('StrategyUtils');


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: REPLACE CONSOLE.WARN CALLS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BEFORE (line 17):
 *   console.warn(`Invalid ATR value for ${symbol}: ${atr}`);
 * 
 * AFTER:
 *   logger.warn(`Invalid ATR value for ${symbol}`, { atr, symbol });
 */

/**
 * BEFORE (line 24):
 *   console.warn(`Missing price data for position sizing`);
 * 
 * AFTER:
 *   logger.warn('Missing price data for position sizing', { symbol, price });
 */


// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETE UPDATED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

import { createLogger } from '../services/logger.js';
import { PositionSize } from '../types/strategy.js';
import { UserSettings } from '../types/settings.js';

const logger = createLogger('StrategyUtils');

/**
 * Calculate stop loss distance in pips
 */
export function calculateStopPips(
  symbol: string,
  entryPrice: number,
  stopPrice: number,
  atr: number | null
): number | null {
  // Validate ATR
  if (atr === null || atr <= 0 || !isFinite(atr)) {
    // ════════════════════════════════════════════════════════════════
    // FIXED: Use logger instead of console.warn (line 17)
    // ════════════════════════════════════════════════════════════════
    logger.warn('Invalid ATR value', { 
      symbol, 
      atr,
      entryPrice,
      stopPrice 
    });
    return null;
  }
  
  const pipValue = getPipValue(symbol);
  const distance = Math.abs(entryPrice - stopPrice);
  return Math.round(distance / pipValue);
}

/**
 * Calculate position size based on risk parameters
 */
export function calculatePositionSize(
  symbol: string,
  price: number | null,
  stopPips: number | null,
  settings: UserSettings
): PositionSize | null {
  // Validate inputs
  if (price === null || price <= 0 || !isFinite(price)) {
    // ════════════════════════════════════════════════════════════════
    // FIXED: Use logger instead of console.warn (line 24)
    // ════════════════════════════════════════════════════════════════
    logger.warn('Missing or invalid price data for position sizing', { 
      symbol, 
      price,
      stopPips,
      accountSize: settings.accountSize 
    });
    return null;
  }
  
  if (stopPips === null || stopPips <= 0) {
    logger.warn('Invalid stop pips for position sizing', {
      symbol,
      stopPips,
      price
    });
    return null;
  }
  
  const { accountSize, riskPercent } = settings;
  const riskAmount = accountSize * (riskPercent / 100);
  const pipValue = getPipValue(symbol);
  const positionValue = riskAmount / (stopPips * pipValue);
  
  // Calculate lots (standard lot = 100,000 units)
  const lots = positionValue / 100000;
  const units = Math.floor(positionValue);
  
  return {
    lots: Math.round(lots * 100) / 100, // Round to 2 decimals
    units,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskPercent: settings.riskPercent,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// BONUS: GLOBAL SEARCH & REPLACE PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Search the entire codebase for console.* usage and replace:
 * 
 * FIND:     console.log(
 * REPLACE:  logger.debug(
 * 
 * FIND:     console.warn(
 * REPLACE:  logger.warn(
 * 
 * FIND:     console.error(
 * REPLACE:  logger.error(
 * 
 * FIND:     console.info(
 * REPLACE:  logger.info(
 * 
 * NOTE: Each file needs the logger import added at the top:
 *   import { createLogger } from '../services/logger.js';
 *   const logger = createLogger('ModuleName');
 */


// ═══════════════════════════════════════════════════════════════════════════════
// LOGGER BEST PRACTICES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 1. STRUCTURED DATA
 *    Bad:  logger.warn(`Error for ${symbol}: ${error.message}`);
 *    Good: logger.warn('Symbol processing error', { symbol, error: error.message });
 * 
 * 2. LOG LEVELS
 *    - error: Exceptions, failures that need attention
 *    - warn: Recoverable issues, missing data, fallbacks used
 *    - info: Normal operations, scan results, decisions
 *    - debug: Detailed tracing, indicator values, cache hits
 * 
 * 3. CONTEXT OBJECTS
 *    Always include relevant context as second parameter:
 *    logger.info('Analysis complete', { 
 *      symbol, 
 *      strategyId, 
 *      grade, 
 *      elapsed: `${ms}ms` 
 *    });
 * 
 * 4. MODULE NAMES
 *    Use descriptive names in createLogger():
 *    - 'StrategyUtils' not 'utils'
 *    - 'AlphaVantageClient' not 'av'
 *    - 'GradeTracker' not 'tracker'
 */

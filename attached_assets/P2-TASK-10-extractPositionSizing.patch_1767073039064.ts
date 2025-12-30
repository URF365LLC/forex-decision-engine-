/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P2 TASK #10: EXTRACT DUPLICATE POSITION SIZING TO SHARED FUNCTION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: Lines 126-133 in src/strategies/utils.ts contain position sizing
 *          logic that may be duplicated in multiple strategy files
 * 
 * IMPACT:
 *   - DRY violation (Don't Repeat Yourself)
 *   - Bug fixes need to be applied in multiple places
 *   - Inconsistent sizing across strategies if one copy diverges
 * 
 * SOLUTION: Create a centralized position sizing utility and ensure all
 *           strategies use it instead of inline calculations
 * 
 * FILE TO MODIFY: src/strategies/utils.ts
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createLogger } from '../services/logger.js';

const logger = createLogger('PositionSizing');

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface PositionSizeInput {
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  accountSize: number;
  riskPercent: number;
  maxPositionPercent?: number;  // Optional: max % of account per trade
}

export interface PositionSizeResult {
  lots: number;
  units: number;
  riskAmount: number;
  riskPercent: number;
  stopPips: number;
  pipValue: number;
  positionValue: number;
  // Validation
  isValid: boolean;
  warnings: string[];
}


// ═══════════════════════════════════════════════════════════════════════════════
// PIP VALUE LOOKUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get pip value for a symbol
 * Most forex pairs: 0.0001
 * JPY pairs: 0.01
 * Metals/indices may have different values
 */
export function getPipValue(symbol: string): number {
  const normalizedSymbol = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  
  // JPY pairs have larger pip value
  if (normalizedSymbol.includes('JPY')) {
    return 0.01;
  }
  
  // Gold (XAUUSD) - pip is $0.10
  if (normalizedSymbol.includes('XAU')) {
    return 0.1;
  }
  
  // Silver (XAGUSD) - pip is $0.001
  if (normalizedSymbol.includes('XAG')) {
    return 0.001;
  }
  
  // Default forex pip
  return 0.0001;
}

/**
 * Get pip monetary value per lot for a symbol
 * Standard lot = 100,000 units
 */
export function getPipValuePerLot(symbol: string): number {
  const normalizedSymbol = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  
  // For USD quote currency pairs (EURUSD, GBPUSD, etc.)
  // 1 pip = $10 per standard lot
  if (normalizedSymbol.endsWith('USD')) {
    return 10;
  }
  
  // For JPY quote currency pairs
  // Value depends on USDJPY rate, approximate as $9
  if (normalizedSymbol.endsWith('JPY')) {
    return 9; // Approximate
  }
  
  // For other quote currencies, would need exchange rate
  // Default to $10
  return 10;
}


// ═══════════════════════════════════════════════════════════════════════════════
// CENTRALIZED POSITION SIZING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate position size based on risk parameters
 * 
 * This is the SINGLE SOURCE OF TRUTH for position sizing.
 * All strategies should use this function.
 * 
 * @param input - Position sizing parameters
 * @returns Position size result with lots, units, and validation
 */
export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const {
    symbol,
    entryPrice,
    stopLossPrice,
    accountSize,
    riskPercent,
    maxPositionPercent = 10, // Default max 10% of account
  } = input;
  
  const warnings: string[] = [];
  
  // ════════════════════════════════════════════════════════════════
  // VALIDATION
  // ════════════════════════════════════════════════════════════════
  
  if (!entryPrice || entryPrice <= 0 || !isFinite(entryPrice)) {
    logger.warn('Invalid entry price for position sizing', { symbol, entryPrice });
    return createInvalidResult('Invalid entry price');
  }
  
  if (!stopLossPrice || stopLossPrice <= 0 || !isFinite(stopLossPrice)) {
    logger.warn('Invalid stop loss price for position sizing', { symbol, stopLossPrice });
    return createInvalidResult('Invalid stop loss price');
  }
  
  if (entryPrice === stopLossPrice) {
    logger.warn('Entry and stop loss are the same', { symbol, entryPrice, stopLossPrice });
    return createInvalidResult('Entry equals stop loss');
  }
  
  if (!accountSize || accountSize <= 0) {
    logger.warn('Invalid account size', { symbol, accountSize });
    return createInvalidResult('Invalid account size');
  }
  
  if (!riskPercent || riskPercent <= 0 || riskPercent > 100) {
    logger.warn('Invalid risk percent', { symbol, riskPercent });
    return createInvalidResult('Invalid risk percent');
  }
  
  // ════════════════════════════════════════════════════════════════
  // CALCULATION
  // ════════════════════════════════════════════════════════════════
  
  const pipSize = getPipValue(symbol);
  const pipValuePerLot = getPipValuePerLot(symbol);
  
  // Calculate stop distance in pips
  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  const stopPips = stopDistance / pipSize;
  
  // Sanity check: stop shouldn't be more than 10% of price
  if (stopDistance > entryPrice * 0.10) {
    warnings.push('Stop loss is more than 10% from entry');
  }
  
  // Calculate risk amount in account currency
  const riskAmount = accountSize * (riskPercent / 100);
  
  // Calculate position size
  // Risk Amount = Pips × Pip Value × Lots
  // Lots = Risk Amount / (Pips × Pip Value per Lot)
  const lots = riskAmount / (stopPips * pipValuePerLot);
  
  // Calculate units (lots × 100,000)
  const units = Math.floor(lots * 100000);
  
  // Calculate position value
  const positionValue = units * entryPrice;
  
  // ════════════════════════════════════════════════════════════════
  // POSITION SIZE LIMITS
  // ════════════════════════════════════════════════════════════════
  
  // Check max position size limit
  const maxPositionValue = accountSize * (maxPositionPercent / 100);
  let finalLots = lots;
  let finalUnits = units;
  
  if (positionValue > maxPositionValue) {
    warnings.push(`Position capped at ${maxPositionPercent}% of account`);
    finalUnits = Math.floor(maxPositionValue / entryPrice);
    finalLots = finalUnits / 100000;
  }
  
  // Minimum lot size (most brokers: 0.01)
  if (finalLots < 0.01) {
    warnings.push('Position size below minimum lot (0.01)');
    finalLots = 0.01;
    finalUnits = 1000;
  }
  
  // Round lots to 2 decimal places
  finalLots = Math.round(finalLots * 100) / 100;
  
  // ════════════════════════════════════════════════════════════════
  // RESULT
  // ════════════════════════════════════════════════════════════════
  
  const result: PositionSizeResult = {
    lots: finalLots,
    units: finalUnits,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskPercent,
    stopPips: Math.round(stopPips * 10) / 10,
    pipValue: pipSize,
    positionValue: Math.round(finalUnits * entryPrice * 100) / 100,
    isValid: true,
    warnings,
  };
  
  logger.debug('Position size calculated', {
    symbol,
    lots: result.lots,
    stopPips: result.stopPips,
    riskAmount: result.riskAmount,
  });
  
  return result;
}

/**
 * Create an invalid result with error message
 */
function createInvalidResult(error: string): PositionSizeResult {
  return {
    lots: 0,
    units: 0,
    riskAmount: 0,
    riskPercent: 0,
    stopPips: 0,
    pipValue: 0,
    positionValue: 0,
    isValid: false,
    warnings: [error],
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE WRAPPER FOR STRATEGIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simplified position sizing for strategy use
 * 
 * @param symbol - Trading symbol
 * @param entryPrice - Entry price
 * @param stopLossPrice - Stop loss price
 * @param settings - User settings with account info
 * @returns Position size or null if invalid
 */
export function getPositionSize(
  symbol: string,
  entryPrice: number,
  stopLossPrice: number,
  settings: { accountSize: number; riskPercent: number }
): { lots: number; units: number; riskAmount: number } | null {
  const result = calculatePositionSize({
    symbol,
    entryPrice,
    stopLossPrice,
    accountSize: settings.accountSize,
    riskPercent: settings.riskPercent,
  });
  
  if (!result.isValid) {
    return null;
  }
  
  return {
    lots: result.lots,
    units: result.units,
    riskAmount: result.riskAmount,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION GUIDE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * STEP 1: Search for duplicate position sizing code
 * 
 *   Search patterns:
 *   - "riskAmount / "
 *   - "accountSize * (riskPercent"
 *   - "/ 100000" (lots calculation)
 *   - "Math.floor(" + "units"
 * 
 * STEP 2: Replace inline calculations with function call
 * 
 *   BEFORE (inline):
 *   const riskAmount = settings.accountSize * (settings.riskPercent / 100);
 *   const pipValue = 0.0001;
 *   const stopPips = Math.abs(entry - stop) / pipValue;
 *   const lots = riskAmount / (stopPips * 10);
 *   const units = Math.floor(lots * 100000);
 * 
 *   AFTER (function call):
 *   const position = getPositionSize(symbol, entry, stop, settings);
 *   if (!position) {
 *     return null; // or handle error
 *   }
 *   const { lots, units, riskAmount } = position;
 * 
 * STEP 3: Update imports in strategy files
 * 
 *   import { getPositionSize, calculatePositionSize } from '../utils.js';
 * 
 * STEP 4: Run tests to verify calculations match
 */


// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add to test file: src/strategies/__tests__/positionSizing.test.ts
 */

/*
import { calculatePositionSize, getPipValue } from '../utils.js';

describe('Position Sizing', () => {
  const defaultInput = {
    symbol: 'EURUSD',
    entryPrice: 1.1000,
    stopLossPrice: 1.0950,
    accountSize: 10000,
    riskPercent: 2,
  };
  
  test('calculates correct lot size', () => {
    const result = calculatePositionSize(defaultInput);
    expect(result.isValid).toBe(true);
    expect(result.stopPips).toBe(50);
    expect(result.riskAmount).toBe(200); // 2% of 10000
    expect(result.lots).toBe(0.4); // 200 / (50 * 10)
  });
  
  test('handles JPY pairs correctly', () => {
    const result = calculatePositionSize({
      ...defaultInput,
      symbol: 'USDJPY',
      entryPrice: 150.00,
      stopLossPrice: 149.50,
    });
    expect(result.isValid).toBe(true);
    expect(result.stopPips).toBe(50);
  });
  
  test('returns invalid for zero stop distance', () => {
    const result = calculatePositionSize({
      ...defaultInput,
      stopLossPrice: 1.1000, // Same as entry
    });
    expect(result.isValid).toBe(false);
  });
  
  test('caps position at max percent', () => {
    const result = calculatePositionSize({
      ...defaultInput,
      stopLossPrice: 1.0999, // Very tight stop = huge position
      maxPositionPercent: 10,
    });
    expect(result.warnings).toContain('Position capped at 10% of account');
  });
});
*/

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CRITICAL FIX: CRYPTO POSITION SIZING (E8-COMPATIBLE)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: Current code uses pipValue = 1 for all crypto, which is WRONG
 * 
 * IMPACT:
 *   - Incorrect lot sizes
 *   - Hidden over-risking (prop firm violation)
 *   - Silent E8 rule violations
 *   - Misleading backtests
 * 
 * SOLUTION: Implement contract-size-based position sizing for crypto
 *   - Crypto: Risk($) = StopDistance($) × ContractSize × Lots
 *   - FX: Keep existing pip-based calculation (marked approximate)
 * 
 * FILES TO MODIFY:
 *   - src/strategies/utils.ts (or create src/utils/positionSizing.ts)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createLogger } from '../services/logger.js';

const logger = createLogger('PositionSizing');

// ═══════════════════════════════════════════════════════════════════════════════
// ASSET CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

export type AssetClass = 'forex' | 'crypto' | 'metal' | 'index' | 'unknown';

/**
 * Crypto symbols and their contract sizes (1 lot = X coins)
 * Source: E8 Markets MT5 contract specifications
 */
export const CRYPTO_CONTRACT_SIZES: Record<string, number> = {
  // Major cryptos - 1 lot = 1 coin
  BTCUSD: 1,
  ETHUSD: 1,
  LTCUSD: 1,
  BCHUSD: 1,
  SOLUSD: 1,
  DOTUSD: 1,
  AVAXUSD: 1,
  LINKUSD: 1,
  UNIUSD: 1,
  MATICUSD: 1,
  
  // Altcoins - 1 lot = 100 coins (typical for lower-priced coins)
  XRPUSD: 100,
  ADAUSD: 100,
  DOGEUSD: 100,
  SHIBUSD: 1000000,  // 1 lot = 1M SHIB (very low price)
  
  // Add more as needed from E8 specifications
};

/**
 * Forex pip sizes by quote currency
 */
export const FOREX_PIP_SIZES: Record<string, number> = {
  JPY: 0.01,      // XXX/JPY pairs
  DEFAULT: 0.0001, // Most pairs (EUR/USD, GBP/USD, etc.)
};

/**
 * Forex pip value per standard lot (approximate, USD account)
 */
export const FOREX_PIP_VALUES: Record<string, number> = {
  // USD quote currency - $10 per pip per lot
  EURUSD: 10,
  GBPUSD: 10,
  AUDUSD: 10,
  NZDUSD: 10,
  
  // JPY quote currency - ~$6.67 per pip per lot (depends on USDJPY rate)
  USDJPY: 6.67,
  EURJPY: 6.67,
  GBPJPY: 6.67,
  AUDJPY: 6.67,
  
  // Other quote currencies - approximate
  DEFAULT: 10,
};

/**
 * Metal contract sizes
 */
export const METAL_CONTRACT_SIZES: Record<string, number> = {
  XAUUSD: 100,  // 1 lot = 100 oz gold
  XAGUSD: 5000, // 1 lot = 5000 oz silver
};

/**
 * Determine asset class from symbol
 */
export function getAssetClass(symbol: string): AssetClass {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  
  // Crypto detection
  const cryptoPatterns = ['BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'SOL', 'DOT', 
                          'AVAX', 'LINK', 'UNI', 'MATIC', 'ADA', 'DOGE', 'SHIB'];
  if (cryptoPatterns.some(c => normalized.includes(c))) {
    return 'crypto';
  }
  
  // Metal detection
  if (normalized.includes('XAU') || normalized.includes('XAG')) {
    return 'metal';
  }
  
  // Index detection (common indices)
  const indexPatterns = ['US30', 'US500', 'NAS100', 'UK100', 'GER40', 'JPN225'];
  if (indexPatterns.some(i => normalized.includes(i))) {
    return 'index';
  }
  
  // Forex detection (6-char currency pairs)
  if (/^[A-Z]{6}$/.test(normalized)) {
    return 'forex';
  }
  
  return 'unknown';
}

/**
 * Check if symbol is crypto
 */
export function isCrypto(symbol: string): boolean {
  return getAssetClass(symbol) === 'crypto';
}

/**
 * Check if symbol is forex
 */
export function isForex(symbol: string): boolean {
  return getAssetClass(symbol) === 'forex';
}


// ═══════════════════════════════════════════════════════════════════════════════
// POSITION SIZING TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface PositionSizeInput {
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  accountSize: number;
  riskPercent: number;
  maxLots?: number;       // Broker max lot limit
  minLots?: number;       // Broker min lot limit (usually 0.01)
}

export interface PositionSizeResult {
  lots: number;
  units: number;
  riskAmount: number;
  riskPercent: number;
  stopDistance: number;
  stopPips?: number;      // Only for forex
  contractSize?: number;  // Only for crypto/metals
  
  // Metadata
  assetClass: AssetClass;
  isValid: boolean;
  isApproximate: boolean; // True for FX (pip value varies)
  warnings: string[];
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN POSITION SIZING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate position size based on risk parameters
 * 
 * CRITICAL: This function handles crypto and forex differently
 * 
 * Crypto Formula: Lots = RiskAmount / (StopDistance × ContractSize)
 * Forex Formula:  Lots = RiskAmount / (StopPips × PipValue)
 * 
 * @param input - Position sizing parameters
 * @returns Position size result with validation
 */
export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const {
    symbol,
    entryPrice,
    stopLossPrice,
    accountSize,
    riskPercent,
    maxLots = 100,
    minLots = 0.01,
  } = input;
  
  const warnings: string[] = [];
  const assetClass = getAssetClass(symbol);
  
  // ════════════════════════════════════════════════════════════════
  // INPUT VALIDATION
  // ════════════════════════════════════════════════════════════════
  
  if (!entryPrice || entryPrice <= 0 || !Number.isFinite(entryPrice)) {
    return createInvalidResult(symbol, assetClass, 'Invalid entry price');
  }
  
  if (!stopLossPrice || stopLossPrice <= 0 || !Number.isFinite(stopLossPrice)) {
    return createInvalidResult(symbol, assetClass, 'Invalid stop loss price');
  }
  
  if (entryPrice === stopLossPrice) {
    return createInvalidResult(symbol, assetClass, 'Entry equals stop loss');
  }
  
  if (!accountSize || accountSize <= 0) {
    return createInvalidResult(symbol, assetClass, 'Invalid account size');
  }
  
  if (!riskPercent || riskPercent <= 0 || riskPercent > 100) {
    return createInvalidResult(symbol, assetClass, 'Invalid risk percent');
  }
  
  // Calculate risk amount
  const riskAmount = accountSize * (riskPercent / 100);
  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  
  if (stopDistance <= 0) {
    return createInvalidResult(symbol, assetClass, 'Stop distance is zero');
  }
  
  // ════════════════════════════════════════════════════════════════
  // ROUTE BY ASSET CLASS
  // ════════════════════════════════════════════════════════════════
  
  let result: PositionSizeResult;
  
  switch (assetClass) {
    case 'crypto':
      result = calculateCryptoPosition(symbol, riskAmount, stopDistance, assetClass);
      break;
      
    case 'forex':
      result = calculateForexPosition(symbol, entryPrice, stopLossPrice, riskAmount, assetClass);
      break;
      
    case 'metal':
      result = calculateMetalPosition(symbol, riskAmount, stopDistance, assetClass);
      break;
      
    default:
      return createInvalidResult(symbol, assetClass, `Unsupported asset class: ${assetClass}`);
  }
  
  // ════════════════════════════════════════════════════════════════
  // POST-CALCULATION VALIDATION
  // ════════════════════════════════════════════════════════════════
  
  if (!result.isValid) {
    return result;
  }
  
  // Validate lot size is finite and positive
  if (!Number.isFinite(result.lots) || result.lots <= 0) {
    return createInvalidResult(symbol, assetClass, 'Calculated lot size is invalid');
  }
  
  // Apply lot limits
  if (result.lots < minLots) {
    warnings.push(`Position size ${result.lots.toFixed(4)} below minimum ${minLots}, using minimum`);
    result.lots = minLots;
  }
  
  if (result.lots > maxLots) {
    warnings.push(`Position size ${result.lots.toFixed(2)} exceeds maximum ${maxLots}, capping`);
    result.lots = maxLots;
  }
  
  // Round to 2 decimal places (standard lot precision)
  result.lots = Math.round(result.lots * 100) / 100;
  
  // Final sanity check
  if (result.lots <= 0 || !Number.isFinite(result.lots)) {
    return createInvalidResult(symbol, assetClass, 'Final lot size is invalid');
  }
  
  // Add common fields
  result.riskAmount = Math.round(riskAmount * 100) / 100;
  result.riskPercent = riskPercent;
  result.stopDistance = stopDistance;
  result.warnings = [...result.warnings, ...warnings];
  
  logger.debug('Position size calculated', {
    symbol,
    assetClass,
    lots: result.lots,
    riskAmount: result.riskAmount,
    stopDistance,
    isApproximate: result.isApproximate,
  });
  
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════════
// CRYPTO POSITION SIZING (EXACT)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate crypto position size
 * 
 * Formula: Lots = RiskAmount / (StopDistance × ContractSize)
 * 
 * This is EXACT - no approximation needed for crypto
 */
function calculateCryptoPosition(
  symbol: string,
  riskAmount: number,
  stopDistance: number,
  assetClass: AssetClass
): PositionSizeResult {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  const contractSize = CRYPTO_CONTRACT_SIZES[normalized];
  
  if (!contractSize) {
    logger.warn('Unknown crypto contract size', { symbol, normalized });
    return createInvalidResult(
      symbol, 
      assetClass, 
      `Unknown crypto symbol: ${symbol}. Add to CRYPTO_CONTRACT_SIZES.`
    );
  }
  
  // ════════════════════════════════════════════════════════════════
  // CRYPTO FORMULA (E8-COMPATIBLE)
  // Risk($) = StopDistance($) × ContractSize × Lots
  // Lots = RiskAmount / (StopDistance × ContractSize)
  // ════════════════════════════════════════════════════════════════
  
  const lots = riskAmount / (stopDistance * contractSize);
  const units = lots * contractSize;
  
  return {
    lots,
    units,
    riskAmount: 0, // Set by caller
    riskPercent: 0, // Set by caller
    stopDistance,
    contractSize,
    assetClass,
    isValid: true,
    isApproximate: false, // Crypto is EXACT
    warnings: [],
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// FOREX POSITION SIZING (APPROXIMATE)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate forex position size
 * 
 * Formula: Lots = RiskAmount / (StopPips × PipValue)
 * 
 * This is APPROXIMATE because:
 * - Pip value varies with exchange rates
 * - Cross pairs need conversion through USD
 * - We use static approximations here
 */
function calculateForexPosition(
  symbol: string,
  entryPrice: number,
  stopLossPrice: number,
  riskAmount: number,
  assetClass: AssetClass
): PositionSizeResult {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  const warnings: string[] = [];
  
  // Determine pip size (JPY pairs vs standard)
  const isJpyPair = normalized.endsWith('JPY');
  const pipSize = isJpyPair ? FOREX_PIP_SIZES.JPY : FOREX_PIP_SIZES.DEFAULT;
  
  // Calculate stop distance in pips
  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  const stopPips = stopDistance / pipSize;
  
  // Get pip value (approximate)
  const pipValue = FOREX_PIP_VALUES[normalized] || FOREX_PIP_VALUES.DEFAULT;
  
  // Warn if using default pip value
  if (!FOREX_PIP_VALUES[normalized]) {
    warnings.push(`Using approximate pip value for ${symbol}`);
  }
  
  // ════════════════════════════════════════════════════════════════
  // FOREX FORMULA
  // Risk($) = StopPips × PipValue × Lots
  // Lots = RiskAmount / (StopPips × PipValue)
  // ════════════════════════════════════════════════════════════════
  
  const lots = riskAmount / (stopPips * pipValue);
  const units = Math.floor(lots * 100000); // Standard lot = 100,000 units
  
  return {
    lots,
    units,
    riskAmount: 0, // Set by caller
    riskPercent: 0, // Set by caller
    stopDistance,
    stopPips: Math.round(stopPips * 10) / 10,
    assetClass,
    isValid: true,
    isApproximate: true, // Forex is APPROXIMATE
    warnings,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// METAL POSITION SIZING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate metal position size (Gold, Silver)
 * 
 * Similar to crypto - uses contract size
 */
function calculateMetalPosition(
  symbol: string,
  riskAmount: number,
  stopDistance: number,
  assetClass: AssetClass
): PositionSizeResult {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  const contractSize = METAL_CONTRACT_SIZES[normalized];
  
  if (!contractSize) {
    return createInvalidResult(symbol, assetClass, `Unknown metal symbol: ${symbol}`);
  }
  
  // Metal formula same as crypto
  const lots = riskAmount / (stopDistance * contractSize);
  const units = lots * contractSize;
  
  return {
    lots,
    units,
    riskAmount: 0,
    riskPercent: 0,
    stopDistance,
    contractSize,
    assetClass,
    isValid: true,
    isApproximate: false, // Metals are exact like crypto
    warnings: [],
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an invalid result with error message
 */
function createInvalidResult(
  symbol: string,
  assetClass: AssetClass,
  error: string
): PositionSizeResult {
  logger.warn('Position sizing failed', { symbol, assetClass, error });
  
  return {
    lots: 0,
    units: 0,
    riskAmount: 0,
    riskPercent: 0,
    stopDistance: 0,
    assetClass,
    isValid: false,
    isApproximate: false,
    warnings: [error],
  };
}

/**
 * Validate position size result before use
 */
export function isValidPosition(result: PositionSizeResult): boolean {
  return (
    result.isValid &&
    result.lots > 0 &&
    Number.isFinite(result.lots) &&
    result.units > 0
  );
}

/**
 * Get contract size for a symbol
 */
export function getContractSize(symbol: string): number | null {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  const assetClass = getAssetClass(symbol);
  
  switch (assetClass) {
    case 'crypto':
      return CRYPTO_CONTRACT_SIZES[normalized] || null;
    case 'metal':
      return METAL_CONTRACT_SIZES[normalized] || null;
    case 'forex':
      return 100000; // Standard lot
    default:
      return null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// E8 COMPLIANCE VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════════

export interface E8ComplianceCheck {
  compliant: boolean;
  violations: string[];
  warnings: string[];
  maxDailyLoss: number;
  maxTotalLoss: number;
  currentRisk: number;
  remainingRisk: number;
}

/**
 * Validate position against E8 Markets rules
 * 
 * E8 Challenge Rules:
 * - Max Daily Loss: 5%
 * - Max Total Loss: 8% (or 10% depending on plan)
 * - No overleveraging
 */
export function checkE8Compliance(
  position: PositionSizeResult,
  accountSize: number,
  currentDailyLoss: number = 0,
  currentTotalLoss: number = 0,
  maxDailyLossPercent: number = 5,
  maxTotalLossPercent: number = 8
): E8ComplianceCheck {
  const violations: string[] = [];
  const warnings: string[] = [];
  
  const maxDailyLoss = accountSize * (maxDailyLossPercent / 100);
  const maxTotalLoss = accountSize * (maxTotalLossPercent / 100);
  const remainingDailyRisk = maxDailyLoss - currentDailyLoss;
  const remainingTotalRisk = maxTotalLoss - currentTotalLoss;
  const remainingRisk = Math.min(remainingDailyRisk, remainingTotalRisk);
  
  // Check if this trade would exceed daily loss limit
  if (position.riskAmount + currentDailyLoss > maxDailyLoss) {
    violations.push(
      `Trade risk ($${position.riskAmount.toFixed(2)}) would exceed daily loss limit. ` +
      `Remaining: $${remainingDailyRisk.toFixed(2)}`
    );
  }
  
  // Check if this trade would exceed total loss limit
  if (position.riskAmount + currentTotalLoss > maxTotalLoss) {
    violations.push(
      `Trade risk ($${position.riskAmount.toFixed(2)}) would exceed total loss limit. ` +
      `Remaining: $${remainingTotalRisk.toFixed(2)}`
    );
  }
  
  // Warn if using more than 50% of remaining risk
  if (position.riskAmount > remainingRisk * 0.5) {
    warnings.push(
      `Trade uses ${((position.riskAmount / remainingRisk) * 100).toFixed(0)}% of remaining risk budget`
    );
  }
  
  // Warn if position is approximate
  if (position.isApproximate) {
    warnings.push('Position size is approximate - verify with broker before entry');
  }
  
  return {
    compliant: violations.length === 0,
    violations,
    warnings,
    maxDailyLoss,
    maxTotalLoss,
    currentRisk: position.riskAmount,
    remainingRisk,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// USAGE EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════════

/*
// CRYPTO EXAMPLE (BTC)
const btcPosition = calculatePositionSize({
  symbol: 'BTCUSD',
  entryPrice: 50000,
  stopLossPrice: 49500,
  accountSize: 10000,
  riskPercent: 0.5,  // $50 risk
});
// Result: lots = 0.10, isApproximate = false

// FOREX EXAMPLE (EUR/USD)
const eurusdPosition = calculatePositionSize({
  symbol: 'EURUSD',
  entryPrice: 1.1000,
  stopLossPrice: 1.0950,
  accountSize: 10000,
  riskPercent: 2,    // $200 risk
});
// Result: lots = 0.40, isApproximate = true

// E8 COMPLIANCE CHECK
const compliance = checkE8Compliance(
  btcPosition,
  10000,      // account size
  150,        // current daily loss
  300,        // current total loss
);
// Result: { compliant: true/false, violations: [...], warnings: [...] }
*/


// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION GUIDE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * STEP 1: Replace old position sizing calls
 * 
 * BEFORE:
 *   const pipValue = isCrypto ? 1 : getPipValue(symbol);
 *   const lots = riskAmount / (stopPips * pipValue);
 * 
 * AFTER:
 *   const position = calculatePositionSize({
 *     symbol,
 *     entryPrice,
 *     stopLossPrice,
 *     accountSize: settings.accountSize,
 *     riskPercent: settings.riskPercent,
 *   });
 *   if (!position.isValid) return null;
 *   const { lots, units } = position;
 * 
 * STEP 2: Update all strategy files that do position sizing
 * 
 * STEP 3: Add E8 compliance check before trade execution
 * 
 * STEP 4: Display isApproximate warning in UI for forex trades
 */

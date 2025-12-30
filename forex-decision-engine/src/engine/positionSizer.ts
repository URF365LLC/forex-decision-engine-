/**
 * Position Sizer Engine
 * Calculates position size based on account, risk, and stop loss
 * 
 * Formula: Position Size = Risk Amount / (Stop Loss Distance × Pip Value)
 */

import { DEFAULTS, LOT_SIZES, PIP_VALUES, getCryptoContractSize } from '../config/defaults.js';
import { getPipDecimals, getAssetClass } from '../config/universe.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('PositionSizer');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PositionSize {
  lots: number;                // Standard lots (e.g., 0.15)
  units: number;               // Currency units (e.g., 15,000)
  riskAmount: number;          // Dollar risk (e.g., $50)
  riskPercent: number;         // Risk percentage (e.g., 0.5%)
  pipValue: number;            // Value per pip per lot
  stopLossPips: number;        // Stop loss in pips
  
  // Validation
  isValid: boolean;
  warning: string | null;
}

export interface SizingInput {
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  accountSize: number;
  riskPercent: number;         // As decimal (0.5% = 0.5)
}

// ═══════════════════════════════════════════════════════════════
// POSITION SIZING
// ═══════════════════════════════════════════════════════════════

export function calculatePositionSize(input: SizingInput): PositionSize {
  const { symbol, entryPrice, stopLossPrice, accountSize, riskPercent } = input;
  
  const riskAmount = accountSize * (riskPercent / 100);
  const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
  const assetClass = getAssetClass(symbol);
  
  let lots = 0;
  let pipValue: number = PIP_VALUES.standard;
  let stopLossPips = 0;
  let units = 0;
  
  if (assetClass === 'crypto') {
    const contractSize = getCryptoContractSize(symbol);
    lots = riskAmount / (stopLossDistance * contractSize);
    pipValue = contractSize;
    stopLossPips = stopLossDistance;
    units = lots * contractSize;
    
    logger.debug(`Crypto position sizing (E8 formula) for ${symbol}`, {
      contractSize,
      stopLossDistance,
      riskAmount,
      lots: Math.round(lots * 100) / 100,
    });
  } else {
    const pipDecimals = getPipDecimals(symbol);
    const pipSize = pipDecimals === 2 ? 0.01 : 0.0001;
    stopLossPips = stopLossDistance / pipSize;
    
    if (symbol.endsWith('JPY')) {
      pipValue = 8.5;
    }
    
    if (stopLossPips > 0 && pipValue > 0) {
      lots = riskAmount / (stopLossPips * pipValue);
    }
    
    units = Math.round(lots * LOT_SIZES.standard);
    
    logger.debug(`Forex position sizing for ${symbol}`, {
      entryPrice,
      stopLossPrice,
      stopLossPips,
      pipValue,
      riskAmount,
      lots: Math.round(lots * 100) / 100,
    });
  }
  
  lots = Math.round(lots * 100) / 100;
  
  let isValid = true;
  let warning: string | null = null;
  
  if (lots > DEFAULTS.risk.maxLotForex) {
    warning = `Position size ${lots} exceeds E8 max lot limit (${DEFAULTS.risk.maxLotForex})`;
    lots = DEFAULTS.risk.maxLotForex;
    isValid = false;
  }
  
  if (lots < 0.01) {
    warning = 'Position size too small (minimum 0.01 lots)';
    lots = 0.01;
    isValid = false;
  }
  
  return {
    lots,
    units,
    riskAmount,
    riskPercent,
    pipValue,
    stopLossPips: Math.round(stopLossPips * 10) / 10,
    isValid,
    warning,
  };
}

// ═══════════════════════════════════════════════════════════════
// STOP LOSS / TAKE PROFIT CALCULATIONS
// ═══════════════════════════════════════════════════════════════

export interface StopLossResult {
  price: number;
  pips: number;
  method: 'swing' | 'atr';
}

export function calculateStopLoss(
  entryPrice: number,
  direction: 'long' | 'short',
  swingLevel: number | null,
  atr: number,
  symbol: string
): StopLossResult {
  const pipDecimals = getPipDecimals(symbol);
  const pipSize = pipDecimals === 2 ? 0.01 : 0.0001;
  const atrMultiplier = 1.5;
  
  let stopPrice: number;
  let method: 'swing' | 'atr';
  
  // Try swing level first
  if (swingLevel !== null) {
    // Add small buffer beyond swing
    const buffer = atr * 0.3;
    
    if (direction === 'long') {
      stopPrice = swingLevel - buffer;
    } else {
      stopPrice = swingLevel + buffer;
    }
    method = 'swing';
  } else {
    // Fallback to ATR-based stop
    const atrStop = atr * atrMultiplier;
    
    if (direction === 'long') {
      stopPrice = entryPrice - atrStop;
    } else {
      stopPrice = entryPrice + atrStop;
    }
    method = 'atr';
  }
  
  // Calculate pips
  const pips = Math.abs(entryPrice - stopPrice) / pipSize;
  
  return {
    price: roundPrice(stopPrice, pipDecimals),
    pips: Math.round(pips * 10) / 10,
    method,
  };
}

export interface TakeProfitResult {
  price: number;
  pips: number;
  riskReward: number;
}

export function calculateTakeProfit(
  entryPrice: number,
  stopLossPrice: number,
  direction: 'long' | 'short',
  minRR: number,
  symbol: string
): TakeProfitResult {
  const pipDecimals = getPipDecimals(symbol);
  const pipSize = pipDecimals === 2 ? 0.01 : 0.0001;
  
  const riskDistance = Math.abs(entryPrice - stopLossPrice);
  const rewardDistance = riskDistance * minRR;
  
  let takeProfit: number;
  
  if (direction === 'long') {
    takeProfit = entryPrice + rewardDistance;
  } else {
    takeProfit = entryPrice - rewardDistance;
  }
  
  const pips = rewardDistance / pipSize;
  
  return {
    price: roundPrice(takeProfit, pipDecimals),
    pips: Math.round(pips * 10) / 10,
    riskReward: minRR,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function roundPrice(price: number, decimals: number): number {
  const precision = decimals === 2 ? 3 : 5;
  return Math.round(price * Math.pow(10, precision)) / Math.pow(10, precision);
}

/**
 * Format position size for display
 */
export function formatPositionSize(size: PositionSize): string {
  return `${size.lots} lots ($${size.riskAmount.toFixed(0)} risk)`;
}

/**
 * Format price with appropriate precision
 */
export function formatPrice(price: number, symbol: string): string {
  const decimals = getPipDecimals(symbol);
  const precision = decimals === 2 ? 3 : 5;
  return price.toFixed(precision);
}

/**
 * Volatility Gate Service
 * Filters out signals during extreme volatility conditions
 * 
 * Gating Rules:
 * 1. ATR > 2x 20-period average = HIGH VOLATILITY (gate closed)
 * 2. ATR < 0.3x 20-period average = LOW VOLATILITY (gate closed)
 * 3. Normal ATR range = gate open
 * 
 * This prevents:
 * - Trading during news spikes (extreme ATR)
 * - Trading in dead markets (no movement)
 */

import { createLogger } from './logger.js';

const logger = createLogger('VolatilityGate');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type VolatilityLevel = 'low' | 'normal' | 'high' | 'extreme';

export interface VolatilityCheck {
  allowed: boolean;
  level: VolatilityLevel;
  currentAtr: number;
  averageAtr: number;
  ratio: number;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const VOLATILITY_CONFIG = {
  // ATR ratio thresholds
  thresholds: {
    extremeHigh: 3.0,    // ATR > 3x average = EXTREME (blocked)
    high: 2.0,           // ATR > 2x average = HIGH (blocked)
    low: 0.3,            // ATR < 0.3x average = LOW (blocked)
    extremeLow: 0.15,    // ATR < 0.15x average = EXTREME LOW (blocked)
  },
  
  // Lookback period for average ATR
  averagePeriod: 20,
  
  // Asset-specific multipliers (some pairs are naturally more volatile)
  assetMultipliers: {
    // Crypto is naturally more volatile
    'BTCUSD': 1.5,
    'ETHUSD': 1.5,
    'XRPUSD': 1.8,
    'SOLUSD': 1.8,
    'DOGEUSD': 2.0,
    'ADAUSD': 1.6,
    'DOTUSD': 1.6,
    'LINKUSD': 1.6,
    
    // Exotic pairs
    'USDZAR': 1.3,
    'USDMXN': 1.3,
    'USDTRY': 1.5,
    'USDSEK': 1.2,
    'USDNOK': 1.2,
    'USDDKK': 1.1,
    'USDSGD': 1.1,
    'USDHKD': 0.8,  // Pegged, very low volatility
  } as Record<string, number>,
};

// ═══════════════════════════════════════════════════════════════
// VOLATILITY GATE
// ═══════════════════════════════════════════════════════════════

/**
 * Check if volatility conditions allow trading
 */
export function checkVolatility(
  symbol: string,
  currentAtr: number,
  atrHistory: number[]
): VolatilityCheck {
  // Need enough history for average
  if (atrHistory.length < 5) {
    logger.warn(`Insufficient ATR history for ${symbol}, allowing by default`);
    return {
      allowed: true,
      level: 'normal',
      currentAtr,
      averageAtr: currentAtr,
      ratio: 1.0,
      reason: 'Insufficient ATR history',
    };
  }

  // Calculate average ATR (use most recent values - array is sorted oldest to newest)
  const recentAtr = atrHistory.slice(-VOLATILITY_CONFIG.averagePeriod);
  const averageAtr = recentAtr.reduce((sum, v) => sum + v, 0) / recentAtr.length;

  // Calculate ratio
  let ratio = averageAtr > 0 ? currentAtr / averageAtr : 1.0;

  // Apply asset-specific multiplier
  const multiplier = VOLATILITY_CONFIG.assetMultipliers[symbol] || 1.0;
  const adjustedThresholds = {
    extremeHigh: VOLATILITY_CONFIG.thresholds.extremeHigh * multiplier,
    high: VOLATILITY_CONFIG.thresholds.high * multiplier,
    low: VOLATILITY_CONFIG.thresholds.low / multiplier,
    extremeLow: VOLATILITY_CONFIG.thresholds.extremeLow / multiplier,
  };

  // Determine level
  let level: VolatilityLevel;
  let allowed: boolean;
  let reason: string;

  if (ratio >= adjustedThresholds.extremeHigh) {
    level = 'extreme';
    allowed = false;
    reason = `Extreme volatility: ATR ${ratio.toFixed(1)}x average (>${adjustedThresholds.extremeHigh.toFixed(1)}x threshold)`;
  } else if (ratio >= adjustedThresholds.high) {
    level = 'high';
    allowed = false;
    reason = `High volatility: ATR ${ratio.toFixed(1)}x average (>${adjustedThresholds.high.toFixed(1)}x threshold)`;
  } else if (ratio <= adjustedThresholds.extremeLow) {
    level = 'low';
    allowed = false;
    reason = `Extremely low volatility: ATR ${ratio.toFixed(2)}x average (<${adjustedThresholds.extremeLow.toFixed(2)}x threshold)`;
  } else if (ratio <= adjustedThresholds.low) {
    level = 'low';
    allowed = false;
    reason = `Low volatility: ATR ${ratio.toFixed(2)}x average (<${adjustedThresholds.low.toFixed(2)}x threshold)`;
  } else {
    level = 'normal';
    allowed = true;
    reason = `Normal volatility: ATR ${ratio.toFixed(2)}x average`;
  }

  if (!allowed) {
    logger.info(`Volatility gate CLOSED for ${symbol}: ${reason}`);
  }

  return {
    allowed,
    level,
    currentAtr,
    averageAtr,
    ratio,
    reason,
  };
}

/**
 * Get volatility level label for UI
 */
export function getVolatilityLabel(level: VolatilityLevel): string {
  switch (level) {
    case 'extreme': return '🔴 EXTREME';
    case 'high': return '🟠 HIGH';
    case 'low': return '🟡 LOW';
    case 'normal': return '🟢 NORMAL';
  }
}

/**
 * Get volatility color for UI
 */
export function getVolatilityColor(level: VolatilityLevel): string {
  switch (level) {
    case 'extreme': return '#ef4444';
    case 'high': return '#f97316';
    case 'low': return '#eab308';
    case 'normal': return '#22c55e';
  }
}

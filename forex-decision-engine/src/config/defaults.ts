/**
 * Default Settings - E8 Markets Prop Firm Rules
 * Based on $10,000 account with standard E8 rules
 */

export const DEFAULTS = {
  // ═══════════════════════════════════════════════════════════════
  // ACCOUNT SETTINGS
  // ═══════════════════════════════════════════════════════════════
  account: {
    size: 10000,               // $10,000 initial balance
    currency: 'USD',
  },

  // ═══════════════════════════════════════════════════════════════
  // RISK MANAGEMENT (E8 Markets Rules)
  // ═══════════════════════════════════════════════════════════════
  risk: {
    perTrade: 0.5,             // 0.5% risk per trade ($50 on $10k)
    dailyLossLimit: 4,         // 4% max daily loss
    maxDrawdown: 6,            // 6% dynamic drawdown
    maxLotForex: 50,           // E8 max lot size for forex
    maxLotGold: 20,            // E8 max lot size for XAUUSD
    maxOrders: 100,            // E8 max open orders
  },

  // ═══════════════════════════════════════════════════════════════
  // LEVERAGE (E8 Markets)
  // ═══════════════════════════════════════════════════════════════
  leverage: {
    forex: 50,                 // 1:50 for forex majors
    indices: 25,               // 1:25 for indices/metals
    crypto: 2,                 // 1:2 for crypto
  },

  // ═══════════════════════════════════════════════════════════════
  // TRADING STYLE
  // ═══════════════════════════════════════════════════════════════
  style: 'intraday' as const,

  // ═══════════════════════════════════════════════════════════════
  // UI DEFAULTS
  // ═══════════════════════════════════════════════════════════════
  timezone: 'America/Chicago', // Central Time
} as const;

// ═══════════════════════════════════════════════════════════════
// RISK OPTIONS (User Selectable)
// ═══════════════════════════════════════════════════════════════

export const RISK_OPTIONS = [
  { value: 0.25, label: '0.25% (Conservative)' },
  { value: 0.5, label: '0.5% (Recommended)' },
  { value: 1.0, label: '1% (Standard)' },
  { value: 2.0, label: '2% (Aggressive)' },
] as const;

// ═══════════════════════════════════════════════════════════════
// VALIDATION LIMITS
// ═══════════════════════════════════════════════════════════════

export const VALIDATION = {
  account: {
    min: 100,
    max: 1000000,
  },
  risk: {
    min: 0.1,
    max: 5.0,
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// LOT SIZE STANDARDS
// ═══════════════════════════════════════════════════════════════

export const LOT_SIZES = {
  standard: 100000,            // 1 standard lot = 100,000 units
  mini: 10000,                 // 1 mini lot = 10,000 units
  micro: 1000,                 // 1 micro lot = 1,000 units
} as const;

// Pip values per standard lot (for USD quote pairs)
export const PIP_VALUES = {
  standard: 10,                // $10 per pip per standard lot
  mini: 1,                     // $1 per pip per mini lot
  micro: 0.1,                  // $0.10 per pip per micro lot
} as const;

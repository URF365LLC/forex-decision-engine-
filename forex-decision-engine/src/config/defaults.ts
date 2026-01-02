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
  // LEVERAGE (E8 One Account Type)
  // Source: https://help.e8markets.com/en/articles/11775980-e8-one
  // ═══════════════════════════════════════════════════════════════
  leverage: {
    forex: 30,                 // 1:30 for forex
    indices: 15,               // 1:15 for indices
    metals: 15,                // 1:15 for metals (XAUUSD, XAGUSD)
    crypto: 1,                 // 1:1 for crypto (NO LEVERAGE!)
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
} as const;

// ═══════════════════════════════════════════════════════════════
// CRYPTO CONTRACT SIZES - E8 Markets MT5 Specifications
// VERIFIED: 2026-01-02 via MT5 Symbol Specification screenshots
// CRITICAL: Unknown symbols FAIL CLOSED - do NOT default to 1
// ═══════════════════════════════════════════════════════════════

export const CRYPTO_CONTRACT_SIZES: Record<string, number> = {
  BTCUSD: 2,           // 1 lot = 2 BTC        (MT5 verified)
  ETHUSD: 20,          // 1 lot = 20 ETH       (MT5 verified)
  XRPUSD: 100000,      // 1 lot = 100,000 XRP  (MT5 verified)
  ADAUSD: 100000,      // 1 lot = 100,000 ADA  (MT5 verified)
  SOLUSD: 500,         // 1 lot = 500 SOL      (MT5 verified)
  LTCUSD: 500,         // 1 lot = 500 LTC      (MT5 verified)
  BCHUSD: 200,         // 1 lot = 200 BCH      (MT5 verified)
  BNBUSD: 200,         // 1 lot = 200 BNB      (MT5 verified)
} as const;

export const KNOWN_CRYPTO_SYMBOLS = Object.keys(CRYPTO_CONTRACT_SIZES);

export function getCryptoContractSize(symbol: string): number | null {
  const normalized = symbol.toUpperCase().replace(/[\/\-_]/g, '');
  const size = CRYPTO_CONTRACT_SIZES[normalized];

  if (size === undefined) {
    console.error(`[FATAL] getCryptoContractSize: Unknown symbol "${symbol}" (normalized: "${normalized}")`);
    console.error(`[FATAL] Known symbols: ${KNOWN_CRYPTO_SYMBOLS.join(', ')}`);
    console.error(`[FATAL] Trade MUST be blocked to prevent position sizing catastrophe`);
    return null;
  }

  return size;
}

export function isKnownCryptoSymbol(symbol: string): boolean {
  const normalized = symbol.toUpperCase().replace(/[\/\-_]/g, '');
  return normalized in CRYPTO_CONTRACT_SIZES;
}

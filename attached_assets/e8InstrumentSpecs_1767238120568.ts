// src/config/e8InstrumentSpecs.ts
// E8 Markets Instrument Specifications for Position Sizing
// Account Currency: USD | Platform: MT5/MatchTrader/cTrader

export type AssetType = 'forex' | 'index' | 'commodity' | 'metal' | 'crypto';

export interface InstrumentSpec {
  symbol: string;           // E8 symbol (as shown in MT5)
  dataSymbol: string;       // Twelve Data API symbol
  displayName: string;      // Human readable name
  type: AssetType;
  contractSize: number;     // Units per 1.0 lot
  commission: number;       // USD per lot (round trip)
  avgSpread: number;        // Average spread in price units
  avgSpreadPips: number;    // Average spread in pips
  pipSize: number;          // Price movement per pip (0.0001 or 0.01)
  pipValue: number;         // USD value per pip per standard lot (approximate)
  quoteCurrency: string;    // Quote currency
  leverage: number;         // Max leverage (E8 Signature)
  maxLotSize: number;       // Max lots per trade
  tradingHours: string;     // UTC+2 timezone
  digits: number;           // Decimal places
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOREX PAIRS (28 pairs) - Contract: 100,000 | Commission: $0 | Leverage: 1:30
// ═══════════════════════════════════════════════════════════════════════════════

export const FOREX_SPECS: InstrumentSpec[] = [
  // === USD Quote Pairs (Pip Value = $10 per standard lot) ===
  { symbol: 'EURUSD', dataSymbol: 'EUR/USD', displayName: 'Euro / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00005, avgSpreadPips: 0.5, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPUSD', dataSymbol: 'GBP/USD', displayName: 'British Pound / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00005, avgSpreadPips: 0.5, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'AUDUSD', dataSymbol: 'AUD/USD', displayName: 'Australian Dollar / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00006, avgSpreadPips: 0.6, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'NZDUSD', dataSymbol: 'NZD/USD', displayName: 'New Zealand Dollar / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00008, avgSpreadPips: 0.8, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },

  // === JPY Quote Pairs (Pip Value ≈ $6.40 per standard lot at USD/JPY ~156) ===
  { symbol: 'USDJPY', dataSymbol: 'USD/JPY', displayName: 'US Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.006, avgSpreadPips: 0.6, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'EURJPY', dataSymbol: 'EUR/JPY', displayName: 'Euro / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.009, avgSpreadPips: 0.9, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'GBPJPY', dataSymbol: 'GBP/JPY', displayName: 'British Pound / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.014, avgSpreadPips: 1.4, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'AUDJPY', dataSymbol: 'AUD/JPY', displayName: 'Australian Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.011, avgSpreadPips: 1.1, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'NZDJPY', dataSymbol: 'NZD/JPY', displayName: 'New Zealand Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.015, avgSpreadPips: 1.5, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'CADJPY', dataSymbol: 'CAD/JPY', displayName: 'Canadian Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.012, avgSpreadPips: 1.2, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'CHFJPY', dataSymbol: 'CHF/JPY', displayName: 'Swiss Franc / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.019, avgSpreadPips: 1.9, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },

  // === CAD Quote Pairs ===
  { symbol: 'USDCAD', dataSymbol: 'USD/CAD', displayName: 'US Dollar / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURCAD', dataSymbol: 'EUR/CAD', displayName: 'Euro / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00010, avgSpreadPips: 1.0, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPCAD', dataSymbol: 'GBP/CAD', displayName: 'British Pound / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00010, avgSpreadPips: 1.0, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'AUDCAD', dataSymbol: 'AUD/CAD', displayName: 'Australian Dollar / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00014, avgSpreadPips: 1.4, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'NZDCAD', dataSymbol: 'NZD/CAD', displayName: 'New Zealand Dollar / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00012, avgSpreadPips: 1.2, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },

  // === CHF Quote Pairs ===
  { symbol: 'USDCHF', dataSymbol: 'USD/CHF', displayName: 'US Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURCHF', dataSymbol: 'EUR/CHF', displayName: 'Euro / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00006, avgSpreadPips: 0.6, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPCHF', dataSymbol: 'GBP/CHF', displayName: 'British Pound / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00007, avgSpreadPips: 0.7, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'AUDCHF', dataSymbol: 'AUD/CHF', displayName: 'Australian Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'NZDCHF', dataSymbol: 'NZD/CHF', displayName: 'New Zealand Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'CADCHF', dataSymbol: 'CAD/CHF', displayName: 'Canadian Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00008, avgSpreadPips: 0.8, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },

  // === GBP Quote Pairs ===
  { symbol: 'EURGBP', dataSymbol: 'EUR/GBP', displayName: 'Euro / British Pound', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00005, avgSpreadPips: 0.5, pipSize: 0.0001, pipValue: 13.48, quoteCurrency: 'GBP', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },

  // === AUD Quote Pairs ===
  { symbol: 'EURAUD', dataSymbol: 'EUR/AUD', displayName: 'Euro / Australian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00010, avgSpreadPips: 1.0, pipSize: 0.0001, pipValue: 6.70, quoteCurrency: 'AUD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPAUD', dataSymbol: 'GBP/AUD', displayName: 'British Pound / Australian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00023, avgSpreadPips: 2.3, pipSize: 0.0001, pipValue: 6.70, quoteCurrency: 'AUD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },

  // === NZD Quote Pairs ===
  { symbol: 'AUDNZD', dataSymbol: 'AUD/NZD', displayName: 'Australian Dollar / New Zealand Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00016, avgSpreadPips: 1.6, pipSize: 0.0001, pipValue: 5.80, quoteCurrency: 'NZD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURNZD', dataSymbol: 'EUR/NZD', displayName: 'Euro / New Zealand Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00020, avgSpreadPips: 2.0, pipSize: 0.0001, pipValue: 5.80, quoteCurrency: 'NZD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPNZD', dataSymbol: 'GBP/NZD', displayName: 'British Pound / New Zealand Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00036, avgSpreadPips: 3.6, pipSize: 0.0001, pipValue: 5.80, quoteCurrency: 'NZD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// INDICES (6 indices) - Commission: $6-12 | Leverage: 1:15
// ═══════════════════════════════════════════════════════════════════════════════

export const INDEX_SPECS: InstrumentSpec[] = [
  { symbol: 'SP', dataSymbol: 'SPX', displayName: 'S&P 500', type: 'index', contractSize: 20, commission: 6, avgSpread: 0.90, avgSpreadPips: 0.9, pipSize: 1, pipValue: 20, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'NSDQ', dataSymbol: 'NDX', displayName: 'Nasdaq 100', type: 'index', contractSize: 5, commission: 6, avgSpread: 0.70, avgSpreadPips: 0.7, pipSize: 1, pipValue: 5, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 1 },
  { symbol: 'DOW', dataSymbol: 'DJI', displayName: 'Dow Jones Industrial', type: 'index', contractSize: 5, commission: 12, avgSpread: 0.47, avgSpreadPips: 0.47, pipSize: 1, pipValue: 5, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'DAX', dataSymbol: 'GDAXI', displayName: 'Germany 40 (DAX)', type: 'index', contractSize: 5, commission: 6, avgSpread: 1.2, avgSpreadPips: 1.2, pipSize: 1, pipValue: 5, quoteCurrency: 'EUR', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'NIKKEI', dataSymbol: 'N225', displayName: 'Japan 225 (Nikkei)', type: 'index', contractSize: 500, commission: 6, avgSpread: 6.5, avgSpreadPips: 6.5, pipSize: 1, pipValue: 3.21, quoteCurrency: 'JPY', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'ASX', dataSymbol: 'AXJO', displayName: 'Australia 200', type: 'index', contractSize: 20, commission: 12, avgSpread: 0.84, avgSpreadPips: 0.84, pipSize: 1, pipValue: 13.40, quoteCurrency: 'AUD', leverage: 15, maxLotSize: 50, tradingHours: '02:50-09:30,10:10-23:59', digits: 2 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMMODITIES (2 energy) - Commission: $6 | Leverage: 1:15
// ═══════════════════════════════════════════════════════════════════════════════

export const COMMODITY_SPECS: InstrumentSpec[] = [
  { symbol: 'WTI', dataSymbol: 'CL', displayName: 'WTI Crude Oil', type: 'commodity', contractSize: 1000, commission: 6, avgSpread: 0.030, avgSpreadPips: 3.0, pipSize: 0.01, pipValue: 10, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 3 },
  { symbol: 'BRENT', dataSymbol: 'BZ', displayName: 'Brent Crude Oil', type: 'commodity', contractSize: 1000, commission: 6, avgSpread: 0.026, avgSpreadPips: 2.6, pipSize: 0.01, pipValue: 10, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '03:05-23:55', digits: 3 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// METALS (2 precious) - Commission: $6 | Leverage: 1:15
// ═══════════════════════════════════════════════════════════════════════════════

export const METAL_SPECS: InstrumentSpec[] = [
  { symbol: 'XAUUSD', dataSymbol: 'XAU/USD', displayName: 'Gold / US Dollar', type: 'metal', contractSize: 100, commission: 6, avgSpread: 0.34, avgSpreadPips: 34, pipSize: 0.01, pipValue: 1, quoteCurrency: 'USD', leverage: 15, maxLotSize: 20, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'XAGUSD', dataSymbol: 'XAG/USD', displayName: 'Silver / US Dollar', type: 'metal', contractSize: 5000, commission: 6, avgSpread: 0.054, avgSpreadPips: 5.4, pipSize: 0.01, pipValue: 50, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 3 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED SPECS MAP (for quick lookup)
// ═══════════════════════════════════════════════════════════════════════════════

export const ALL_INSTRUMENTS: InstrumentSpec[] = [
  ...FOREX_SPECS,
  ...INDEX_SPECS,
  ...COMMODITY_SPECS,
  ...METAL_SPECS,
];

export const INSTRUMENT_MAP: Map<string, InstrumentSpec> = new Map(
  ALL_INSTRUMENTS.map(spec => [spec.symbol, spec])
);

// Lookup by Twelve Data symbol
export const DATA_SYMBOL_MAP: Map<string, InstrumentSpec> = new Map(
  ALL_INSTRUMENTS.map(spec => [spec.dataSymbol, spec])
);

// ═══════════════════════════════════════════════════════════════════════════════
// POSITION SIZE CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

export interface PositionSizeInput {
  symbol: string;
  accountBalance: number;      // USD
  riskPercent: number;         // e.g., 1 for 1%
  stopLossPips: number;        // Distance to SL in pips
  includeSpreadInRisk?: boolean;
}

export interface PositionSizeResult {
  lots: number;
  units: number;
  riskAmount: number;          // USD at risk
  pipValue: number;            // Per lot
  spreadCost: number;          // USD
  totalCost: number;           // Spread + Commission
  marginRequired: number;      // Approximate margin needed
  maxAllowedLots: number;      // Per E8 rules
}

/**
 * Calculate position size for E8 Markets account
 */
export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult | null {
  const spec = INSTRUMENT_MAP.get(input.symbol);
  if (!spec) {
    console.error(`Unknown symbol: ${input.symbol}`);
    return null;
  }

  const { accountBalance, riskPercent, stopLossPips, includeSpreadInRisk = true } = input;

  // Risk amount in USD
  const riskAmount = accountBalance * (riskPercent / 100);

  // Effective SL distance (optionally add spread)
  const effectiveSLPips = includeSpreadInRisk 
    ? stopLossPips + spec.avgSpreadPips 
    : stopLossPips;

  // Position size formula: Risk / (SL in pips × Pip Value)
  let lots = riskAmount / (effectiveSLPips * spec.pipValue);

  // Round to 2 decimal places (0.01 lot minimum)
  lots = Math.floor(lots * 100) / 100;

  // Enforce E8 max lot size
  lots = Math.min(lots, spec.maxLotSize);

  // Calculate derived values
  const units = lots * spec.contractSize;
  const spreadCost = lots * spec.avgSpreadPips * spec.pipValue;
  const commissionCost = lots * spec.commission;
  const totalCost = spreadCost + commissionCost;

  // Approximate margin (simplified - assumes USD account)
  // Margin = (Lots × Contract Size × Price) / Leverage
  // Using pipValue as proxy since we don't have current price
  const marginRequired = (units * 1) / spec.leverage; // Simplified

  return {
    lots,
    units,
    riskAmount,
    pipValue: spec.pipValue,
    spreadCost,
    totalCost,
    marginRequired,
    maxAllowedLots: spec.maxLotSize,
  };
}

/**
 * Get instrument spec by symbol
 */
export function getInstrumentSpec(symbol: string): InstrumentSpec | undefined {
  return INSTRUMENT_MAP.get(symbol) || DATA_SYMBOL_MAP.get(symbol);
}

/**
 * Convert E8 symbol to Twelve Data symbol
 */
export function toDataSymbol(e8Symbol: string): string | undefined {
  return INSTRUMENT_MAP.get(e8Symbol)?.dataSymbol;
}

/**
 * Convert Twelve Data symbol to E8 symbol
 */
export function toE8Symbol(dataSymbol: string): string | undefined {
  return DATA_SYMBOL_MAP.get(dataSymbol)?.symbol;
}

// ═══════════════════════════════════════════════════════════════════════════════
// E8 ACCOUNT RULES
// ═══════════════════════════════════════════════════════════════════════════════

export const E8_RULES = {
  maxLotSizePerTrade: 50,
  maxLotSizeXAUUSD: 20,
  maxOpenOrders: 100,
  maxDailyRequests: 2000,
  maxTradesPerDay: 2000,
  inactivityDays: 90,
  minTradeDuration: 60, // 50% of trades must be > 1 minute
  accountCurrency: 'USD',
  leverage: {
    forex: 30,
    indices: 15,
    metals: 15,
    energies: 15,
    crypto: 1,
  },
} as const;

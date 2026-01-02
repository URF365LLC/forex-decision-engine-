/**
 * E8 Markets Instrument Specifications for Position Sizing
 * Account Currency: USD | Platform: MT5/MatchTrader/cTrader
 * 
 * SINGLE SOURCE OF TRUTH for all instrument specifications
 * All other files should import from here, NOT from universe.ts
 */

import { createLogger } from '../services/logger.js';

const logger = createLogger('E8InstrumentSpecs');

export type AssetType = 'forex' | 'index' | 'commodity' | 'metal' | 'crypto';

export interface InstrumentSpec {
  symbol: string;
  dataSymbol: string;
  displayName: string;
  type: AssetType;
  contractSize: number;
  commission: number;
  commissionPercent?: number;
  avgSpread: number;
  avgSpreadPips: number;
  pipSize: number;
  pipValue: number;
  quoteCurrency: string;
  leverage: number;
  maxLotSize: number;
  tradingHours: string;
  digits: number;
}

export const FOREX_SPECS: InstrumentSpec[] = [
  { symbol: 'EURUSD', dataSymbol: 'EUR/USD', displayName: 'Euro / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00005, avgSpreadPips: 0.5, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPUSD', dataSymbol: 'GBP/USD', displayName: 'British Pound / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00005, avgSpreadPips: 0.5, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'AUDUSD', dataSymbol: 'AUD/USD', displayName: 'Australian Dollar / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00006, avgSpreadPips: 0.6, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'NZDUSD', dataSymbol: 'NZD/USD', displayName: 'New Zealand Dollar / US Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00008, avgSpreadPips: 0.8, pipSize: 0.0001, pipValue: 10, quoteCurrency: 'USD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'USDJPY', dataSymbol: 'USD/JPY', displayName: 'US Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.006, avgSpreadPips: 0.6, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'EURJPY', dataSymbol: 'EUR/JPY', displayName: 'Euro / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.009, avgSpreadPips: 0.9, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'GBPJPY', dataSymbol: 'GBP/JPY', displayName: 'British Pound / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.014, avgSpreadPips: 1.4, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'AUDJPY', dataSymbol: 'AUD/JPY', displayName: 'Australian Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.011, avgSpreadPips: 1.1, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'NZDJPY', dataSymbol: 'NZD/JPY', displayName: 'New Zealand Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.015, avgSpreadPips: 1.5, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'CADJPY', dataSymbol: 'CAD/JPY', displayName: 'Canadian Dollar / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.012, avgSpreadPips: 1.2, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'CHFJPY', dataSymbol: 'CHF/JPY', displayName: 'Swiss Franc / Japanese Yen', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.019, avgSpreadPips: 1.9, pipSize: 0.01, pipValue: 6.41, quoteCurrency: 'JPY', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 3 },
  { symbol: 'USDCAD', dataSymbol: 'USD/CAD', displayName: 'US Dollar / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURCAD', dataSymbol: 'EUR/CAD', displayName: 'Euro / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00010, avgSpreadPips: 1.0, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPCAD', dataSymbol: 'GBP/CAD', displayName: 'British Pound / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00010, avgSpreadPips: 1.0, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'AUDCAD', dataSymbol: 'AUD/CAD', displayName: 'Australian Dollar / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00014, avgSpreadPips: 1.4, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'NZDCAD', dataSymbol: 'NZD/CAD', displayName: 'New Zealand Dollar / Canadian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00012, avgSpreadPips: 1.2, pipSize: 0.0001, pipValue: 7.30, quoteCurrency: 'CAD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'USDCHF', dataSymbol: 'USD/CHF', displayName: 'US Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURCHF', dataSymbol: 'EUR/CHF', displayName: 'Euro / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00006, avgSpreadPips: 0.6, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPCHF', dataSymbol: 'GBP/CHF', displayName: 'British Pound / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00007, avgSpreadPips: 0.7, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'AUDCHF', dataSymbol: 'AUD/CHF', displayName: 'Australian Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'NZDCHF', dataSymbol: 'NZD/CHF', displayName: 'New Zealand Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00009, avgSpreadPips: 0.9, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'CADCHF', dataSymbol: 'CAD/CHF', displayName: 'Canadian Dollar / Swiss Franc', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00008, avgSpreadPips: 0.8, pipSize: 0.0001, pipValue: 12.65, quoteCurrency: 'CHF', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURGBP', dataSymbol: 'EUR/GBP', displayName: 'Euro / British Pound', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00005, avgSpreadPips: 0.5, pipSize: 0.0001, pipValue: 13.48, quoteCurrency: 'GBP', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURAUD', dataSymbol: 'EUR/AUD', displayName: 'Euro / Australian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00010, avgSpreadPips: 1.0, pipSize: 0.0001, pipValue: 6.70, quoteCurrency: 'AUD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPAUD', dataSymbol: 'GBP/AUD', displayName: 'British Pound / Australian Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00023, avgSpreadPips: 2.3, pipSize: 0.0001, pipValue: 6.70, quoteCurrency: 'AUD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'AUDNZD', dataSymbol: 'AUD/NZD', displayName: 'Australian Dollar / New Zealand Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00016, avgSpreadPips: 1.6, pipSize: 0.0001, pipValue: 5.80, quoteCurrency: 'NZD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'EURNZD', dataSymbol: 'EUR/NZD', displayName: 'Euro / New Zealand Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00020, avgSpreadPips: 2.0, pipSize: 0.0001, pipValue: 5.80, quoteCurrency: 'NZD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'GBPNZD', dataSymbol: 'GBP/NZD', displayName: 'British Pound / New Zealand Dollar', type: 'forex', contractSize: 100000, commission: 0, avgSpread: 0.00036, avgSpreadPips: 3.6, pipSize: 0.0001, pipValue: 5.80, quoteCurrency: 'NZD', leverage: 30, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
];

export const INDEX_SPECS: InstrumentSpec[] = [
  { symbol: 'SP', dataSymbol: 'SPX', displayName: 'S&P 500', type: 'index', contractSize: 20, commission: 6, avgSpread: 0.90, avgSpreadPips: 0.9, pipSize: 1, pipValue: 20, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'NSDQ', dataSymbol: 'NDX', displayName: 'Nasdaq 100', type: 'index', contractSize: 5, commission: 6, avgSpread: 0.70, avgSpreadPips: 0.7, pipSize: 1, pipValue: 5, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 1 },
  { symbol: 'DOW', dataSymbol: 'DJI', displayName: 'Dow Jones Industrial', type: 'index', contractSize: 5, commission: 12, avgSpread: 0.47, avgSpreadPips: 0.47, pipSize: 1, pipValue: 5, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'DAX', dataSymbol: 'GDAXI', displayName: 'Germany 40 (DAX)', type: 'index', contractSize: 5, commission: 6, avgSpread: 1.2, avgSpreadPips: 1.2, pipSize: 1, pipValue: 5, quoteCurrency: 'EUR', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'NIKKEI', dataSymbol: 'N225', displayName: 'Japan 225 (Nikkei)', type: 'index', contractSize: 500, commission: 6, avgSpread: 6.5, avgSpreadPips: 6.5, pipSize: 1, pipValue: 3.21, quoteCurrency: 'JPY', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'ASX', dataSymbol: 'AXJO', displayName: 'Australia 200', type: 'index', contractSize: 20, commission: 12, avgSpread: 0.84, avgSpreadPips: 0.84, pipSize: 1, pipValue: 13.40, quoteCurrency: 'AUD', leverage: 15, maxLotSize: 50, tradingHours: '02:50-09:30,10:10-23:59', digits: 2 },
];

export const COMMODITY_SPECS: InstrumentSpec[] = [
  { symbol: 'WTI', dataSymbol: 'CL', displayName: 'WTI Crude Oil', type: 'commodity', contractSize: 1000, commission: 6, avgSpread: 0.030, avgSpreadPips: 3.0, pipSize: 0.01, pipValue: 10, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 3 },
  { symbol: 'BRENT', dataSymbol: 'BZ', displayName: 'Brent Crude Oil', type: 'commodity', contractSize: 1000, commission: 6, avgSpread: 0.026, avgSpreadPips: 2.6, pipSize: 0.01, pipValue: 10, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '03:05-23:55', digits: 3 },
];

export const METAL_SPECS: InstrumentSpec[] = [
  { symbol: 'XAUUSD', dataSymbol: 'XAU/USD', displayName: 'Gold / US Dollar', type: 'metal', contractSize: 100, commission: 6, avgSpread: 0.34, avgSpreadPips: 34, pipSize: 0.01, pipValue: 1, quoteCurrency: 'USD', leverage: 15, maxLotSize: 20, tradingHours: '01:05-23:55', digits: 2 },
  { symbol: 'XAGUSD', dataSymbol: 'XAG/USD', displayName: 'Silver / US Dollar', type: 'metal', contractSize: 5000, commission: 6, avgSpread: 0.054, avgSpreadPips: 5.4, pipSize: 0.01, pipValue: 50, quoteCurrency: 'USD', leverage: 15, maxLotSize: 50, tradingHours: '01:05-23:55', digits: 3 },
];

// CRYPTO SPECS - E8 Markets MT5 (VERIFIED 2026-01-02)
export const CRYPTO_SPECS: InstrumentSpec[] = [
  { symbol: 'BTCUSD', dataSymbol: 'BTC/USD', displayName: 'Bitcoin', type: 'crypto', contractSize: 2, commission: 0, commissionPercent: 0.035, avgSpread: 12, avgSpreadPips: 12, pipSize: 1, pipValue: 2, quoteCurrency: 'USD', leverage: 1, maxLotSize: 10, tradingHours: '00:05-23:55', digits: 2 },
  { symbol: 'ETHUSD', dataSymbol: 'ETH/USD', displayName: 'Ethereum', type: 'crypto', contractSize: 20, commission: 0, commissionPercent: 0.035, avgSpread: 0.59, avgSpreadPips: 59, pipSize: 0.01, pipValue: 0.2, quoteCurrency: 'USD', leverage: 1, maxLotSize: 100, tradingHours: '00:05-23:55', digits: 2 },
  { symbol: 'XRPUSD', dataSymbol: 'XRP/USD', displayName: 'Ripple', type: 'crypto', contractSize: 100000, commission: 0, commissionPercent: 0.035, avgSpread: 0.0003, avgSpreadPips: 3, pipSize: 0.00001, pipValue: 1, quoteCurrency: 'USD', leverage: 1, maxLotSize: 50, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'ADAUSD', dataSymbol: 'ADA/USD', displayName: 'Cardano', type: 'crypto', contractSize: 100000, commission: 0, commissionPercent: 0.035, avgSpread: 0.00021, avgSpreadPips: 2.1, pipSize: 0.00001, pipValue: 1, quoteCurrency: 'USD', leverage: 1, maxLotSize: 100, tradingHours: '00:05-23:55', digits: 5 },
  { symbol: 'SOLUSD', dataSymbol: 'SOL/USD', displayName: 'Solana', type: 'crypto', contractSize: 500, commission: 0, commissionPercent: 0.035, avgSpread: 0.01, avgSpreadPips: 1, pipSize: 0.01, pipValue: 5, quoteCurrency: 'USD', leverage: 1, maxLotSize: 1000, tradingHours: '00:05-23:55', digits: 2 },
  { symbol: 'LTCUSD', dataSymbol: 'LTC/USD', displayName: 'Litecoin', type: 'crypto', contractSize: 500, commission: 0, commissionPercent: 0.035, avgSpread: 0.15, avgSpreadPips: 15, pipSize: 0.01, pipValue: 5, quoteCurrency: 'USD', leverage: 1, maxLotSize: 500, tradingHours: '00:05-23:55', digits: 2 },
  { symbol: 'BCHUSD', dataSymbol: 'BCH/USD', displayName: 'Bitcoin Cash', type: 'crypto', contractSize: 200, commission: 0, commissionPercent: 0.035, avgSpread: 0.67, avgSpreadPips: 67, pipSize: 0.01, pipValue: 2, quoteCurrency: 'USD', leverage: 1, maxLotSize: 200, tradingHours: '00:05-23:55', digits: 2 },
  { symbol: 'BNBUSD', dataSymbol: 'BNB/USD', displayName: 'Binance Coin', type: 'crypto', contractSize: 200, commission: 0, commissionPercent: 0.035, avgSpread: 0.92, avgSpreadPips: 92, pipSize: 0.01, pipValue: 2, quoteCurrency: 'USD', leverage: 1, maxLotSize: 100, tradingHours: '00:05-23:55', digits: 2 },
];

export const ALL_INSTRUMENTS: InstrumentSpec[] = [
  ...FOREX_SPECS,
  ...INDEX_SPECS,
  ...COMMODITY_SPECS,
  ...METAL_SPECS,
  ...CRYPTO_SPECS,
];

export const INSTRUMENT_MAP: Map<string, InstrumentSpec> = new Map(
  ALL_INSTRUMENTS.map(spec => [spec.symbol, spec])
);

export const DATA_SYMBOL_MAP: Map<string, InstrumentSpec> = new Map(
  ALL_INSTRUMENTS.map(spec => [spec.dataSymbol, spec])
);

export interface PositionSizeInput {
  symbol: string;
  accountBalance: number;
  riskPercent: number;
  stopLossPips: number;
  currentPrice?: number;
  includeSpreadInRisk?: boolean;
}

export interface PositionSizeResult {
  lots: number;
  units: number;
  riskAmount: number;
  pipValue: number;
  spreadCost: number;
  commissionCost: number;
  totalCost: number;
  marginRequired: number;
  maxAllowedLots: number;
}

/**
 * Calculate position size for E8 Markets account
 * 
 * E8 Markets charges commission on OPEN + CLOSE (not per-side fill)
 * Crypto: 0.035% each way = 0.07% round trip on notional value
 * Forex/Metals/Indices: Fixed USD per lot (see spec.commission)
 */
export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult | null {
  const spec = INSTRUMENT_MAP.get(input.symbol);
  if (!spec) {
    logger.error(`Unknown symbol: ${input.symbol}`);
    return null;
  }

  const { accountBalance, riskPercent, stopLossPips, currentPrice = 0, includeSpreadInRisk = true } = input;

  if (accountBalance <= 0 || riskPercent <= 0 || stopLossPips <= 0) {
    logger.error(`Invalid input: balance=${accountBalance}, risk=${riskPercent}, sl=${stopLossPips}`);
    return null;
  }

  const riskAmount = accountBalance * (riskPercent / 100);

  const effectiveSLPips = includeSpreadInRisk 
    ? stopLossPips + spec.avgSpreadPips 
    : stopLossPips;

  let lots = riskAmount / (effectiveSLPips * spec.pipValue);

  if (!Number.isFinite(lots) || lots <= 0) {
    logger.error(`Invalid position size calculated: ${lots} for ${input.symbol}`);
    return null;
  }

  lots = Math.floor(lots * 100) / 100;
  lots = Math.min(lots, spec.maxLotSize);

  if (lots < 0.01) {
    lots = 0.01;
  }

  const units = lots * spec.contractSize;
  const spreadCost = lots * spec.avgSpreadPips * spec.pipValue;

  let commissionCost: number;
  if (spec.commissionPercent !== undefined && spec.commissionPercent > 0) {
    const positionValue = currentPrice > 0 ? lots * spec.contractSize * currentPrice : 0;
    commissionCost = positionValue * (spec.commissionPercent / 100) * 2;
  } else {
    commissionCost = lots * spec.commission;
  }

  const totalCost = spreadCost + commissionCost;
  const marginRequired = currentPrice > 0 ? (units * currentPrice) / spec.leverage : (units * 1) / spec.leverage;

  return {
    lots,
    units,
    riskAmount,
    pipValue: spec.pipValue,
    spreadCost,
    commissionCost,
    totalCost,
    marginRequired,
    maxAllowedLots: spec.maxLotSize,
  };
}

export function getInstrumentSpec(symbol: string): InstrumentSpec | undefined {
  return INSTRUMENT_MAP.get(symbol) || DATA_SYMBOL_MAP.get(symbol);
}

export function toDataSymbol(e8Symbol: string): string | undefined {
  return INSTRUMENT_MAP.get(e8Symbol)?.dataSymbol;
}

export function toE8Symbol(dataSymbol: string): string | undefined {
  return DATA_SYMBOL_MAP.get(dataSymbol)?.symbol;
}

export function getAssetType(symbol: string): AssetType | undefined {
  return getInstrumentSpec(symbol)?.type;
}

export function isValidInstrument(symbol: string): boolean {
  return INSTRUMENT_MAP.has(symbol) || DATA_SYMBOL_MAP.has(symbol);
}

export function getSymbolsByType(type: AssetType): string[] {
  return ALL_INSTRUMENTS.filter(spec => spec.type === type).map(spec => spec.symbol);
}

export function validateInstrumentSpecs(): void {
  const symbols = new Set<string>();
  const dataSymbols = new Set<string>();

  for (const spec of ALL_INSTRUMENTS) {
    if (symbols.has(spec.symbol)) {
      throw new Error(`Duplicate symbol: ${spec.symbol}`);
    }
    symbols.add(spec.symbol);

    if (dataSymbols.has(spec.dataSymbol)) {
      throw new Error(`Duplicate dataSymbol: ${spec.dataSymbol}`);
    }
    dataSymbols.add(spec.dataSymbol);

    if (!spec.pipValue || spec.pipValue <= 0) {
      throw new Error(`Invalid pipValue for ${spec.symbol}: ${spec.pipValue}`);
    }

    if (spec.commission === undefined && spec.commissionPercent === undefined) {
      throw new Error(`No commission model for ${spec.symbol}`);
    }

    if (spec.contractSize <= 0) {
      throw new Error(`Invalid contractSize for ${spec.symbol}: ${spec.contractSize}`);
    }

    if (spec.maxLotSize <= 0) {
      throw new Error(`Invalid maxLotSize for ${spec.symbol}: ${spec.maxLotSize}`);
    }

    if (spec.leverage <= 0) {
      throw new Error(`Invalid leverage for ${spec.symbol}: ${spec.leverage}`);
    }
  }

  logger.info(`Validated ${ALL_INSTRUMENTS.length} instrument specs`);
}

export const E8_RULES = {
  maxLotSizePerTrade: 50,
  maxLotSizeXAUUSD: 20,
  maxOpenOrders: 100,
  maxDailyRequests: 2000,
  maxTradesPerDay: 2000,
  inactivityDays: 90,
  minTradeDuration: 60,
  accountCurrency: 'USD',
  leverage: {
    forex: 30,
    indices: 15,
    metals: 15,
    energies: 15,
    crypto: 1,
  },
} as const;

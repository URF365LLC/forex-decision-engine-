/**
 * Trading Universe - All supported symbols
 * Forex: 28 pairs | Crypto: 8 pairs | Metals: 2 | Indices: 6 | Energies: 2
 * Total: 46 symbols matching E8 MT5
 */

export const FOREX_SYMBOLS = [
  'AUDCAD', 'AUDCHF', 'AUDJPY', 'AUDNZD', 'AUDUSD',
  'CADCHF', 'CADJPY', 'CHFJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURGBP', 'EURJPY', 'EURNZD', 'EURUSD',
  'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPJPY', 'GBPNZD', 'GBPUSD',
  'NZDCAD', 'NZDCHF', 'NZDJPY', 'NZDUSD',
  'USDCAD', 'USDCHF', 'USDJPY',
] as const;

export const CRYPTO_SYMBOLS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD',
  'ADAUSD', 'BCHUSD', 'BNBUSD', 'LTCUSD',
] as const;

export const METAL_SYMBOLS = [
  'XAUUSD',
  'XAGUSD',
] as const;

export const INDEX_SYMBOLS = [
] as const;

export const ENERGY_SYMBOLS = [
] as const;

export const ALL_SYMBOLS = [
  ...FOREX_SYMBOLS,
  ...CRYPTO_SYMBOLS,
  ...METAL_SYMBOLS,
  ...INDEX_SYMBOLS,
  ...ENERGY_SYMBOLS,
] as const;

export type ForexSymbol = typeof FOREX_SYMBOLS[number];
export type CryptoSymbol = typeof CRYPTO_SYMBOLS[number];
export type MetalSymbol = typeof METAL_SYMBOLS[number];
export type IndexSymbol = typeof INDEX_SYMBOLS[number];
export type EnergySymbol = typeof ENERGY_SYMBOLS[number];
export type Symbol = typeof ALL_SYMBOLS[number];

export type AssetClass = 'forex' | 'crypto' | 'metal' | 'index' | 'energy';

export function getAssetClass(symbol: string): AssetClass {
  if (CRYPTO_SYMBOLS.includes(symbol as CryptoSymbol)) return 'crypto';
  if (METAL_SYMBOLS.includes(symbol as MetalSymbol)) return 'metal';
  if (INDEX_SYMBOLS.includes(symbol as IndexSymbol)) return 'index';
  if (ENERGY_SYMBOLS.includes(symbol as EnergySymbol)) return 'energy';
  return 'forex';
}

export function usesTwelveData(symbol: string): boolean {
  const assetClass = getAssetClass(symbol);
  return ['metal', 'index', 'energy'].includes(assetClass);
}

export function usesCryptoIndicators(symbol: string): boolean {
  return getAssetClass(symbol) === 'crypto';
}

export function isValidSymbol(symbol: string): symbol is Symbol {
  return ALL_SYMBOLS.includes(symbol as Symbol);
}

export const DEFAULT_WATCHLIST: Symbol[] = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'ETHUSD', 'XAUUSD'
];

export const SYMBOL_META: Record<string, { 
  pipDecimals: number; 
  displayName: string;
  category: string;
}> = {
  EURUSD: { pipDecimals: 4, displayName: 'EUR/USD', category: 'Major' },
  GBPUSD: { pipDecimals: 4, displayName: 'GBP/USD', category: 'Major' },
  USDJPY: { pipDecimals: 2, displayName: 'USD/JPY', category: 'Major' },
  USDCHF: { pipDecimals: 4, displayName: 'USD/CHF', category: 'Major' },
  AUDUSD: { pipDecimals: 4, displayName: 'AUD/USD', category: 'Major' },
  USDCAD: { pipDecimals: 4, displayName: 'USD/CAD', category: 'Major' },
  NZDUSD: { pipDecimals: 4, displayName: 'NZD/USD', category: 'Major' },
  
  EURGBP: { pipDecimals: 4, displayName: 'EUR/GBP', category: 'Cross' },
  EURJPY: { pipDecimals: 2, displayName: 'EUR/JPY', category: 'Cross' },
  GBPJPY: { pipDecimals: 2, displayName: 'GBP/JPY', category: 'Cross' },
  EURAUD: { pipDecimals: 4, displayName: 'EUR/AUD', category: 'Cross' },
  EURCAD: { pipDecimals: 4, displayName: 'EUR/CAD', category: 'Cross' },
  EURCHF: { pipDecimals: 4, displayName: 'EUR/CHF', category: 'Cross' },
  EURNZD: { pipDecimals: 4, displayName: 'EUR/NZD', category: 'Cross' },
  GBPAUD: { pipDecimals: 4, displayName: 'GBP/AUD', category: 'Cross' },
  GBPCAD: { pipDecimals: 4, displayName: 'GBP/CAD', category: 'Cross' },
  GBPCHF: { pipDecimals: 4, displayName: 'GBP/CHF', category: 'Cross' },
  GBPNZD: { pipDecimals: 4, displayName: 'GBP/NZD', category: 'Cross' },
  AUDJPY: { pipDecimals: 2, displayName: 'AUD/JPY', category: 'Cross' },
  AUDNZD: { pipDecimals: 4, displayName: 'AUD/NZD', category: 'Cross' },
  AUDCAD: { pipDecimals: 4, displayName: 'AUD/CAD', category: 'Cross' },
  AUDCHF: { pipDecimals: 4, displayName: 'AUD/CHF', category: 'Cross' },
  CADJPY: { pipDecimals: 2, displayName: 'CAD/JPY', category: 'Cross' },
  CADCHF: { pipDecimals: 4, displayName: 'CAD/CHF', category: 'Cross' },
  CHFJPY: { pipDecimals: 2, displayName: 'CHF/JPY', category: 'Cross' },
  NZDJPY: { pipDecimals: 2, displayName: 'NZD/JPY', category: 'Cross' },
  NZDCAD: { pipDecimals: 4, displayName: 'NZD/CAD', category: 'Cross' },
  NZDCHF: { pipDecimals: 4, displayName: 'NZD/CHF', category: 'Cross' },
  
  BTCUSD: { pipDecimals: 2, displayName: 'BTC/USD', category: 'Crypto' },
  ETHUSD: { pipDecimals: 2, displayName: 'ETH/USD', category: 'Crypto' },
  SOLUSD: { pipDecimals: 2, displayName: 'SOL/USD', category: 'Crypto' },
  XRPUSD: { pipDecimals: 4, displayName: 'XRP/USD', category: 'Crypto' },
  ADAUSD: { pipDecimals: 4, displayName: 'ADA/USD', category: 'Crypto' },
  BCHUSD: { pipDecimals: 2, displayName: 'BCH/USD', category: 'Crypto' },
  BNBUSD: { pipDecimals: 2, displayName: 'BNB/USD', category: 'Crypto' },
  LTCUSD: { pipDecimals: 2, displayName: 'LTC/USD', category: 'Crypto' },
  
  XAUUSD: { pipDecimals: 2, displayName: 'XAU/USD (Gold)', category: 'Metal' },
  XAGUSD: { pipDecimals: 3, displayName: 'XAG/USD (Silver)', category: 'Metal' },
  
  ASX:    { pipDecimals: 1, displayName: 'ASX 200', category: 'Index' },
  DAX:    { pipDecimals: 1, displayName: 'DAX 40', category: 'Index' },
  DOW:    { pipDecimals: 1, displayName: 'Dow Jones', category: 'Index' },
  NIKKEI: { pipDecimals: 0, displayName: 'Nikkei 225', category: 'Index' },
  NSDQ:   { pipDecimals: 1, displayName: 'NASDAQ 100', category: 'Index' },
  SP:     { pipDecimals: 1, displayName: 'S&P 500', category: 'Index' },
  
  WTI:    { pipDecimals: 2, displayName: 'WTI Crude', category: 'Energy' },
  BRENT:  { pipDecimals: 2, displayName: 'Brent Crude', category: 'Energy' },
};

export function getPipDecimals(symbol: string): number {
  return SYMBOL_META[symbol]?.pipDecimals ?? 4;
}

export function getDisplayName(symbol: string): string {
  return SYMBOL_META[symbol]?.displayName ?? symbol;
}

export function getUniverse() {
  return {
    forex: [...FOREX_SYMBOLS],
    crypto: [...CRYPTO_SYMBOLS],
    metals: [...METAL_SYMBOLS],
    indices: [...INDEX_SYMBOLS],
    energies: [...ENERGY_SYMBOLS],
    all: [...ALL_SYMBOLS],
    counts: {
      forex: FOREX_SYMBOLS.length,
      crypto: CRYPTO_SYMBOLS.length,
      metals: METAL_SYMBOLS.length,
      indices: INDEX_SYMBOLS.length,
      energies: ENERGY_SYMBOLS.length,
      total: ALL_SYMBOLS.length,
    },
  };
}

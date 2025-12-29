/**
 * Trading Universe - All supported symbols
 * Forex: 28 pairs | Crypto: 8 pairs
 */
export declare const FOREX_SYMBOLS: readonly ["AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD", "CADCHF", "CADJPY", "CHFJPY", "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD", "GBPAUD", "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD", "NZDCAD", "NZDCHF", "NZDJPY", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"];
export declare const CRYPTO_SYMBOLS: readonly ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "BCHUSD", "BNBUSD", "LTCUSD"];
export declare const ALL_SYMBOLS: readonly ["AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD", "CADCHF", "CADJPY", "CHFJPY", "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD", "GBPAUD", "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD", "NZDCAD", "NZDCHF", "NZDJPY", "NZDUSD", "USDCAD", "USDCHF", "USDJPY", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "ADAUSD", "BCHUSD", "BNBUSD", "LTCUSD"];
export type ForexSymbol = typeof FOREX_SYMBOLS[number];
export type CryptoSymbol = typeof CRYPTO_SYMBOLS[number];
export type Symbol = typeof ALL_SYMBOLS[number];
export type AssetClass = 'forex' | 'crypto';
export declare function getAssetClass(symbol: string): AssetClass;
export declare function isValidSymbol(symbol: string): symbol is Symbol;
/**
 * Default watchlist for new users
 */
export declare const DEFAULT_WATCHLIST: Symbol[];
/**
 * Symbol metadata for display and calculations
 */
export declare const SYMBOL_META: Record<string, {
    pipDecimals: number;
    displayName: string;
    category: string;
}>;
export declare function getPipDecimals(symbol: string): number;
export declare function getDisplayName(symbol: string): string;

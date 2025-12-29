/**
 * Trading Universe - All supported symbols
 * Forex: 28 pairs | Crypto: 8 pairs
 */
export const FOREX_SYMBOLS = [
    'AUDCAD', 'AUDCHF', 'AUDJPY', 'AUDNZD', 'AUDUSD',
    'CADCHF', 'CADJPY', 'CHFJPY',
    'EURAUD', 'EURCAD', 'EURCHF', 'EURGBP', 'EURJPY', 'EURNZD', 'EURUSD',
    'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPJPY', 'GBPNZD', 'GBPUSD',
    'NZDCAD', 'NZDCHF', 'NZDJPY', 'NZDUSD',
    'USDCAD', 'USDCHF', 'USDJPY',
];
export const CRYPTO_SYMBOLS = [
    'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD',
    'ADAUSD', 'BCHUSD', 'BNBUSD', 'LTCUSD',
];
export const ALL_SYMBOLS = [...FOREX_SYMBOLS, ...CRYPTO_SYMBOLS];
export function getAssetClass(symbol) {
    if (CRYPTO_SYMBOLS.includes(symbol))
        return 'crypto';
    return 'forex';
}
export function isValidSymbol(symbol) {
    return ALL_SYMBOLS.includes(symbol);
}
/**
 * Default watchlist for new users
 */
export const DEFAULT_WATCHLIST = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'ETHUSD'
];
/**
 * Symbol metadata for display and calculations
 */
export const SYMBOL_META = {
    // Major Forex
    EURUSD: { pipDecimals: 4, displayName: 'EUR/USD', category: 'Major' },
    GBPUSD: { pipDecimals: 4, displayName: 'GBP/USD', category: 'Major' },
    USDJPY: { pipDecimals: 2, displayName: 'USD/JPY', category: 'Major' },
    USDCHF: { pipDecimals: 4, displayName: 'USD/CHF', category: 'Major' },
    AUDUSD: { pipDecimals: 4, displayName: 'AUD/USD', category: 'Major' },
    USDCAD: { pipDecimals: 4, displayName: 'USD/CAD', category: 'Major' },
    NZDUSD: { pipDecimals: 4, displayName: 'NZD/USD', category: 'Major' },
    // Cross pairs
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
    // Crypto
    BTCUSD: { pipDecimals: 2, displayName: 'BTC/USD', category: 'Crypto' },
    ETHUSD: { pipDecimals: 2, displayName: 'ETH/USD', category: 'Crypto' },
    SOLUSD: { pipDecimals: 2, displayName: 'SOL/USD', category: 'Crypto' },
    XRPUSD: { pipDecimals: 4, displayName: 'XRP/USD', category: 'Crypto' },
    ADAUSD: { pipDecimals: 4, displayName: 'ADA/USD', category: 'Crypto' },
    BCHUSD: { pipDecimals: 2, displayName: 'BCH/USD', category: 'Crypto' },
    BNBUSD: { pipDecimals: 2, displayName: 'BNB/USD', category: 'Crypto' },
    LTCUSD: { pipDecimals: 2, displayName: 'LTC/USD', category: 'Crypto' },
};
export function getPipDecimals(symbol) {
    return SYMBOL_META[symbol]?.pipDecimals ?? 4;
}
export function getDisplayName(symbol) {
    return SYMBOL_META[symbol]?.displayName ?? symbol;
}
//# sourceMappingURL=universe.js.map
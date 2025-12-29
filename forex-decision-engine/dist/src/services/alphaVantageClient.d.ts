/**
 * Alpha Vantage API Client
 * Handles all API calls with caching and rate limiting
 */
export interface OHLCVBar {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export interface IndicatorValue {
    timestamp: string;
    value: number;
}
export interface MACDValue {
    timestamp: string;
    macd: number;
    signal: number;
    histogram: number;
}
declare class AlphaVantageClient {
    private baseUrl;
    private apiKey;
    constructor();
    /**
     * Make API request with rate limiting
     */
    private fetch;
    /**
     * Split forex pair into from/to currencies
     */
    private splitForexPair;
    /**
     * Split crypto symbol into symbol/market
     */
    private splitCryptoSymbol;
    /**
     * Get OHLCV bars for a symbol
     */
    getOHLCV(symbol: string, interval?: '1min' | '5min' | '15min' | '30min' | '60min' | 'daily', outputSize?: 'compact' | 'full'): Promise<OHLCVBar[]>;
    /**
     * Parse OHLCV response from Alpha Vantage
     */
    private parseOHLCV;
    /**
     * Get EMA values
     */
    getEMA(symbol: string, interval: string, period: number): Promise<IndicatorValue[]>;
    /**
     * Get RSI values
     */
    getRSI(symbol: string, interval: string, period?: number): Promise<IndicatorValue[]>;
    /**
     * Get ADX values
     */
    getADX(symbol: string, interval: string, period?: number): Promise<IndicatorValue[]>;
    /**
     * Get ATR values
     */
    getATR(symbol: string, interval: string, period?: number): Promise<IndicatorValue[]>;
    /**
     * Parse indicator response
     */
    private parseIndicator;
    /**
     * Get current exchange rate
     */
    getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number>;
    /**
     * Get current price for a symbol
     */
    getCurrentPrice(symbol: string): Promise<number>;
}
export declare const alphaVantage: AlphaVantageClient;
export { AlphaVantageClient };

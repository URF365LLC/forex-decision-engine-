/**
 * KuCoin API Client
 * Fetches OHLCV data for crypto pairs not supported by Alpha Vantage
 * No API key required (public endpoints)
 */
import { OHLCVBar } from './alphaVantageClient.js';
export declare function isKucoinSymbol(symbol: string): boolean;
export declare function getKucoinOHLCV(symbol: string, interval: string, limit?: number): Promise<OHLCVBar[]>;
export declare const kucoin: {
    getOHLCV: typeof getKucoinOHLCV;
    isSupported: typeof isKucoinSymbol;
};

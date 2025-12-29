/**
 * Crypto Indicator Service
 * Fetches OHLCV from Alpha Vantage CRYPTO_INTRADAY
 * Computes technical indicators locally (EMA, RSI, ADX, ATR)
 *
 * Why separate from forex?
 * Alpha Vantage indicator endpoints (EMA, RSI, etc.) don't support crypto.
 * We must fetch raw OHLCV and calculate indicators ourselves.
 */
import { OHLCVBar, IndicatorValue } from '../services/alphaVantageClient.js';
import { TradingStyle } from '../config/strategy.js';
export interface CryptoIndicatorData {
    symbol: string;
    style: TradingStyle;
    trendBars: OHLCVBar[];
    entryBars: OHLCVBar[];
    currentPrice: number;
    ema200: IndicatorValue[];
    ema50: IndicatorValue[];
    ema20: IndicatorValue[];
    rsi: IndicatorValue[];
    adx: IndicatorValue[];
    atr: IndicatorValue[];
    errors: string[];
    fetchedAt: string;
}
export declare function fetchCryptoIndicators(symbol: string, style: TradingStyle): Promise<CryptoIndicatorData>;
export declare function getLatestValue(indicators: IndicatorValue[]): number | null;
export declare function getPreviousValue(indicators: IndicatorValue[], offset?: number): number | null;

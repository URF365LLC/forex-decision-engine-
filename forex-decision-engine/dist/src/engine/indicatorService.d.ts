/**
 * Indicator Service
 * Fetches all required indicators for a symbol
 */
import { OHLCVBar, IndicatorValue } from '../services/alphaVantageClient.js';
import { TradingStyle } from '../config/strategy.js';
export interface IndicatorData {
    symbol: string;
    style: TradingStyle;
    trendBars: OHLCVBar[];
    entryBars: OHLCVBar[];
    currentPrice: number;
    ema200: IndicatorValue[];
    adx: IndicatorValue[];
    ema20: IndicatorValue[];
    ema50: IndicatorValue[];
    rsi: IndicatorValue[];
    atr: IndicatorValue[];
    fetchedAt: string;
    errors: string[];
}
/**
 * Fetch all indicators needed for analysis
 * Makes ~8 API calls per symbol (with caching)
 */
export declare function fetchIndicators(symbol: string, style: TradingStyle): Promise<IndicatorData>;
/**
 * Get the latest value from an indicator array
 */
export declare function getLatestValue(indicators: IndicatorValue[]): number | null;
/**
 * Get the previous value from an indicator array
 */
export declare function getPreviousValue(indicators: IndicatorValue[], offset?: number): number | null;
/**
 * Calculate slope of indicator over N periods
 */
export declare function calculateSlope(indicators: IndicatorValue[], periods: number): number;
/**
 * Find swing high in bars
 */
export declare function findSwingHigh(bars: OHLCVBar[], lookback: number): number | null;
/**
 * Find swing low in bars
 */
export declare function findSwingLow(bars: OHLCVBar[], lookback: number): number | null;

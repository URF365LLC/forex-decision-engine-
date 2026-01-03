/**
 * Indicator Service
 * Fetches all required indicators for a symbol
 * TWELVE DATA ONLY - Unified data source for all asset classes
 */

import { twelveData } from '../services/twelveDataClient.js';
import type { OHLCVBar, IndicatorValue, MACDValue } from '../services/twelveDataClient.js';
import { STRATEGY, TradingStyle } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';
import { cache, CacheService, CACHE_TTL } from '../services/cache.js';

const logger = createLogger('IndicatorService');

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
  
  stoch: { timestamp: string; k: number; d: number }[];
  willr: IndicatorValue[];
  cci: IndicatorValue[];
  bbands: { timestamp: string; upper: number; middle: number; lower: number }[];
  sma20: IndicatorValue[];
  
  ema8?: IndicatorValue[];
  ema21?: IndicatorValue[];
  ema55?: IndicatorValue[];
  macd?: MACDValue[];
  obv?: IndicatorValue[];
  
  // H4 Trend Data (NEW - parallel to existing D1)
  trendBarsH4?: OHLCVBar[];
  ema200H4?: IndicatorValue[];
  adxH4?: IndicatorValue[];
  trendTimeframeUsed?: 'H4' | 'D1';
  trendFallbackUsed?: boolean;
  
  fetchedAt: string;
  errors: string[];
}

export { OHLCVBar, IndicatorValue };

interface TrendDataH4 {
  trendBarsH4: OHLCVBar[];
  ema200H4: IndicatorValue[];
  adxH4: IndicatorValue[];
  trendTimeframeUsed: 'H4' | 'D1';
  trendFallbackUsed: boolean;
}

const indicatorInflight = new Map<string, Promise<unknown>>();
const BUNDLE_CACHE_VERSION = 'v2';

async function fetchWithCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  label: string,
  errors: string[],
  fallback: T
): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached) {
    logger.debug(`Indicator cache HIT: ${label}`);
    return cached;
  }

  if (indicatorInflight.has(key)) {
    return indicatorInflight.get(key) as Promise<T>;
  }

  const promise = (async () => {
    try {
      const result = await fetcher();
      cache.set(key, result, ttlSeconds);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      errors.push(`${label}: ${message}`);
      logger.warn(`Indicator fetch failed for ${label}: ${message}`);
      return fallback;
    } finally {
      indicatorInflight.delete(key);
    }
  })();

  indicatorInflight.set(key, promise);
  return promise;
}

async function fetchTrendDataH4(symbol: string): Promise<TrendDataH4> {
  try {
    // Try H4 first (Twelve Data supports 4h natively)
    const [trendBarsH4, ema200H4, adxH4] = await Promise.all([
      twelveData.getOHLCV(symbol, '4h', 'compact'),
      twelveData.getEMA(symbol, '4h', 200),
      twelveData.getADX(symbol, '4h', 14),
    ]);
    
    logger.debug(`H4 trend data fetched successfully for ${symbol}`);
    
    return {
      trendBarsH4,
      ema200H4,
      adxH4,
      trendTimeframeUsed: 'H4',
      trendFallbackUsed: false,
    };
  } catch (error) {
    // Fallback to D1 if Twelve rejects H4 for this symbol
    logger.warn(`TREND_FALLBACK_D1_USED: ${symbol} - H4 failed, using D1`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      symbol,
    });
    
    const [trendBarsD1, ema200D1, adxD1] = await Promise.all([
      twelveData.getOHLCV(symbol, 'daily', 'compact'),
      twelveData.getEMA(symbol, 'daily', 200),
      twelveData.getADX(symbol, 'daily', 14),
    ]);
    
    return {
      trendBarsH4: trendBarsD1,
      ema200H4: ema200D1,
      adxH4: adxD1,
      trendTimeframeUsed: 'D1',
      trendFallbackUsed: true,
    };
  }
}

function validateH4Alignment(data: Partial<IndicatorData>): boolean {
  if (!data.trendBarsH4 || data.trendBarsH4.length === 0) {
    return true;
  }
  
  const h4Len = data.trendBarsH4.length;
  
  if (data.ema200H4 && data.ema200H4.length !== h4Len) {
    logger.error(`H4 EMA200 alignment mismatch: ${data.ema200H4.length} vs bars ${h4Len}`);
    while (data.ema200H4.length < h4Len) {
      data.ema200H4.unshift({ timestamp: '', value: NaN });
    }
  }
  
  if (data.adxH4 && data.adxH4.length !== h4Len) {
    logger.error(`H4 ADX alignment mismatch: ${data.adxH4.length} vs bars ${h4Len}`);
    while (data.adxH4.length < h4Len) {
      data.adxH4.unshift({ timestamp: '', value: NaN });
    }
  }
  
  return true;
}

export async function fetchIndicators(
  symbol: string,
  style: TradingStyle
): Promise<IndicatorData> {
  const errors: string[] = [];
  const entryInterval = '1h';
  const bundleKey = CacheService.makeKey(symbol, style, 'indicator-bundle', { version: BUNDLE_CACHE_VERSION });
  const bundleTtl = CACHE_TTL.indicator['60min'];
  const dailyTtl = CACHE_TTL.indicator.daily;
  const h4Ttl = CACHE_TTL.H4;
  
  const cachedBundle = cache.get<IndicatorData>(bundleKey);
  if (cachedBundle) {
    logger.debug(`Indicator bundle cache hit for ${symbol} (${style})`);
    // structuredClone available in Node 20+
    return typeof structuredClone === 'function'
      ? structuredClone(cachedBundle)
      : JSON.parse(JSON.stringify(cachedBundle));
  }

  logger.info(`Fetching indicators for ${symbol} (${style}) via Twelve Data`);

  const data: IndicatorData = {
    symbol,
    style,
    trendBars: [],
    entryBars: [],
    currentPrice: 0,
    ema200: [],
    adx: [],
    ema20: [],
    ema50: [],
    rsi: [],
    atr: [],
    stoch: [],
    willr: [],
    cci: [],
    bbands: [],
    sma20: [],
    ema8: [],
    ema21: [],
    ema55: [],
    macd: [],
    obv: [],
    fetchedAt: new Date().toISOString(),
    errors: [],
  };

  try {
    const [entryBars, trendBars, ema200, adx, h4Trend] = await Promise.all([
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'entry-bars', { style }),
        CACHE_TTL.H1,
        () => twelveData.getOHLCV(symbol, entryInterval, 'full'),
        'Entry bars',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, 'daily', 'trend-bars', { style }),
        dailyTtl,
        () => twelveData.getOHLCV(symbol, 'daily', 'compact'),
        'Trend bars',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, 'daily', 'ema200', { style }),
        dailyTtl,
        () => twelveData.getEMA(symbol, 'daily', STRATEGY.trend.ema.period),
        'EMA200',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, 'daily', 'adx', { style }),
        dailyTtl,
        () => twelveData.getADX(symbol, 'daily', STRATEGY.trend.adx.period),
        'ADX',
        errors,
        []
      ),
      fetchWithCache<TrendDataH4>(
        CacheService.makeKey(symbol, 'H4', 'trend-pack', { style }),
        h4Ttl,
        () => fetchTrendDataH4(symbol),
        'H4 trend pack',
        errors,
        { trendBarsH4: [], ema200H4: [], adxH4: [], trendTimeframeUsed: 'H4', trendFallbackUsed: false }
      ),
    ]);

    const [
      ema20,
      ema50,
      rsi,
      atr,
      stoch,
      willr,
      cci,
      bbands,
      sma20,
      ema8,
      ema21,
      ema55,
      macd,
      obv,
    ] = await Promise.all([
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'ema20', { style }),
        bundleTtl,
        () => twelveData.getEMA(symbol, entryInterval, STRATEGY.entry.emaFast.period),
        'EMA20',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'ema50', { style }),
        bundleTtl,
        () => twelveData.getEMA(symbol, entryInterval, STRATEGY.entry.emaSlow.period),
        'EMA50',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'rsi', { style }),
        bundleTtl,
        () => twelveData.getRSI(symbol, entryInterval, STRATEGY.entry.rsi.period),
        'RSI',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'atr', { style }),
        bundleTtl,
        () => twelveData.getATR(symbol, entryInterval, STRATEGY.stopLoss.atr.period),
        'ATR',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'stoch', { style }),
        bundleTtl,
        () => twelveData.getStochastic(symbol, entryInterval, 14, 3, 3),
        'STOCH',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'willr', { style }),
        bundleTtl,
        () => twelveData.getWilliamsR(symbol, entryInterval, 14),
        'WILLR',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'cci', { style }),
        bundleTtl,
        () => twelveData.getCCI(symbol, entryInterval, 20),
        'CCI',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'bbands', { style }),
        bundleTtl,
        () => twelveData.getBBands(symbol, entryInterval, 20, 2, 2),
        'BBANDS',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'sma20', { style }),
        bundleTtl,
        () => twelveData.getSMA(symbol, entryInterval, 20),
        'SMA20',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'ema8', { style }),
        bundleTtl,
        () => twelveData.getEMA(symbol, entryInterval, 8),
        'EMA8',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'ema21', { style }),
        bundleTtl,
        () => twelveData.getEMA(symbol, entryInterval, 21),
        'EMA21',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'ema55', { style }),
        bundleTtl,
        () => twelveData.getEMA(symbol, entryInterval, 55),
        'EMA55',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'macd', { style }),
        bundleTtl,
        () => twelveData.getMACD(symbol, entryInterval, 12, 26, 9),
        'MACD',
        errors,
        []
      ),
      fetchWithCache(
        CacheService.makeKey(symbol, entryInterval, 'obv', { style }),
        bundleTtl,
        () => twelveData.getOBV(symbol, entryInterval),
        'OBV',
        errors,
        []
      ),
    ]);

    data.entryBars = entryBars;
    data.trendBars = trendBars;
    data.currentPrice = entryBars.length > 0 ? entryBars[entryBars.length - 1].close : 0;
    data.ema200 = ema200;
    data.adx = adx;
    data.ema20 = ema20;
    data.ema50 = ema50;
    data.rsi = rsi;
    data.atr = atr;
    data.stoch = stoch;
    data.willr = willr;
    data.cci = cci;
    data.bbands = bbands;
    data.sma20 = sma20;
    data.ema8 = ema8;
    data.ema21 = ema21;
    data.ema55 = ema55;
    data.macd = macd;
    data.obv = obv;

    data.trendBarsH4 = h4Trend.trendBarsH4;
    data.ema200H4 = h4Trend.ema200H4;
    data.adxH4 = h4Trend.adxH4;
    data.trendTimeframeUsed = h4Trend.trendTimeframeUsed;
    data.trendFallbackUsed = h4Trend.trendFallbackUsed;
    validateH4Alignment(data);
  } catch (e) {
    errors.push(`General error: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  data.errors = errors;
  
  if (errors.length > 0) {
    logger.warn(`Indicator fetch completed with ${errors.length} errors for ${symbol}`, errors);
  } else {
    logger.info(`Indicator fetch completed successfully for ${symbol}`);
    cache.set(bundleKey, data, bundleTtl);
  }

  return data;
}

export function getLatestValue(indicators: IndicatorValue[]): number | null {
  if (indicators.length === 0) return null;
  return indicators[indicators.length - 1].value;
}

export function getPreviousValue(indicators: IndicatorValue[], offset: number = 1): number | null {
  if (indicators.length <= offset) return null;
  return indicators[indicators.length - 1 - offset].value;
}

export function calculateSlope(indicators: IndicatorValue[], periods: number): number {
  if (indicators.length < periods + 1) return 0;
  
  const current = indicators[indicators.length - 1].value;
  const previous = indicators[indicators.length - 1 - periods].value;
  
  return current - previous;
}

export function findSwingHigh(bars: OHLCVBar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  
  const recentBars = bars.slice(-lookback);
  let highestHigh = 0;
  
  for (const bar of recentBars) {
    if (bar.high > highestHigh) {
      highestHigh = bar.high;
    }
  }
  
  return highestHigh;
}

export function findSwingLow(bars: OHLCVBar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  
  const recentBars = bars.slice(-lookback);
  let lowestLow = Infinity;
  
  for (const bar of recentBars) {
    if (bar.low < lowestLow) {
      lowestLow = bar.low;
    }
  }
  
  return lowestLow === Infinity ? null : lowestLow;
}

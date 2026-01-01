/**
 * Twelve Data API Client
 * Unified data source for Forex, Metals, and Crypto
 * Replaces Alpha Vantage and KuCoin clients
 */

import { rateLimiter } from './rateLimiter.js';
import { cache, CacheService, CACHE_TTL } from './cache.js';
import { createLogger } from './logger.js';

const logger = createLogger('TwelveData');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DEFAULT_CRYPTO_EXCHANGE = process.env.TWELVE_DATA_CRYPTO_EXCHANGE || 'Binance';

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

export interface StochValue {
  timestamp: string;
  k: number;
  d: number;
}

export interface BBandsValue {
  timestamp: string;
  upper: number;
  middle: number;
  lower: number;
}

export interface MACDValue {
  timestamp: string;
  macd: number;
  signal: number;
  histogram: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('timeout') ||
      msg.includes('network')
    );
  }
  return false;
}

class TwelveDataClient {
  private baseUrl = 'https://api.twelvedata.com';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.TWELVE_DATA_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('TWELVE_DATA_API_KEY not set - API calls will fail');
    }
    logger.info(`DATA_PROVIDER=Twelve, CRYPTO_EXCHANGE=${DEFAULT_CRYPTO_EXCHANGE}`);
  }

  private normalizeSymbol(raw: string): string {
    const s = raw.trim().toUpperCase();
    if (s.includes('/')) return s;

    if (s.length === 6) {
      return `${s.slice(0, 3)}/${s.slice(3, 6)}`;
    }

    const cryptoBases = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BNB', 'BCH', 'LTC'];
    for (const base of cryptoBases) {
      if (s.startsWith(base)) {
        return `${base}/${s.slice(base.length) || 'USD'}`;
      }
    }

    return s;
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '1min': '1min',
      '5min': '5min',
      '15min': '15min',
      '30min': '30min',
      '60min': '1h',
      'daily': '1day',
      '1h': '1h',
      '4h': '4h',
      '1day': '1day',
    };
    return map[interval] || interval;
  }

  private isCryptoPair(symbol: string): boolean {
    const cryptoBases = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BNB', 'BCH', 'LTC'];
    const s = symbol.toUpperCase().replace('/', '');
    return cryptoBases.some(base => s.startsWith(base));
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    await rateLimiter.acquire();

    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('apikey', this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    logger.debug(`Fetching: ${path} for ${params.symbol || 'N/A'}`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.status === 'error') {
          throw new Error(`Twelve Data error: ${data.message || 'Unknown error'}`);
        }

        return data as T;
      } catch (error) {
        if (isTransientError(error) && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          logger.warn(`Transient error, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Max retries exceeded');
  }

  private oldestFirst<T extends { datetime?: string; timestamp?: string }>(data: T[]): T[] {
    return [...data].sort((a, b) => {
      const timeA = a.datetime || a.timestamp || '';
      const timeB = b.datetime || b.timestamp || '';
      return new Date(timeA).getTime() - new Date(timeB).getTime();
    });
  }

  async getOHLCV(
    symbol: string,
    interval: string,
    outputSize: 'compact' | 'full' = 'compact'
  ): Promise<OHLCVBar[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const mappedInterval = this.mapInterval(interval);
    const count = outputSize === 'full' ? 500 : 100;

    const cacheKey = CacheService.makeKey(symbol, interval, 'ohlcv', { outputSize });
    const cached = cache.get<OHLCVBar[]>(cacheKey);
    if (cached) return cached;

    const params: Record<string, string> = {
      symbol: normalizedSymbol,
      interval: mappedInterval,
      outputsize: String(count),
    };

    if (this.isCryptoPair(normalizedSymbol)) {
      params.exchange = DEFAULT_CRYPTO_EXCHANGE;
    }

    const data = await this.request<{ values?: Array<Record<string, string>> }>('/time_series', params);

    if (!data.values || !Array.isArray(data.values)) {
      logger.warn(`No OHLCV data returned for ${symbol}`);
      return [];
    }

    const bars: OHLCVBar[] = data.values.map(v => ({
      timestamp: v.datetime || '',
      open: parseFloat(v.open || '0'),
      high: parseFloat(v.high || '0'),
      low: parseFloat(v.low || '0'),
      close: parseFloat(v.close || '0'),
      volume: parseFloat(v.volume || '0'),
    }));

    const sorted = this.oldestFirst(bars.map(b => ({ ...b, datetime: b.timestamp })));
    const result = sorted.map(b => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));

    const ttl = interval === 'daily' || interval === '1day' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, result, ttl);

    return result;
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const bars = await this.getOHLCV(symbol, '1h', 'compact');
    if (bars.length === 0) {
      throw new Error(`No price data for ${symbol}`);
    }
    return bars[bars.length - 1].close;
  }

  async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const symbol = `${fromCurrency}/${toCurrency}`;
    const cacheKey = CacheService.makeKey(fromCurrency, toCurrency, 'rate', {});
    const cached = cache.get<number>(cacheKey);
    if (cached) return cached;

    const data = await this.request<{ price?: string }>('/price', { symbol });

    if (!data.price) {
      throw new Error(`No exchange rate data for ${symbol}`);
    }

    const rate = parseFloat(data.price);
    cache.set(cacheKey, rate, CACHE_TTL.exchangeRate);

    return rate;
  }

  private async getIndicator(
    symbol: string,
    interval: string,
    indicator: string,
    params: Record<string, string> = {},
    valueKey: string = indicator.toLowerCase()
  ): Promise<IndicatorValue[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const mappedInterval = this.mapInterval(interval);

    const cacheKey = CacheService.makeKey(symbol, interval, indicator.toLowerCase(), params);
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const requestParams: Record<string, string> = {
      symbol: normalizedSymbol,
      interval: mappedInterval,
      outputsize: '100',
      ...params,
    };

    if (this.isCryptoPair(normalizedSymbol)) {
      requestParams.exchange = DEFAULT_CRYPTO_EXCHANGE;
    }

    const data = await this.request<{ values?: Array<Record<string, string>> }>(`/${indicator.toLowerCase()}`, requestParams);

    if (!data.values || !Array.isArray(data.values)) {
      logger.warn(`No ${indicator} data returned for ${symbol}`);
      return [];
    }

    const values: IndicatorValue[] = data.values.map(v => ({
      timestamp: v.datetime || '',
      value: parseFloat(v[valueKey] || '0'),
    }));

    const sorted = this.oldestFirst(values.map(v => ({ ...v, datetime: v.timestamp })));
    const result = sorted.map(v => ({ timestamp: v.timestamp, value: v.value }));

    const ttl = interval === 'daily' || interval === '1day' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, result, ttl);

    return result;
  }

  async getEMA(symbol: string, interval: string, period: number): Promise<IndicatorValue[]> {
    return this.getIndicator(symbol, interval, 'ema', { time_period: String(period) }, 'ema');
  }

  async getSMA(symbol: string, interval: string, period: number): Promise<IndicatorValue[]> {
    return this.getIndicator(symbol, interval, 'sma', { time_period: String(period) }, 'sma');
  }

  async getRSI(symbol: string, interval: string, period: number = 14): Promise<IndicatorValue[]> {
    return this.getIndicator(symbol, interval, 'rsi', { time_period: String(period) }, 'rsi');
  }

  async getATR(symbol: string, interval: string, period: number = 14): Promise<IndicatorValue[]> {
    return this.getIndicator(symbol, interval, 'atr', { time_period: String(period) }, 'atr');
  }

  async getADX(symbol: string, interval: string, period: number = 14): Promise<IndicatorValue[]> {
    return this.getIndicator(symbol, interval, 'adx', { time_period: String(period) }, 'adx');
  }

  async getCCI(symbol: string, interval: string, period: number = 20): Promise<IndicatorValue[]> {
    return this.getIndicator(symbol, interval, 'cci', { time_period: String(period) }, 'cci');
  }

  async getWilliamsR(symbol: string, interval: string, period: number = 14): Promise<IndicatorValue[]> {
    return this.getIndicator(symbol, interval, 'willr', { time_period: String(period) }, 'willr');
  }

  async getStochastic(
    symbol: string,
    interval: string,
    fastkPeriod: number = 14,
    slowkPeriod: number = 3,
    slowdPeriod: number = 3
  ): Promise<StochValue[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const mappedInterval = this.mapInterval(interval);

    const cacheKey = CacheService.makeKey(symbol, interval, 'stoch', { fastkPeriod, slowkPeriod, slowdPeriod });
    const cached = cache.get<StochValue[]>(cacheKey);
    if (cached) return cached;

    const params: Record<string, string> = {
      symbol: normalizedSymbol,
      interval: mappedInterval,
      outputsize: '100',
      fast_k_period: String(fastkPeriod),
      slow_k_period: String(slowkPeriod),
      slow_d_period: String(slowdPeriod),
    };

    if (this.isCryptoPair(normalizedSymbol)) {
      params.exchange = DEFAULT_CRYPTO_EXCHANGE;
    }

    const data = await this.request<{ values?: Array<Record<string, string>> }>('/stoch', params);

    if (!data.values || !Array.isArray(data.values)) {
      logger.warn(`No STOCH data returned for ${symbol}`);
      return [];
    }

    const values: StochValue[] = data.values.map(v => ({
      timestamp: v.datetime || '',
      k: parseFloat(v.slow_k || '0'),
      d: parseFloat(v.slow_d || '0'),
    }));

    const sorted = this.oldestFirst(values.map(v => ({ ...v, datetime: v.timestamp })));
    const result = sorted.map(v => ({ timestamp: v.timestamp, k: v.k, d: v.d }));

    const ttl = interval === 'daily' || interval === '1day' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, result, ttl);

    return result;
  }

  async getBBands(
    symbol: string,
    interval: string,
    period: number = 20,
    nbdevup: number = 2,
    nbdevdn: number = 2
  ): Promise<BBandsValue[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const mappedInterval = this.mapInterval(interval);

    const cacheKey = CacheService.makeKey(symbol, interval, 'bbands', { period, nbdevup, nbdevdn });
    const cached = cache.get<BBandsValue[]>(cacheKey);
    if (cached) return cached;

    const params: Record<string, string> = {
      symbol: normalizedSymbol,
      interval: mappedInterval,
      outputsize: '100',
      time_period: String(period),
      sd: String(nbdevup),
    };

    if (this.isCryptoPair(normalizedSymbol)) {
      params.exchange = DEFAULT_CRYPTO_EXCHANGE;
    }

    const data = await this.request<{ values?: Array<Record<string, string>> }>('/bbands', params);

    if (!data.values || !Array.isArray(data.values)) {
      logger.warn(`No BBANDS data returned for ${symbol}`);
      return [];
    }

    const values: BBandsValue[] = data.values.map(v => ({
      timestamp: v.datetime || '',
      upper: parseFloat(v.upper_band || '0'),
      middle: parseFloat(v.middle_band || '0'),
      lower: parseFloat(v.lower_band || '0'),
    }));

    const sorted = this.oldestFirst(values.map(v => ({ ...v, datetime: v.timestamp })));
    const result = sorted.map(v => ({ timestamp: v.timestamp, upper: v.upper, middle: v.middle, lower: v.lower }));

    const ttl = interval === 'daily' || interval === '1day' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, result, ttl);

    return result;
  }

  async getMACD(
    symbol: string,
    interval: string,
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): Promise<MACDValue[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const mappedInterval = this.mapInterval(interval);

    const cacheKey = CacheService.makeKey(symbol, interval, 'macd', { fastPeriod, slowPeriod, signalPeriod });
    const cached = cache.get<MACDValue[]>(cacheKey);
    if (cached) return cached;

    const params: Record<string, string> = {
      symbol: normalizedSymbol,
      interval: mappedInterval,
      outputsize: '100',
      fast_period: String(fastPeriod),
      slow_period: String(slowPeriod),
      signal_period: String(signalPeriod),
    };

    if (this.isCryptoPair(normalizedSymbol)) {
      params.exchange = DEFAULT_CRYPTO_EXCHANGE;
    }

    const data = await this.request<{ values?: Array<Record<string, string>> }>('/macd', params);

    if (!data.values || !Array.isArray(data.values)) {
      logger.warn(`No MACD data returned for ${symbol}`);
      return [];
    }

    const values: MACDValue[] = data.values.map(v => ({
      timestamp: v.datetime || '',
      macd: parseFloat(v.macd || '0'),
      signal: parseFloat(v.macd_signal || '0'),
      histogram: parseFloat(v.macd_hist || '0'),
    }));

    const sorted = this.oldestFirst(values.map(v => ({ ...v, datetime: v.timestamp })));
    const result = sorted.map(v => ({ timestamp: v.timestamp, macd: v.macd, signal: v.signal, histogram: v.histogram }));

    const ttl = interval === 'daily' || interval === '1day' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, result, ttl);

    return result;
  }

  async getOBV(symbol: string, interval: string): Promise<IndicatorValue[]> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const mappedInterval = this.mapInterval(interval);

    const cacheKey = CacheService.makeKey(symbol, interval, 'obv', {});
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const params: Record<string, string> = {
      symbol: normalizedSymbol,
      interval: mappedInterval,
      outputsize: '100',
    };

    if (this.isCryptoPair(normalizedSymbol)) {
      params.exchange = DEFAULT_CRYPTO_EXCHANGE;
    }

    try {
      const data = await this.request<{ values?: Array<Record<string, string>> }>('/obv', params);

      if (!data.values || !Array.isArray(data.values)) {
        logger.warn(`No OBV data returned for ${symbol}, using local fallback`);
        return this.calculateOBVLocally(symbol, interval);
      }

      const values: IndicatorValue[] = data.values.map(v => ({
        timestamp: v.datetime || '',
        value: parseFloat(v.obv || '0'),
      }));

      const sorted = this.oldestFirst(values.map(v => ({ ...v, datetime: v.timestamp })));
      const result = sorted.map(v => ({ timestamp: v.timestamp, value: v.value }));

      const ttl = interval === 'daily' || interval === '1day' ? CACHE_TTL.D1 : CACHE_TTL.H1;
      cache.set(cacheKey, result, ttl);

      return result;
    } catch (error) {
      logger.warn(`OBV API failed for ${symbol}, using local fallback: ${error}`);
      return this.calculateOBVLocally(symbol, interval);
    }
  }

  private async calculateOBVLocally(symbol: string, interval: string): Promise<IndicatorValue[]> {
    const bars = await this.getOHLCV(symbol, interval, 'compact');
    if (bars.length < 2) return [];

    const obvValues: IndicatorValue[] = [];
    let obv = 0;

    for (let i = 0; i < bars.length; i++) {
      if (i === 0) {
        obv = bars[i].volume;
      } else {
        const priceChange = bars[i].close - bars[i - 1].close;
        if (priceChange > 0) {
          obv += bars[i].volume;
        } else if (priceChange < 0) {
          obv -= bars[i].volume;
        }
      }
      obvValues.push({ timestamp: bars[i].timestamp, value: obv });
    }

    return obvValues;
  }
}

export const twelveData = new TwelveDataClient();
export { TwelveDataClient };

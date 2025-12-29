/**
 * Alpha Vantage API Client
 * Handles all API calls with caching and rate limiting
 */

import { rateLimiter } from './rateLimiter.js';
import { cache, CacheService, CACHE_TTL } from './cache.js';
import { createLogger } from './logger.js';
import { getAssetClass } from '../config/universe.js';

const logger = createLogger('AlphaVantage');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// API CLIENT
// ═══════════════════════════════════════════════════════════════

class AlphaVantageClient {
  private baseUrl = 'https://www.alphavantage.co/query';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ALPHAVANTAGE_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('ALPHAVANTAGE_API_KEY not set - API calls will fail');
    }
  }

  /**
   * Make API request with rate limiting
   */
  private async fetch<T>(params: Record<string, string>): Promise<T> {
    // Wait for rate limit token
    await rateLimiter.acquire();

    const url = new URL(this.baseUrl);
    url.searchParams.set('apikey', this.apiKey);
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    logger.debug(`Fetching: ${params.function} for ${params.symbol || params.from_symbol || 'N/A'}`);

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Check for API error messages
    if (data['Error Message']) {
      throw new Error(`Alpha Vantage error: ${data['Error Message']}`);
    }
    
    if (data['Note']) {
      logger.warn('API rate limit note received');
      throw new Error('Rate limit reached - please wait');
    }

    return data as T;
  }

  /**
   * Split forex pair into from/to currencies
   */
  private splitForexPair(symbol: string): { from: string; to: string } {
    return {
      from: symbol.slice(0, 3),
      to: symbol.slice(3, 6),
    };
  }

  /**
   * Split crypto symbol into symbol/market
   */
  private splitCryptoSymbol(symbol: string): { symbol: string; market: string } {
    // BTCUSD -> BTC, USD
    const cryptoSymbols = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BCH', 'BNB', 'LTC'];
    for (const crypto of cryptoSymbols) {
      if (symbol.startsWith(crypto)) {
        return { symbol: crypto, market: symbol.slice(crypto.length) || 'USD' };
      }
    }
    return { symbol: symbol.replace('USD', ''), market: 'USD' };
  }

  // ═══════════════════════════════════════════════════════════════
  // OHLCV DATA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get OHLCV bars for a symbol
   */
  async getOHLCV(
    symbol: string,
    interval: '1min' | '5min' | '15min' | '30min' | '60min' | 'daily' = '60min',
    outputSize: 'compact' | 'full' = 'compact'
  ): Promise<OHLCVBar[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'ohlcv', { outputSize });
    const cached = cache.get<OHLCVBar[]>(cacheKey);
    if (cached) return cached;

    const assetClass = getAssetClass(symbol);
    let data: Record<string, unknown>;

    if (assetClass === 'forex') {
      const { from, to } = this.splitForexPair(symbol);
      
      if (interval === 'daily') {
        data = await this.fetch({
          function: 'FX_DAILY',
          from_symbol: from,
          to_symbol: to,
          outputsize: outputSize,
        });
      } else {
        data = await this.fetch({
          function: 'FX_INTRADAY',
          from_symbol: from,
          to_symbol: to,
          interval,
          outputsize: outputSize,
        });
      }
    } else {
      // Crypto
      const { symbol: cryptoSym, market } = this.splitCryptoSymbol(symbol);
      
      if (interval === 'daily') {
        data = await this.fetch({
          function: 'DIGITAL_CURRENCY_DAILY',
          symbol: cryptoSym,
          market,
        });
      } else {
        data = await this.fetch({
          function: 'CRYPTO_INTRADAY',
          symbol: cryptoSym,
          market,
          interval,
          outputsize: outputSize,
        });
      }
    }

    const bars = this.parseOHLCV(data, assetClass);
    
    // Cache based on interval
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, bars, ttl);

    return bars;
  }

  /**
   * Parse OHLCV response from Alpha Vantage
   */
  private parseOHLCV(data: Record<string, unknown>, assetClass: 'forex' | 'crypto'): OHLCVBar[] {
    // Find the time series key
    const seriesKey = Object.keys(data).find(k => 
      k.includes('Time Series') || k.includes('time series')
    );
    
    if (!seriesKey || !data[seriesKey]) {
      logger.warn('No time series data found in response');
      return [];
    }

    const series = data[seriesKey] as Record<string, Record<string, string>>;
    const bars: OHLCVBar[] = [];

    for (const [timestamp, values] of Object.entries(series)) {
      // Handle different key formats
      const open = parseFloat(values['1. open'] || values['1a. open (USD)'] || '0');
      const high = parseFloat(values['2. high'] || values['2a. high (USD)'] || '0');
      const low = parseFloat(values['3. low'] || values['3a. low (USD)'] || '0');
      const close = parseFloat(values['4. close'] || values['4a. close (USD)'] || '0');
      const volume = parseFloat(values['5. volume'] || values['5. volume'] || '0');

      bars.push({ timestamp, open, high, low, close, volume });
    }

    // Sort chronologically (oldest first)
    return bars.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // TECHNICAL INDICATORS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get EMA values
   */
  async getEMA(
    symbol: string,
    interval: string,
    period: number
  ): Promise<IndicatorValue[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'ema', { period });
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    // For forex, we need to use the combined symbol format
    const data = await this.fetch<Record<string, unknown>>({
      function: 'EMA',
      symbol,
      interval,
      time_period: String(period),
      series_type: 'close',
    });

    const values = this.parseIndicator(data, 'EMA');
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Get RSI values
   */
  async getRSI(
    symbol: string,
    interval: string,
    period: number = 14
  ): Promise<IndicatorValue[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'rsi', { period });
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'RSI',
      symbol,
      interval,
      time_period: String(period),
      series_type: 'close',
    });

    const values = this.parseIndicator(data, 'RSI');
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Get ADX values
   */
  async getADX(
    symbol: string,
    interval: string,
    period: number = 14
  ): Promise<IndicatorValue[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'adx', { period });
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'ADX',
      symbol,
      interval,
      time_period: String(period),
    });

    const values = this.parseIndicator(data, 'ADX');
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Get ATR values
   */
  async getATR(
    symbol: string,
    interval: string,
    period: number = 14
  ): Promise<IndicatorValue[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'atr', { period });
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'ATR',
      symbol,
      interval,
      time_period: String(period),
    });

    const values = this.parseIndicator(data, 'ATR');
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Get Stochastic values
   */
  async getStochastic(
    symbol: string,
    interval: string,
    fastkPeriod: number = 14,
    slowkPeriod: number = 3,
    slowdPeriod: number = 3
  ): Promise<{ timestamp: string; k: number; d: number }[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'stoch', { fastkPeriod, slowkPeriod, slowdPeriod });
    const cached = cache.get<{ timestamp: string; k: number; d: number }[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'STOCH',
      symbol,
      interval,
      fastkperiod: String(fastkPeriod),
      slowkperiod: String(slowkPeriod),
      slowdperiod: String(slowdPeriod),
    });

    const values = this.parseStochastic(data);
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Parse Stochastic response
   */
  private parseStochastic(data: Record<string, unknown>): { timestamp: string; k: number; d: number }[] {
    const seriesKey = Object.keys(data).find(k => k.includes('Technical Analysis'));
    if (!seriesKey || !data[seriesKey]) return [];

    const series = data[seriesKey] as Record<string, Record<string, string>>;
    const values: { timestamp: string; k: number; d: number }[] = [];

    for (const [timestamp, valueObj] of Object.entries(series)) {
      const k = parseFloat(valueObj['SlowK'] || '0');
      const d = parseFloat(valueObj['SlowD'] || '0');
      values.push({ timestamp, k, d });
    }

    return values.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Get Williams %R values
   */
  async getWilliamsR(
    symbol: string,
    interval: string,
    period: number = 14
  ): Promise<IndicatorValue[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'willr', { period });
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'WILLR',
      symbol,
      interval,
      time_period: String(period),
    });

    const values = this.parseIndicator(data, 'WILLR');
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Get CCI values
   */
  async getCCI(
    symbol: string,
    interval: string,
    period: number = 20
  ): Promise<IndicatorValue[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'cci', { period });
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'CCI',
      symbol,
      interval,
      time_period: String(period),
    });

    const values = this.parseIndicator(data, 'CCI');
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Get Bollinger Bands values
   */
  async getBBands(
    symbol: string,
    interval: string,
    period: number = 20,
    nbdevup: number = 2,
    nbdevdn: number = 2
  ): Promise<{ timestamp: string; upper: number; middle: number; lower: number }[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'bbands', { period, nbdevup, nbdevdn });
    const cached = cache.get<{ timestamp: string; upper: number; middle: number; lower: number }[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'BBANDS',
      symbol,
      interval,
      time_period: String(period),
      series_type: 'close',
      nbdevup: String(nbdevup),
      nbdevdn: String(nbdevdn),
    });

    const values = this.parseBBands(data);
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Parse Bollinger Bands response
   */
  private parseBBands(data: Record<string, unknown>): { timestamp: string; upper: number; middle: number; lower: number }[] {
    const seriesKey = Object.keys(data).find(k => k.includes('Technical Analysis'));
    if (!seriesKey || !data[seriesKey]) return [];

    const series = data[seriesKey] as Record<string, Record<string, string>>;
    const values: { timestamp: string; upper: number; middle: number; lower: number }[] = [];

    for (const [timestamp, valueObj] of Object.entries(series)) {
      const upper = parseFloat(valueObj['Real Upper Band'] || '0');
      const middle = parseFloat(valueObj['Real Middle Band'] || '0');
      const lower = parseFloat(valueObj['Real Lower Band'] || '0');
      values.push({ timestamp, upper, middle, lower });
    }

    return values.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Get SMA values
   */
  async getSMA(
    symbol: string,
    interval: string,
    period: number
  ): Promise<IndicatorValue[]> {
    const cacheKey = CacheService.makeKey(symbol, interval, 'sma', { period });
    const cached = cache.get<IndicatorValue[]>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'SMA',
      symbol,
      interval,
      time_period: String(period),
      series_type: 'close',
    });

    const values = this.parseIndicator(data, 'SMA');
    
    const ttl = interval === 'daily' ? CACHE_TTL.D1 : CACHE_TTL.H1;
    cache.set(cacheKey, values, ttl);

    return values;
  }

  /**
   * Parse indicator response
   */
  private parseIndicator(
    data: Record<string, unknown>,
    indicatorName: string
  ): IndicatorValue[] {
    const seriesKey = Object.keys(data).find(k => 
      k.includes('Technical Analysis')
    );
    
    if (!seriesKey || !data[seriesKey]) {
      logger.warn(`No ${indicatorName} data found in response`);
      return [];
    }

    const series = data[seriesKey] as Record<string, Record<string, string>>;
    const values: IndicatorValue[] = [];

    for (const [timestamp, valueObj] of Object.entries(series)) {
      const value = parseFloat(valueObj[indicatorName] || '0');
      values.push({ timestamp, value });
    }

    // Sort chronologically
    return values.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // EXCHANGE RATE (for position sizing)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get current exchange rate
   */
  async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const cacheKey = CacheService.makeKey(fromCurrency, toCurrency, 'rate', {});
    const cached = cache.get<number>(cacheKey);
    if (cached) return cached;

    const data = await this.fetch<Record<string, unknown>>({
      function: 'CURRENCY_EXCHANGE_RATE',
      from_currency: fromCurrency,
      to_currency: toCurrency,
    });

    const rateData = data['Realtime Currency Exchange Rate'] as Record<string, string>;
    if (!rateData) {
      throw new Error('No exchange rate data received');
    }

    const rate = parseFloat(rateData['5. Exchange Rate'] || '0');
    
    cache.set(cacheKey, rate, CACHE_TTL.exchangeRate);

    return rate;
  }

  /**
   * Get current price for a symbol
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const bars = await this.getOHLCV(symbol, '60min', 'compact');
    if (bars.length === 0) {
      throw new Error(`No price data for ${symbol}`);
    }
    return bars[bars.length - 1].close;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const alphaVantage = new AlphaVantageClient();

export { AlphaVantageClient };

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
// API CLIENT
// ═══════════════════════════════════════════════════════════════
class AlphaVantageClient {
    baseUrl = 'https://www.alphavantage.co/query';
    apiKey;
    constructor() {
        this.apiKey = process.env.ALPHAVANTAGE_API_KEY || '';
        if (!this.apiKey) {
            logger.warn('ALPHAVANTAGE_API_KEY not set - API calls will fail');
        }
    }
    /**
     * Make API request with rate limiting
     */
    async fetch(params) {
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
        return data;
    }
    /**
     * Split forex pair into from/to currencies
     */
    splitForexPair(symbol) {
        return {
            from: symbol.slice(0, 3),
            to: symbol.slice(3, 6),
        };
    }
    /**
     * Split crypto symbol into symbol/market
     */
    splitCryptoSymbol(symbol) {
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
    async getOHLCV(symbol, interval = '60min', outputSize = 'compact') {
        const cacheKey = CacheService.makeKey(symbol, interval, 'ohlcv', { outputSize });
        const cached = cache.get(cacheKey);
        if (cached)
            return cached;
        const assetClass = getAssetClass(symbol);
        let data;
        if (assetClass === 'forex') {
            const { from, to } = this.splitForexPair(symbol);
            if (interval === 'daily') {
                data = await this.fetch({
                    function: 'FX_DAILY',
                    from_symbol: from,
                    to_symbol: to,
                    outputsize: outputSize,
                });
            }
            else {
                data = await this.fetch({
                    function: 'FX_INTRADAY',
                    from_symbol: from,
                    to_symbol: to,
                    interval,
                    outputsize: outputSize,
                });
            }
        }
        else {
            // Crypto
            const { symbol: cryptoSym, market } = this.splitCryptoSymbol(symbol);
            if (interval === 'daily') {
                data = await this.fetch({
                    function: 'DIGITAL_CURRENCY_DAILY',
                    symbol: cryptoSym,
                    market,
                });
            }
            else {
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
    parseOHLCV(data, assetClass) {
        // Find the time series key
        const seriesKey = Object.keys(data).find(k => k.includes('Time Series') || k.includes('time series'));
        if (!seriesKey || !data[seriesKey]) {
            logger.warn('No time series data found in response');
            return [];
        }
        const series = data[seriesKey];
        const bars = [];
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
        return bars.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    // ═══════════════════════════════════════════════════════════════
    // TECHNICAL INDICATORS
    // ═══════════════════════════════════════════════════════════════
    /**
     * Get EMA values
     */
    async getEMA(symbol, interval, period) {
        const cacheKey = CacheService.makeKey(symbol, interval, 'ema', { period });
        const cached = cache.get(cacheKey);
        if (cached)
            return cached;
        // For forex, we need to use the combined symbol format
        const data = await this.fetch({
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
    async getRSI(symbol, interval, period = 14) {
        const cacheKey = CacheService.makeKey(symbol, interval, 'rsi', { period });
        const cached = cache.get(cacheKey);
        if (cached)
            return cached;
        const data = await this.fetch({
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
    async getADX(symbol, interval, period = 14) {
        const cacheKey = CacheService.makeKey(symbol, interval, 'adx', { period });
        const cached = cache.get(cacheKey);
        if (cached)
            return cached;
        const data = await this.fetch({
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
    async getATR(symbol, interval, period = 14) {
        const cacheKey = CacheService.makeKey(symbol, interval, 'atr', { period });
        const cached = cache.get(cacheKey);
        if (cached)
            return cached;
        const data = await this.fetch({
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
     * Parse indicator response
     */
    parseIndicator(data, indicatorName) {
        const seriesKey = Object.keys(data).find(k => k.includes('Technical Analysis'));
        if (!seriesKey || !data[seriesKey]) {
            logger.warn(`No ${indicatorName} data found in response`);
            return [];
        }
        const series = data[seriesKey];
        const values = [];
        for (const [timestamp, valueObj] of Object.entries(series)) {
            const value = parseFloat(valueObj[indicatorName] || '0');
            values.push({ timestamp, value });
        }
        // Sort chronologically
        return values.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    // ═══════════════════════════════════════════════════════════════
    // EXCHANGE RATE (for position sizing)
    // ═══════════════════════════════════════════════════════════════
    /**
     * Get current exchange rate
     */
    async getExchangeRate(fromCurrency, toCurrency) {
        const cacheKey = CacheService.makeKey(fromCurrency, toCurrency, 'rate', {});
        const cached = cache.get(cacheKey);
        if (cached)
            return cached;
        const data = await this.fetch({
            function: 'CURRENCY_EXCHANGE_RATE',
            from_currency: fromCurrency,
            to_currency: toCurrency,
        });
        const rateData = data['Realtime Currency Exchange Rate'];
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
    async getCurrentPrice(symbol) {
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
//# sourceMappingURL=alphaVantageClient.js.map
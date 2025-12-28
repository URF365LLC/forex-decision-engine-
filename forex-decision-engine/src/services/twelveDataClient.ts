/**
 * Twelve Data API Client
 * Fetches OHLCV data for Metals, Indices, and Energies
 * Implements dedicated rate limiting (8 calls/min on free tier)
 */

import { OHLCVBar } from './alphaVantageClient.js';
import { createLogger } from './logger.js';
import { cache } from './cache.js';

const logger = createLogger('TwelveData');

const BASE_URL = 'https://api.twelvedata.com';
const API_KEY = process.env.TWELVE_DATA_API_KEY;

const SYMBOL_MAP: Record<string, string> = {
  'XAUUSD': 'XAU/USD',
  'XAGUSD': 'XAG/USD',
  'ASX':    'XJO',
  'DAX':    'GDAXI',
  'DOW':    'DJI',
  'NIKKEI': 'NI225',
  'NSDQ':   'NDX',
  'SP':     'SPX',
  'WTI':    'WTI/USD',
  'BRENT':  'BRENT/USD',
};

const INTERVAL_MAP: Record<string, string> = {
  '1min':  '1min',
  '5min':  '5min',
  '15min': '15min',
  '30min': '30min',
  '60min': '1h',
  'daily': '1day',
};

const CACHE_TTL = 15 * 60 * 1000;

class TwelveDataRateLimiter {
  private tokens: number = 8;
  private maxTokens: number = 8;
  private refillInterval: number = 60000;
  private lastRefill: number = Date.now();
  private queue: Array<{ resolve: () => void }> = [];
  
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillInterval) * this.maxTokens;
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
  
  async acquire(): Promise<void> {
    this.refill();
    
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    
    logger.debug('Rate limit reached, queueing request');
    
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      
      const checkInterval = setInterval(() => {
        this.refill();
        if (this.tokens > 0 && this.queue.length > 0) {
          this.tokens--;
          const next = this.queue.shift();
          if (next) {
            clearInterval(checkInterval);
            next.resolve();
          }
        }
      }, 1000);
    });
  }
  
  getStatus(): { tokens: number; queued: number } {
    this.refill();
    return { tokens: this.tokens, queued: this.queue.length };
  }
}

const rateLimiter = new TwelveDataRateLimiter();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isTwelveDataSymbol(symbol: string): boolean {
  return symbol in SYMBOL_MAP;
}

export async function getTwelveDataOHLCV(
  symbol: string,
  interval: string,
  outputsize: number = 500
): Promise<OHLCVBar[]> {
  const twelveSymbol = SYMBOL_MAP[symbol];
  if (!twelveSymbol) {
    throw new Error(`Symbol ${symbol} not supported by Twelve Data`);
  }
  
  const twelveInterval = INTERVAL_MAP[interval];
  if (!twelveInterval) {
    throw new Error(`Interval ${interval} not supported by Twelve Data`);
  }
  
  const cacheKey = `twelvedata:${symbol}:${interval}:${outputsize}`;
  const cached = cache.get<OHLCVBar[]>(cacheKey);
  if (cached) {
    logger.debug(`Cache hit for ${symbol} ${interval}`);
    return cached;
  }
  
  if (!API_KEY) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }
  
  await rateLimiter.acquire();
  
  const url = `${BASE_URL}/time_series?symbol=${encodeURIComponent(twelveSymbol)}&interval=${twelveInterval}&outputsize=${outputsize}&apikey=${API_KEY}`;
  
  logger.debug(`Fetching ${twelveSymbol} ${twelveInterval} (${outputsize} bars)`);
  
  let retries = 0;
  const maxRetries = 2;
  
  while (retries <= maxRetries) {
    try {
      const response = await fetch(url);
      
      if (response.status === 429) {
        logger.warn(`Rate limit hit for ${symbol}, waiting 60s (retry ${retries + 1}/${maxRetries})`);
        if (retries < maxRetries) {
          await sleep(60000);
          retries++;
          continue;
        }
        throw new Error(`Rate limit exceeded for ${symbol} after ${maxRetries} retries`);
      }
      
      if (!response.ok) {
        throw new Error(`Twelve Data API error: ${response.status} ${response.statusText}`);
      }
      
      const json = await response.json();
      
      if (json.status === 'error') {
        throw new Error(`Twelve Data error: ${json.message || 'Unknown error'}`);
      }
      
      if (!json.values || json.values.length === 0) {
        logger.warn(`No data returned from Twelve Data for ${twelveSymbol}`);
        return [];
      }
      
      const bars: OHLCVBar[] = json.values
        .map((v: any) => ({
          timestamp: v.datetime,
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: parseFloat(v.volume || '0'),
        }))
        .reverse();
      
      cache.set(cacheKey, bars, CACHE_TTL);
      
      logger.info(`Fetched ${bars.length} bars from Twelve Data for ${symbol}`);
      
      await sleep(100);
      
      return bars;
      
    } catch (error) {
      if (retries < maxRetries && error instanceof Error && error.message.includes('rate')) {
        retries++;
        await sleep(60000);
        continue;
      }
      throw error;
    }
  }
  
  throw new Error(`Failed to fetch ${symbol} after ${maxRetries} retries`);
}

export function getTwelveDataRateLimiterStatus(): { tokens: number; queued: number } {
  return rateLimiter.getStatus();
}

export const twelveData = {
  getOHLCV: getTwelveDataOHLCV,
  isSupported: isTwelveDataSymbol,
  getRateLimiterStatus: getTwelveDataRateLimiterStatus,
};

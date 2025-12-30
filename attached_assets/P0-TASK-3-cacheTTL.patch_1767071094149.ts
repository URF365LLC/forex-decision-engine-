/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P0 TASK #3: OPTIMIZE CACHE TTL BY TIMEFRAME
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: Cache TTLs are not optimized for timeframe characteristics
 *   - H1 data cached for 60 minutes = stale by next candle
 *   - H4 data cached for 4 hours = stale, missing intra-candle updates
 *   - All indicators cached uniformly regardless of volatility
 * 
 * SOLUTION: Timeframe-aware cache TTLs
 *   - H1 indicators → 5 minute TTL (refresh within candle)
 *   - H4 indicators → 30 minute TTL (multiple checks per candle)
 *   - Daily indicators → 4 hour TTL (stable trend data)
 *   - Raw OHLCV → Match candle duration (60min for H1, 240min for H4)
 * 
 * FILE TO MODIFY: src/services/cache.ts (lines 183-192)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createLogger } from './logger.js';

const logger = createLogger('Cache');

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE TTL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * TTL values in milliseconds, organized by data type and timeframe
 */
export const CACHE_TTL = {
  // ════════════════════════════════════════════════════════════════
  // OHLCV DATA - Cache for candle duration (data won't change until new candle)
  // ════════════════════════════════════════════════════════════════
  ohlcv: {
    '1min': 1 * 60 * 1000,      // 1 minute
    '5min': 5 * 60 * 1000,      // 5 minutes
    '15min': 15 * 60 * 1000,    // 15 minutes
    '30min': 30 * 60 * 1000,    // 30 minutes
    '60min': 60 * 60 * 1000,    // 60 minutes (H1)
    'daily': 4 * 60 * 60 * 1000, // 4 hours (daily updates less frequently)
    'weekly': 24 * 60 * 60 * 1000, // 24 hours
    'monthly': 24 * 60 * 60 * 1000, // 24 hours
  },
  
  // ════════════════════════════════════════════════════════════════
  // TECHNICAL INDICATORS - Shorter TTL for faster-moving timeframes
  // ════════════════════════════════════════════════════════════════
  indicators: {
    '1min': 30 * 1000,          // 30 seconds
    '5min': 1 * 60 * 1000,      // 1 minute
    '15min': 3 * 60 * 1000,     // 3 minutes
    '30min': 5 * 60 * 1000,     // 5 minutes
    '60min': 5 * 60 * 1000,     // 5 minutes (H1) - CHANGED from 60min
    'daily': 4 * 60 * 60 * 1000, // 4 hours - trend data is stable
    'weekly': 12 * 60 * 60 * 1000, // 12 hours
    'monthly': 24 * 60 * 60 * 1000, // 24 hours
  },
  
  // ════════════════════════════════════════════════════════════════
  // AGGREGATED DATA (H4 from H1 bars)
  // ════════════════════════════════════════════════════════════════
  aggregated: {
    'H4': 30 * 60 * 1000,       // 30 minutes - CHANGED from 4 hours
  },
  
  // ════════════════════════════════════════════════════════════════
  // DECISION/ANALYSIS RESULTS
  // ════════════════════════════════════════════════════════════════
  decisions: {
    trade: 5 * 60 * 1000,       // 5 minutes for active trade signals
    noTrade: 2 * 60 * 1000,     // 2 minutes for no-trade (from Task #2)
  },
  
  // ════════════════════════════════════════════════════════════════
  // QUOTES / REAL-TIME DATA
  // ════════════════════════════════════════════════════════════════
  quotes: {
    forex: 30 * 1000,           // 30 seconds
    crypto: 15 * 1000,          // 15 seconds (more volatile)
  },
} as const;


// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get appropriate TTL for OHLCV data based on interval
 */
export function getOHLCVCacheTTL(interval: string): number {
  const normalizedInterval = interval.toLowerCase();
  
  // Map Alpha Vantage intervals to our config
  const intervalMap: Record<string, keyof typeof CACHE_TTL.ohlcv> = {
    '1min': '1min',
    '5min': '5min',
    '15min': '15min',
    '30min': '30min',
    '60min': '60min',
    'daily': 'daily',
    'weekly': 'weekly',
    'monthly': 'monthly',
  };
  
  const mapped = intervalMap[normalizedInterval] || '60min';
  return CACHE_TTL.ohlcv[mapped];
}

/**
 * Get appropriate TTL for indicator data based on interval
 */
export function getIndicatorCacheTTL(interval: string): number {
  const normalizedInterval = interval.toLowerCase();
  
  const intervalMap: Record<string, keyof typeof CACHE_TTL.indicators> = {
    '1min': '1min',
    '5min': '5min',
    '15min': '15min',
    '30min': '30min',
    '60min': '60min',
    'daily': 'daily',
    'weekly': 'weekly',
    'monthly': 'monthly',
  };
  
  const mapped = intervalMap[normalizedInterval] || '60min';
  return CACHE_TTL.indicators[mapped];
}

/**
 * Get TTL for aggregated timeframe data
 */
export function getAggregatedCacheTTL(timeframe: string): number {
  if (timeframe === 'H4') {
    return CACHE_TTL.aggregated.H4;
  }
  // Default to indicator TTL for unknown timeframes
  return CACHE_TTL.indicators['60min'];
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATED CacheService CLASS
// ═══════════════════════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
  interval?: string;  // Track the interval for debugging
}

export class CacheService {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }
  
  /**
   * Get cached value if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      return null;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      logger.debug(`Cache expired: ${key}`);
      return null;
    }
    
    return entry.data;
  }
  
  /**
   * Set cache with TTL
   */
  set<T>(key: string, data: T, ttlMs: number, interval?: string): void {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      interval,
    };
    
    this.cache.set(key, entry);
    logger.debug(`Cache set: ${key} (TTL: ${Math.round(ttlMs / 1000)}s)`);
  }
  
  /**
   * Set OHLCV data with timeframe-aware TTL
   */
  setOHLCV<T>(key: string, data: T, interval: string): void {
    const ttl = getOHLCVCacheTTL(interval);
    this.set(key, data, ttl, interval);
  }
  
  /**
   * Set indicator data with timeframe-aware TTL
   */
  setIndicator<T>(key: string, data: T, interval: string): void {
    const ttl = getIndicatorCacheTTL(interval);
    this.set(key, data, ttl, interval);
  }
  
  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }
  
  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }
  
  /**
   * Delete all keys matching a pattern
   */
  deletePattern(pattern: string): number {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    logger.debug(`Deleted ${deleted} cache entries matching: ${pattern}`);
    return deleted;
  }
  
  /**
   * Clear all cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`Cache cleared: ${size} entries removed`);
  }
  
  /**
   * Remove expired entries
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug(`Cache cleanup: ${cleaned} expired entries removed`);
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    byInterval: Record<string, number>;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const byInterval: Record<string, number> = {};
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;
    
    for (const entry of this.cache.values()) {
      const interval = entry.interval || 'unknown';
      byInterval[interval] = (byInterval[interval] || 0) + 1;
      
      if (oldestEntry === null || entry.createdAt < oldestEntry) {
        oldestEntry = entry.createdAt;
      }
      if (newestEntry === null || entry.createdAt > newestEntry) {
        newestEntry = entry.createdAt;
      }
    }
    
    return {
      size: this.cache.size,
      byInterval,
      oldestEntry,
      newestEntry,
    };
  }
  
  /**
   * Destroy the cache service (cleanup interval)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

// Export singleton instance
export const cache = new CacheService();


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATED alphaVantageClient.ts USAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UPDATE the Alpha Vantage client methods to use timeframe-aware caching.
 * 
 * BEFORE (hardcoded TTL):
 *   this.cache.set(cacheKey, bars, 60 * 60 * 1000); // Always 1 hour
 * 
 * AFTER (timeframe-aware TTL):
 *   this.cache.setOHLCV(cacheKey, bars, interval);  // Uses interval-based TTL
 */

// Example: getOHLCV method update
async function getOHLCV_UPDATED(
  symbol: string,
  interval: string,
  outputsize: 'compact' | 'full' = 'compact'
): Promise<OHLCVBar[]> {
  const cacheKey = `ohlcv:${symbol}:${interval}:${outputsize}`;
  
  // Check cache
  const cached = cache.get<OHLCVBar[]>(cacheKey);
  if (cached) {
    logger.debug(`Cache hit: ${cacheKey}`);
    return cached;
  }
  
  // ... fetch from API ...
  const bars: OHLCVBar[] = []; // fetched data
  
  // ════════════════════════════════════════════════════════════════
  // UPDATED: Use timeframe-aware caching
  // ════════════════════════════════════════════════════════════════
  cache.setOHLCV(cacheKey, bars, interval);
  
  return bars;
}

// Example: getEMA method update
async function getEMA_UPDATED(
  symbol: string,
  interval: string,
  timePeriod: number
): Promise<IndicatorValue[]> {
  const cacheKey = `ema:${symbol}:${interval}:${timePeriod}`;
  
  // Check cache
  const cached = cache.get<IndicatorValue[]>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // ... fetch from API ...
  const values: IndicatorValue[] = []; // fetched data
  
  // ════════════════════════════════════════════════════════════════
  // UPDATED: Use timeframe-aware caching
  // ════════════════════════════════════════════════════════════════
  cache.setIndicator(cacheKey, values, interval);
  
  return values;
}


// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION CHECKLIST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Files to update with new caching methods:
 * 
 * 1. src/services/alphaVantageClient.ts
 *    - getOHLCV(): change cache.set() → cache.setOHLCV()
 *    - getEMA(): change cache.set() → cache.setIndicator()
 *    - getRSI(): change cache.set() → cache.setIndicator()
 *    - getADX(): change cache.set() → cache.setIndicator()
 *    - getATR(): change cache.set() → cache.setIndicator()
 *    - getSTOCH(): change cache.set() → cache.setIndicator()
 *    - getWILLR(): change cache.set() → cache.setIndicator()
 *    - getCCI(): change cache.set() → cache.setIndicator()
 *    - getBBANDS(): change cache.set() → cache.setIndicator()
 *    - getSMA(): change cache.set() → cache.setIndicator()
 * 
 * 2. src/engine/indicatorService.ts
 *    - If caching aggregated H4 data, use cache.set() with getAggregatedCacheTTL('H4')
 * 
 * 3. src/services/kucoinClient.ts (if used)
 *    - Same pattern as alphaVantageClient
 */


// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE IMPACT ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BEFORE (Old TTLs):
 *   - H1 indicators: 60 min cache → Stale for 55 minutes after new candle
 *   - H4 indicators: 240 min cache → Stale for 3.5 hours after new candle
 *   - Result: Trading on stale data, missed setups
 * 
 * AFTER (New TTLs):
 *   - H1 indicators: 5 min cache → Fresh data within each candle
 *   - H4 indicators: 30 min cache → 8 refreshes per H4 candle
 *   - Daily indicators: 4 hour cache → Stable trend data, less API calls
 * 
 * API CALL IMPACT:
 *   - H1 indicators: 12x more calls (60/5), but only for active trading hours
 *   - Daily indicators: Same or fewer calls (trend data doesn't change)
 *   - Net increase: ~8-10x for entry indicators during active hours
 * 
 * RECOMMENDATION:
 *   - Consider rate limit before implementing (150 calls/min for Premium)
 *   - May need to batch indicator fetches or use parallel requests
 *   - Monitor API usage after deployment
 */

/**
 * Cache Service
 * In-memory cache with TTL (no SQLite dependency)
 */

import { createLogger } from './logger.js';

const logger = createLogger('Cache');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
}

// ═══════════════════════════════════════════════════════════════
// CACHE CLASS
// ═══════════════════════════════════════════════════════════════

class CacheService {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private hits: number = 0;
  private misses: number = 0;

  constructor() {
    logger.info('Cache initialized (in-memory)');
  }

  /**
   * Generate cache key
   */
  static makeKey(
    symbol: string,
    timeframe: string,
    indicator: string,
    params: Record<string, unknown> = {},
    candleTime?: string
  ): string {
    const paramStr = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    
    const parts = [symbol, timeframe, indicator];
    if (paramStr) parts.push(paramStr);
    if (candleTime) parts.push(candleTime);
    
    return parts.join(':');
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (entry && entry.expiresAt > Date.now()) {
      this.hits++;
      logger.debug(`Cache HIT: ${key}`);
      return entry.value as T;
    }
    
    // Remove expired entry
    if (entry) {
      this.cache.delete(key);
    }
    
    this.misses++;
    logger.debug(`Cache MISS: ${key}`);
    return null;
  }

  /**
   * Set value in cache
   */
  set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    _candleTime?: string
  ): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
  }

  /**
   * Delete specific key
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching pattern
   */
  deletePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace('*', '.*'));
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      logger.info(`Deleted ${count} cache entries matching: ${pattern}`);
    }
    return count;
  }

  /**
   * Clean expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let count = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      logger.info(`Cleaned up ${count} expired cache entries`);
    }
    return count;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    
    return {
      totalEntries: this.cache.size,
      hitCount: this.hits,
      missCount: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Close (no-op for in-memory)
   */
  close(): void {
    this.clear();
    logger.info('Cache closed');
  }
}

// ═══════════════════════════════════════════════════════════════
// CACHE TTL CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════

export const CACHE_TTL = {
  H1: 5 * 60,           // 5 minutes - optimized for premium API real-time data
  H4: 30 * 60,          // 30 minutes - multiple checks per H4 candle
  D1: 4 * 60 * 60,      // 4 hours - daily data is stable
  indicator: {
    '60min': 5 * 60,    // 5 minutes for H1 indicators
    'daily': 4 * 60 * 60, // 4 hours for daily indicators
  },
  noTrade: 2 * 60,      // 2 minutes for no-trade decisions
  exchangeRate: 5 * 60,
} as const;

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const cache = new CacheService();

// ═══════════════════════════════════════════════════════════════
// INTERVAL MANAGEMENT (for clean shutdown)
// ═══════════════════════════════════════════════════════════════

let cleanupIntervalId: NodeJS.Timeout | null = null;

/**
 * Start automatic cache cleanup interval
 */
export function startCacheCleanup(): void {
  if (cleanupIntervalId) {
    logger.debug('Cache cleanup already running');
    return;
  }
  cleanupIntervalId = setInterval(() => {
    cache.cleanup();
  }, 5 * 60 * 1000); // Every 5 minutes
  logger.debug('Cache cleanup interval started');
}

/**
 * Stop automatic cache cleanup interval (for clean shutdown)
 */
export function stopCacheCleanup(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    logger.debug('Cache cleanup interval stopped');
  }
}

// Auto-start cleanup on module load
startCacheCleanup();

export { CacheService };

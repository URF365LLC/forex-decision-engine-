/**
 * Cache Service
 * In-memory cache with TTL (no SQLite dependency)
 */
import { createLogger } from './logger.js';
const logger = createLogger('Cache');
// ═══════════════════════════════════════════════════════════════
// CACHE CLASS
// ═══════════════════════════════════════════════════════════════
class CacheService {
    cache = new Map();
    hits = 0;
    misses = 0;
    constructor() {
        logger.info('Cache initialized (in-memory)');
    }
    /**
     * Generate cache key
     */
    static makeKey(symbol, timeframe, indicator, params = {}, candleTime) {
        const paramStr = Object.entries(params)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('&');
        const parts = [symbol, timeframe, indicator];
        if (paramStr)
            parts.push(paramStr);
        if (candleTime)
            parts.push(candleTime);
        return parts.join(':');
    }
    /**
     * Get value from cache
     */
    get(key) {
        const entry = this.cache.get(key);
        if (entry && entry.expiresAt > Date.now()) {
            this.hits++;
            logger.debug(`Cache HIT: ${key}`);
            return entry.value;
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
    set(key, value, ttlSeconds, _candleTime) {
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
        logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
    }
    /**
     * Delete specific key
     */
    delete(key) {
        return this.cache.delete(key);
    }
    /**
     * Delete all keys matching pattern
     */
    deletePattern(pattern) {
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
    cleanup() {
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
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        logger.info('Cache cleared');
    }
    /**
     * Get cache statistics
     */
    getStats() {
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
    close() {
        this.clear();
        logger.info('Cache closed');
    }
}
// ═══════════════════════════════════════════════════════════════
// CACHE TTL CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════
export const CACHE_TTL = {
    H1: 60 * 60,
    H4: 4 * 60 * 60,
    D1: 24 * 60 * 60,
    indicator: {
        '60min': 60 * 60,
        'daily': 24 * 60 * 60,
    },
    exchangeRate: 5 * 60,
};
// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════
export const cache = new CacheService();
// Cleanup expired entries every 5 minutes
setInterval(() => {
    cache.cleanup();
}, 5 * 60 * 1000);
export { CacheService };
//# sourceMappingURL=cache.js.map
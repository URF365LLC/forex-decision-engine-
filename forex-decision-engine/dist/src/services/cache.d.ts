/**
 * Cache Service
 * In-memory cache with TTL (no SQLite dependency)
 */
interface CacheStats {
    totalEntries: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
}
declare class CacheService {
    private cache;
    private hits;
    private misses;
    constructor();
    /**
     * Generate cache key
     */
    static makeKey(symbol: string, timeframe: string, indicator: string, params?: Record<string, unknown>, candleTime?: string): string;
    /**
     * Get value from cache
     */
    get<T>(key: string): T | null;
    /**
     * Set value in cache
     */
    set<T>(key: string, value: T, ttlSeconds: number, _candleTime?: string): void;
    /**
     * Delete specific key
     */
    delete(key: string): boolean;
    /**
     * Delete all keys matching pattern
     */
    deletePattern(pattern: string): number;
    /**
     * Clean expired entries
     */
    cleanup(): number;
    /**
     * Clear all cache
     */
    clear(): void;
    /**
     * Get cache statistics
     */
    getStats(): CacheStats;
    /**
     * Close (no-op for in-memory)
     */
    close(): void;
}
export declare const CACHE_TTL: {
    readonly H1: number;
    readonly H4: number;
    readonly D1: number;
    readonly indicator: {
        readonly '60min': number;
        readonly daily: number;
    };
    readonly exchangeRate: number;
};
export declare const cache: CacheService;
export { CacheService };

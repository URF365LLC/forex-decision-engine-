/**
 * Rate Limiter Service
 * Token bucket algorithm for Alpha Vantage API (150 calls/min)
 */
interface RateLimiterConfig {
    maxTokens: number;
    refillRate: number;
    minDelayMs: number;
}
declare class TokenBucketRateLimiter {
    private tokens;
    private lastRefill;
    private config;
    private queue;
    private processing;
    constructor(config: RateLimiterConfig);
    /**
     * Refill tokens based on elapsed time
     */
    private refill;
    /**
     * Process queued requests
     */
    private processQueue;
    private delay;
    /**
     * Acquire a token (wait if necessary)
     */
    acquire(timeoutMs?: number): Promise<void>;
    /**
     * Get current state
     */
    getState(): {
        availableTokens: number;
        maxTokens: number;
        queueLength: number;
        processing: boolean;
    };
    /**
     * Reset the limiter
     */
    reset(): void;
}
export declare const rateLimiter: TokenBucketRateLimiter;
export { TokenBucketRateLimiter };

/**
 * Rate Limiter Service
 * Optimized token bucket + sliding window algorithm for Twelve Data API
 * Plan: $99/month = 610 calls/minute
 *
 * Key optimizations:
 * 1. Sliding window tracking ensures we never exceed 610/min
 * 2. Higher burst capacity (150 tokens) enables parallel processing
 * 3. Adaptive throttling only kicks in when approaching limits
 * 4. No artificial minimum delay - let token bucket handle pacing naturally
 */

import { createLogger } from './logger.js';

const logger = createLogger('RateLimiter');

// ═══════════════════════════════════════════════════════════════
// API LIMIT CONSTANTS (Twelve Data $99 Plan)
// ═══════════════════════════════════════════════════════════════
const API_CALLS_PER_MINUTE = 610;
const SLIDING_WINDOW_MS = 60_000; // 1 minute window
const SAFE_MARGIN = 0.95; // Use 95% of limit for safety buffer
const EFFECTIVE_LIMIT = Math.floor(API_CALLS_PER_MINUTE * SAFE_MARGIN); // 579 calls/min

const MAX_QUEUE_SIZE = 300;
const BACKPRESSURE_THRESHOLD = 200;

interface RateLimiterConfig {
  maxTokens: number;
  refillRate: number;
  minDelayMs: number;
}

interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  addedAt: number;
}

export interface AcquireResult {
  acquired: boolean;
  backpressure: boolean;
  queueDepth: number;
  error?: string;
}

export interface RateLimiterStats {
  availableTokens: number;
  maxTokens: number;
  queueLength: number;
  processing: boolean;
  slidingWindow: {
    callsInWindow: number;
    effectiveLimit: number;
    utilizationPercent: number;
    windowStartTime: string;
  };
}

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private config: RateLimiterConfig;
  private queue: QueuedRequest[] = [];
  private processing: boolean = false;

  // Sliding window tracking for precise rate limiting
  private callTimestamps: number[] = [];
  private lastWindowCleanup: number = 0;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();

    logger.info('Rate limiter initialized (optimized for 610/min)', {
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
      minDelayMs: config.minDelayMs,
      effectiveLimit: EFFECTIVE_LIMIT,
      safeMargin: `${SAFE_MARGIN * 100}%`,
    });
  }

  /**
   * Clean old timestamps from sliding window (older than 1 minute)
   */
  private cleanSlidingWindow(): void {
    const now = Date.now();
    // Only cleanup every 5 seconds to avoid performance hit
    if (now - this.lastWindowCleanup < 5000) return;

    const cutoff = now - SLIDING_WINDOW_MS;
    this.callTimestamps = this.callTimestamps.filter(ts => ts > cutoff);
    this.lastWindowCleanup = now;
  }

  /**
   * Record an API call in the sliding window
   */
  private recordCall(): void {
    this.callTimestamps.push(Date.now());
  }

  /**
   * Get current calls in the sliding window
   */
  private getCallsInWindow(): number {
    const cutoff = Date.now() - SLIDING_WINDOW_MS;
    return this.callTimestamps.filter(ts => ts > cutoff).length;
  }

  /**
   * Check if we're approaching the rate limit
   * Returns true if we should apply additional throttling
   */
  private isApproachingLimit(): boolean {
    const callsInWindow = this.getCallsInWindow();
    return callsInWindow >= EFFECTIVE_LIMIT * 0.9; // 90% of effective limit
  }

  /**
   * Calculate adaptive delay based on current usage
   * Returns additional delay in ms when approaching limits
   */
  private getAdaptiveDelay(): number {
    const callsInWindow = this.getCallsInWindow();
    const utilization = callsInWindow / EFFECTIVE_LIMIT;

    if (utilization < 0.7) return 0; // No delay below 70%
    if (utilization < 0.85) return 50; // 50ms delay at 70-85%
    if (utilization < 0.95) return 150; // 150ms delay at 85-95%
    return 500; // 500ms delay above 95%
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.config.refillRate;
    
    this.tokens = Math.min(this.config.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Process queued requests with sliding window awareness
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      this.refill();
      this.cleanSlidingWindow();

      // Check sliding window limit first (hard limit)
      const callsInWindow = this.getCallsInWindow();
      if (callsInWindow >= EFFECTIVE_LIMIT) {
        // Wait until oldest call falls out of window
        const oldestCall = this.callTimestamps[0];
        const waitTime = oldestCall ? (oldestCall + SLIDING_WINDOW_MS - Date.now() + 100) : 1000;
        logger.debug(`Rate limit reached (${callsInWindow}/${EFFECTIVE_LIMIT}), waiting ${waitTime}ms`);
        await this.delay(Math.max(100, waitTime));
        continue;
      }

      if (this.tokens >= 1) {
        const request = this.queue.shift();
        if (request) {
          clearTimeout(request.timeout);
          this.tokens -= 1;
          this.recordCall(); // Track in sliding window
          request.resolve();

          // Apply adaptive delay based on usage (smoother throttling)
          const adaptiveDelay = this.getAdaptiveDelay();
          const effectiveDelay = Math.max(this.config.minDelayMs, adaptiveDelay);
          if (effectiveDelay > 0) {
            await this.delay(effectiveDelay);
          }
        }
      } else {
        // Wait for tokens to refill
        const waitTime = Math.ceil((1 / this.config.refillRate) * 1000);
        await this.delay(waitTime);
      }
    }

    this.processing = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if backpressure is active (queue approaching capacity)
   */
  isBackpressureActive(): boolean {
    return this.queue.length >= BACKPRESSURE_THRESHOLD;
  }

  /**
   * Acquire a token (wait if necessary)
   * Returns graceful result instead of throwing on overflow
   */
  async acquire(timeoutMs: number = 60000): Promise<void> {
    const result = await this.tryAcquire(timeoutMs);
    if (!result.acquired) {
      throw new Error(result.error || 'Rate limit acquisition failed');
    }
  }

  /**
   * Try to acquire a token with graceful backpressure handling
   * Returns structured result instead of throwing on queue overflow
   */
  async tryAcquire(timeoutMs: number = 60000): Promise<AcquireResult> {
    const queueDepth = this.queue.length;
    const backpressure = queueDepth >= BACKPRESSURE_THRESHOLD;

    // Check sliding window limit
    this.cleanSlidingWindow();
    const callsInWindow = this.getCallsInWindow();

    if (queueDepth >= MAX_QUEUE_SIZE) {
      logger.warn(`Rate limiter queue full (${queueDepth}/${MAX_QUEUE_SIZE}) - rejecting request gracefully`);
      return {
        acquired: false,
        backpressure: true,
        queueDepth,
        error: `Rate limit queue full (${queueDepth} pending requests) - try again later`,
      };
    }

    if (backpressure) {
      logger.warn(`Rate limiter backpressure active (${queueDepth}/${MAX_QUEUE_SIZE}, window: ${callsInWindow}/${EFFECTIVE_LIMIT})`);
    }

    this.refill();

    // Fast path: immediate acquisition if tokens available and not at limit
    if (this.tokens >= 1 && callsInWindow < EFFECTIVE_LIMIT) {
      this.tokens -= 1;
      this.recordCall();
      return { acquired: true, backpressure, queueDepth };
    }
    
    return new Promise((resolve) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      timeoutHandle = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        const index = this.queue.findIndex(r => r.timeout === timeoutHandle);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        resolve({
          acquired: false,
          backpressure: true,
          queueDepth: this.queue.length,
          error: 'Rate limit queue timeout',
        });
      }, timeoutMs);

      const queuedResolve = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ acquired: true, backpressure, queueDepth: this.queue.length });
      };

      const queuedReject = (error: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({
          acquired: false,
          backpressure: true,
          queueDepth: this.queue.length,
          error: error.message,
        });
      };

      this.queue.push({
        resolve: queuedResolve,
        reject: queuedReject,
        timeout: timeoutHandle,
        addedAt: Date.now(),
      });

      this.processQueue();
    });
  }

  /**
   * Get current state with sliding window stats
   */
  getState(): RateLimiterStats {
    this.refill();
    this.cleanSlidingWindow();
    const callsInWindow = this.getCallsInWindow();
    const utilizationPercent = Math.round((callsInWindow / EFFECTIVE_LIMIT) * 100);

    return {
      availableTokens: Math.floor(this.tokens),
      maxTokens: this.config.maxTokens,
      queueLength: this.queue.length,
      processing: this.processing,
      slidingWindow: {
        callsInWindow,
        effectiveLimit: EFFECTIVE_LIMIT,
        utilizationPercent,
        windowStartTime: new Date(Date.now() - SLIDING_WINDOW_MS).toISOString(),
      },
    };
  }

  /**
   * Get simplified stats for logging/monitoring
   */
  getUsageStats(): { callsPerMinute: number; utilizationPercent: number; remainingCapacity: number } {
    this.cleanSlidingWindow();
    const callsInWindow = this.getCallsInWindow();
    return {
      callsPerMinute: callsInWindow,
      utilizationPercent: Math.round((callsInWindow / EFFECTIVE_LIMIT) * 100),
      remainingCapacity: EFFECTIVE_LIMIT - callsInWindow,
    };
  }

  /**
   * Reset the limiter
   */
  reset(): void {
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();

    // Clear sliding window
    this.callTimestamps = [];
    this.lastWindowCleanup = 0;

    // Clear queue
    for (const request of this.queue) {
      clearTimeout(request.timeout);
      request.reject(new Error('Rate limiter reset'));
    }
    this.queue = [];
    this.processing = false;

    logger.info('Rate limiter reset');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE - OPTIMIZED FOR 610 CALLS/MINUTE
// ═══════════════════════════════════════════════════════════════

/**
 * Optimized configuration for Twelve Data $99 Plan (610 calls/min):
 *
 * - maxTokens: 150 (allows burst of ~150 parallel requests for fast scans)
 * - refillRate: 10.17 (precisely 610/60 = 10.167 tokens/second)
 * - minDelayMs: 0 (no artificial delay - let adaptive throttling handle it)
 *
 * The sliding window ensures we NEVER exceed 610 calls/minute,
 * while the high burst capacity enables efficient parallel processing.
 */
export const rateLimiter = new TokenBucketRateLimiter({
  maxTokens: 150,                    // High burst for parallel processing
  refillRate: API_CALLS_PER_MINUTE / 60, // Exactly 610/60 = 10.167/sec
  minDelayMs: 0,                     // No artificial delay, adaptive throttling handles this
});

// Export constants for external use
export const RATE_LIMIT_CONFIG = {
  apiCallsPerMinute: API_CALLS_PER_MINUTE,
  effectiveLimit: EFFECTIVE_LIMIT,
  safeMargin: SAFE_MARGIN,
};

export { TokenBucketRateLimiter };

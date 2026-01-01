/**
 * Rate Limiter Service
 * Token bucket algorithm for Twelve Data API (610 calls/min on $99 plan)
 */

import { createLogger } from './logger.js';

const logger = createLogger('RateLimiter');

const MAX_QUEUE_SIZE = 200;

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

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private config: RateLimiterConfig;
  private queue: QueuedRequest[] = [];
  private processing: boolean = false;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
    
    logger.info('Rate limiter initialized', {
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
      minDelayMs: config.minDelayMs,
    });
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
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      this.refill();
      
      if (this.tokens >= 1) {
        const request = this.queue.shift();
        if (request) {
          clearTimeout(request.timeout);
          this.tokens -= 1;
          request.resolve();
          
          // Enforce minimum delay between requests
          await this.delay(this.config.minDelayMs);
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
   * Acquire a token (wait if necessary)
   */
  async acquire(timeoutMs: number = 60000): Promise<void> {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error(`FATAL: Rate limit queue overflow (${this.queue.length} requests) - aborting`);
    }

    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex(r => r.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error('Rate limit queue timeout'));
      }, timeoutMs);

      this.queue.push({
        resolve,
        reject,
        timeout,
        addedAt: Date.now(),
      });

      this.processQueue();
    });
  }

  /**
   * Get current state
   */
  getState(): {
    availableTokens: number;
    maxTokens: number;
    queueLength: number;
    processing: boolean;
  } {
    this.refill();
    return {
      availableTokens: Math.floor(this.tokens),
      maxTokens: this.config.maxTokens,
      queueLength: this.queue.length,
      processing: this.processing,
    };
  }

  /**
   * Reset the limiter
   */
  reset(): void {
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
    
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
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

// Twelve Data $99 Plan: 610 calls/minute = ~10 calls/second
export const rateLimiter = new TokenBucketRateLimiter({
  maxTokens: 60,
  refillRate: 10,
  minDelayMs: 100,
});

export { TokenBucketRateLimiter };

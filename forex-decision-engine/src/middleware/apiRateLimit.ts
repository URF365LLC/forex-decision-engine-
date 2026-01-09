/**
 * API Rate Limiting Middleware
 * Prevents abuse of the HTTP API endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../services/logger.js';

const logger = createLogger('APIRateLimit');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  message?: string;
}

// ═══════════════════════════════════════════════════════════════
// RATE LIMIT STORE
// ═══════════════════════════════════════════════════════════════

class RateLimitStore {
  private windows: Map<string, RateLimitWindow> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  get(key: string): RateLimitWindow | undefined {
    return this.windows.get(key);
  }

  set(key: string, window: RateLimitWindow): void {
    this.windows.set(key, window);
  }

  increment(key: string, windowMs: number): RateLimitWindow {
    const now = Date.now();
    let window = this.windows.get(key);

    if (!window || now >= window.resetAt) {
      // New window
      window = {
        count: 1,
        resetAt: now + windowMs,
      };
    } else {
      // Increment existing window
      window.count++;
    }

    this.windows.set(key, window);
    return window;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
    }
  }

  getStats(): { totalKeys: number; oldestResetAt: number | null } {
    let oldestResetAt: number | null = null;

    for (const window of this.windows.values()) {
      if (oldestResetAt === null || window.resetAt < oldestResetAt) {
        oldestResetAt = window.resetAt;
      }
    }

    return {
      totalKeys: this.windows.size,
      oldestResetAt,
    };
  }

  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
  }
}

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

const store = new RateLimitStore();

/**
 * Create rate limiting middleware
 */
export function createRateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.ip || 'unknown',
    message = 'Too many requests, please try again later',
  } = config;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const window = store.increment(key, windowMs);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - window.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(window.resetAt / 1000));

    if (window.count > maxRequests) {
      const retryAfter = Math.ceil((window.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);

      logger.warn('Rate limit exceeded', {
        key,
        count: window.count,
        limit: maxRequests,
        retryAfter,
      });

      return res.status(429).json({
        error: message,
        retryAfter,
      });
    }

    next();
  };
}

// ═══════════════════════════════════════════════════════════════
// PRESET CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * General API rate limit: 100 requests per minute
 */
export const generalRateLimit = createRateLimit({
  windowMs: 60000,
  maxRequests: 100,
  message: 'Too many API requests. Please slow down.',
});

/**
 * Scan endpoint rate limit: 10 scans per minute
 * (scans are expensive operations)
 */
export const scanRateLimit = createRateLimit({
  windowMs: 60000,
  maxRequests: 10,
  keyGenerator: (req) => `scan:${req.ip || 'unknown'}`,
  message: 'Scan rate limit exceeded. Please wait before scanning again.',
});

/**
 * Authentication rate limit: 5 attempts per minute
 * (prevents brute force if auth is added later)
 */
export const authRateLimit = createRateLimit({
  windowMs: 60000,
  maxRequests: 5,
  keyGenerator: (req) => `auth:${req.ip || 'unknown'}`,
  message: 'Too many authentication attempts. Please wait.',
});

/**
 * Strict rate limit for expensive operations: 3 per minute
 */
export const strictRateLimit = createRateLimit({
  windowMs: 60000,
  maxRequests: 3,
  keyGenerator: (req) => `strict:${req.ip || 'unknown'}`,
  message: 'Operation rate limit exceeded. Please try again later.',
});

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export function getRateLimitStats() {
  return store.getStats();
}

export function closeRateLimitStore() {
  store.close();
}

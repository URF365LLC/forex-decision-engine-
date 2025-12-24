/**
 * Signal Cooldown Service
 * Prevents duplicate signals for same symbol+style+direction
 * unless grade improves or bias flips
 * 
 * Cooldown Rules:
 * 1. Same symbol+style+direction within cooldown period = BLOCKED
 * 2. Grade upgrade (B → A+) = ALLOWED
 * 3. Direction flip (long → short) = ALLOWED
 * 4. After signal validity expires = ALLOWED
 */

import { TradingStyle } from '../config/strategy.js';
import { Grade } from '../engine/grader.js';
import { createLogger } from './logger.js';

const logger = createLogger('Cooldown');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CooldownEntry {
  symbol: string;
  style: TradingStyle;
  direction: 'long' | 'short';
  grade: Grade;
  createdAt: number;
  expiresAt: number;
}

export interface CooldownCheck {
  allowed: boolean;
  reason: string;
  existingSignal?: CooldownEntry;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const COOLDOWN_CONFIG = {
  // Cooldown duration in milliseconds
  intraday: 4 * 60 * 60 * 1000,   // 4 hours (matches signal validity)
  swing: 24 * 60 * 60 * 1000,     // 24 hours (matches signal validity)
  
  // Grade hierarchy for upgrade detection
  gradeRank: {
    'no-trade': 0,
    'B': 1,
    'A+': 2,
  } as Record<Grade, number>,
};

// ═══════════════════════════════════════════════════════════════
// COOLDOWN SERVICE
// ═══════════════════════════════════════════════════════════════

class SignalCooldownService {
  private entries: Map<string, CooldownEntry> = new Map();

  constructor() {
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
    logger.info('Signal cooldown service initialized');
  }

  /**
   * Generate unique key for signal
   */
  private makeKey(symbol: string, style: TradingStyle): string {
    return `${symbol}:${style}`;
  }

  /**
   * Check if a new signal is allowed
   */
  check(
    symbol: string,
    style: TradingStyle,
    direction: 'long' | 'short' | 'none',
    grade: Grade
  ): CooldownCheck {
    // No-trade signals don't trigger cooldown
    if (direction === 'none' || grade === 'no-trade') {
      return { allowed: true, reason: 'No-trade signals bypass cooldown' };
    }

    const key = this.makeKey(symbol, style);
    const existing = this.entries.get(key);

    // No existing signal - allow
    if (!existing) {
      return { allowed: true, reason: 'No existing signal in cooldown' };
    }

    const now = Date.now();

    // Expired - allow
    if (now > existing.expiresAt) {
      this.entries.delete(key);
      return { allowed: true, reason: 'Previous signal expired' };
    }

    // Direction flip - allow (market reversed)
    if (direction !== existing.direction) {
      logger.info(`Direction flip for ${symbol}: ${existing.direction} → ${direction}`);
      return { 
        allowed: true, 
        reason: `Direction flip: ${existing.direction} → ${direction}`,
        existingSignal: existing,
      };
    }

    // Grade upgrade - allow
    const existingRank = COOLDOWN_CONFIG.gradeRank[existing.grade];
    const newRank = COOLDOWN_CONFIG.gradeRank[grade];
    
    if (newRank > existingRank) {
      logger.info(`Grade upgrade for ${symbol}: ${existing.grade} → ${grade}`);
      return { 
        allowed: true, 
        reason: `Grade upgrade: ${existing.grade} → ${grade}`,
        existingSignal: existing,
      };
    }

    // Same or lower grade, same direction, within cooldown - block
    const remainingMs = existing.expiresAt - now;
    const remainingMins = Math.ceil(remainingMs / 60000);
    
    return {
      allowed: false,
      reason: `Cooldown active: ${remainingMins}min remaining (${existing.grade} ${existing.direction})`,
      existingSignal: existing,
    };
  }

  /**
   * Record a new signal (starts cooldown)
   */
  record(
    symbol: string,
    style: TradingStyle,
    direction: 'long' | 'short',
    grade: Grade,
    validUntil?: string
  ): void {
    const key = this.makeKey(symbol, style);
    const now = Date.now();
    
    // Use validUntil if provided, otherwise use default cooldown
    let expiresAt: number;
    if (validUntil) {
      expiresAt = new Date(validUntil).getTime();
    } else {
      const cooldownMs = style === 'intraday' 
        ? COOLDOWN_CONFIG.intraday 
        : COOLDOWN_CONFIG.swing;
      expiresAt = now + cooldownMs;
    }

    const entry: CooldownEntry = {
      symbol,
      style,
      direction,
      grade,
      createdAt: now,
      expiresAt,
    };

    this.entries.set(key, entry);
    logger.debug(`Cooldown recorded: ${symbol} ${style} ${direction} ${grade}`);
  }

  /**
   * Clear cooldown for a symbol
   */
  clear(symbol: string, style: TradingStyle): void {
    const key = this.makeKey(symbol, style);
    this.entries.delete(key);
    logger.debug(`Cooldown cleared: ${symbol} ${style}`);
  }

  /**
   * Clear all cooldowns
   */
  clearAll(): void {
    this.entries.clear();
    logger.info('All cooldowns cleared');
  }

  /**
   * Get active cooldowns
   */
  getActive(): CooldownEntry[] {
    const now = Date.now();
    return Array.from(this.entries.values())
      .filter(e => e.expiresAt > now);
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < now) {
        this.entries.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired cooldown entries`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const signalCooldown = new SignalCooldownService();

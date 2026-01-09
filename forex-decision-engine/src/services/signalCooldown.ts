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
 * 
 * Persistence: Cooldowns are persisted to database and survive restarts
 */

import { TradingStyle } from '../config/strategy.js';
import { createLogger } from './logger.js';
import { getDb, isDbAvailable } from '../db/client.js';

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'no-trade';

const logger = createLogger('Cooldown');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CooldownEntry {
  symbol: string;
  style: TradingStyle;
  strategyId: string;
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
  intraday: 4 * 60 * 60 * 1000,   // 4 hours (matches signal validity)
  swing: 24 * 60 * 60 * 1000,     // 24 hours (matches signal validity)
  
  gradeRank: {
    'no-trade': 0,
    'C': 1,
    'B': 2,
    'B+': 3,
    'A': 4,
    'A+': 5,
  } as Record<Grade, number>,
};

// ═══════════════════════════════════════════════════════════════
// COOLDOWN SERVICE
// ═══════════════════════════════════════════════════════════════

class SignalCooldownService {
  private entries: Map<string, CooldownEntry> = new Map();
  private initialized: boolean = false;
  private initializationFailed: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    logger.info('Signal cooldown service initialized');
  }

  /**
   * Check if the service is ready for operations
   * Returns true if initialized (even if DB load failed - uses in-memory fallback)
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Check if running in degraded mode (DB unavailable)
   */
  isDegraded(): boolean {
    return this.initializationFailed || !isDbAvailable();
  }

  /**
   * Load cooldowns from database on startup
   * Should be called after database is initialized
   * Returns false if initialization failed critically
   */
  async loadFromDatabase(): Promise<boolean> {
    if (!isDbAvailable()) {
      logger.warn('Database not available - cooldowns will not persist across restarts');
      this.initialized = true;
      this.initializationFailed = true;
      return true; // Continue in degraded mode
    }

    try {
      const db = getDb();
      const now = new Date().toISOString();
      
      const rows = await db
        .selectFrom('cooldowns')
        .selectAll()
        .where('expires_at', '>', now)
        .execute();

      for (const row of rows) {
        const entry: CooldownEntry = {
          symbol: row.symbol,
          style: row.style as TradingStyle,
          strategyId: row.strategy_id,
          direction: row.direction as 'long' | 'short',
          grade: row.grade as Grade,
          createdAt: new Date(row.started_at).getTime(),
          expiresAt: new Date(row.expires_at).getTime(),
        };
        
        this.entries.set(row.cooldown_key, entry);
      }

      logger.info(`Loaded ${rows.length} active cooldowns from database`);
      this.initialized = true;
      this.initializationFailed = false;
      return true;
    } catch (error) {
      logger.error('Failed to load cooldowns from database - running in degraded mode', { error });
      this.initialized = true;
      this.initializationFailed = true;
      return true; // Continue in degraded mode with empty cooldowns
    }
  }

  /**
   * Generate unique key for signal
   */
  private makeKey(symbol: string, style: TradingStyle, strategyId: string): string {
    return `${symbol}:${style}:${strategyId}`;
  }

  /**
   * Check if a new signal is allowed
   * Note: This is synchronous for performance - uses in-memory cache
   */
  check(
    symbol: string,
    style: TradingStyle,
    direction: 'long' | 'short' | 'none',
    grade: Grade,
    strategyId: string
  ): CooldownCheck {
    if (!this.initialized) {
      logger.warn('Cooldown check called before initialization - allowing by default');
      return { allowed: true, reason: 'Service not yet initialized' };
    }

    if (direction === 'none' || grade === 'no-trade') {
      return { allowed: true, reason: 'No-trade signals bypass cooldown' };
    }

    const key = this.makeKey(symbol, style, strategyId);
    const existing = this.entries.get(key);

    if (!existing) {
      return { allowed: true, reason: 'No existing signal in cooldown' };
    }

    const now = Date.now();

    if (now > existing.expiresAt) {
      this.entries.delete(key);
      this.deleteFromDatabase(key);
      return { allowed: true, reason: 'Previous signal expired' };
    }

    if (direction !== existing.direction) {
      logger.info(`Direction flip for ${symbol}: ${existing.direction} → ${direction}`);
      return { 
        allowed: true, 
        reason: `Direction flip: ${existing.direction} → ${direction}`,
        existingSignal: existing,
      };
    }

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
   * Updates in-memory cache immediately, persists to DB asynchronously
   * DB persistence failures are logged but don't block signal recording
   */
  async record(
    symbol: string,
    style: TradingStyle,
    direction: 'long' | 'short',
    grade: Grade,
    strategyId: string,
    validUntil?: string
  ): Promise<void> {
    if (!this.initialized) {
      logger.warn('Cooldown record called before initialization - recording to memory only');
    }

    const key = this.makeKey(symbol, style, strategyId);
    const now = Date.now();

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
      strategyId,
      direction,
      grade,
      createdAt: now,
      expiresAt,
    };

    this.entries.set(key, entry);
    logger.debug(`Cooldown recorded: ${symbol} ${style} ${strategyId} ${direction} ${grade}`);

    await this.persistToDatabase(key, entry);
  }

  /**
   * Persist cooldown to database
   */
  private async persistToDatabase(key: string, entry: CooldownEntry): Promise<void> {
    if (!isDbAvailable()) return;

    try {
      const db = getDb();
      
      await db
        .insertInto('cooldowns')
        .values({
          cooldown_key: key,
          symbol: entry.symbol,
          style: entry.style,
          strategy_id: entry.strategyId,
          direction: entry.direction,
          grade: entry.grade,
          started_at: new Date(entry.createdAt).toISOString(),
          expires_at: new Date(entry.expiresAt).toISOString(),
        })
        .onConflict((oc) => oc
          .column('cooldown_key')
          .doUpdateSet({
            direction: entry.direction,
            grade: entry.grade,
            started_at: new Date(entry.createdAt).toISOString(),
            expires_at: new Date(entry.expiresAt).toISOString(),
          })
        )
        .execute();
        
      logger.debug(`Cooldown persisted to database: ${key}`);
    } catch (error) {
      logger.error('Failed to persist cooldown to database', { error, key });
    }
  }

  /**
   * Delete cooldown from database
   */
  private async deleteFromDatabase(key: string): Promise<void> {
    if (!isDbAvailable()) return;

    try {
      const db = getDb();
      await db
        .deleteFrom('cooldowns')
        .where('cooldown_key', '=', key)
        .execute();
    } catch (error) {
      logger.error('Failed to delete cooldown from database', { error, key });
    }
  }

  /**
   * Clear cooldown for a symbol and strategy
   * Updates in-memory cache immediately, DB deletion is async
   */
  async clear(symbol: string, style: TradingStyle, strategyId: string): Promise<void> {
    const key = this.makeKey(symbol, style, strategyId);
    this.entries.delete(key);
    
    if (this.initialized && !this.initializationFailed) {
      await this.deleteFromDatabase(key);
    }
    
    logger.debug(`Cooldown cleared: ${symbol} ${style} ${strategyId}`);
  }

  /**
   * Clear all cooldowns
   */
  async clearAll(): Promise<void> {
    this.entries.clear();
    
    if (isDbAvailable()) {
      try {
        const db = getDb();
        await db.deleteFrom('cooldowns').execute();
      } catch (error) {
        logger.error('Failed to clear cooldowns from database', { error });
      }
    }
    
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
   * Cleanup expired entries from memory and database
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    let removed = 0;
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < now) {
        this.entries.delete(key);
        keysToDelete.push(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired cooldown entries from memory`);
    }

    if (isDbAvailable() && keysToDelete.length > 0) {
      try {
        const db = getDb();
        const nowIso = new Date().toISOString();
        const result = await db
          .deleteFrom('cooldowns')
          .where('expires_at', '<', nowIso)
          .executeTakeFirst();
        
        const dbRemoved = Number(result.numDeletedRows ?? 0);
        if (dbRemoved > 0) {
          logger.debug(`Cleaned up ${dbRemoved} expired cooldown entries from database`);
        }
      } catch (error) {
        logger.error('Failed to cleanup expired cooldowns from database', { error });
      }
    }
  }

  /**
   * Shutdown - cleanup interval
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    logger.info('Signal cooldown service shutdown');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const signalCooldown = new SignalCooldownService();

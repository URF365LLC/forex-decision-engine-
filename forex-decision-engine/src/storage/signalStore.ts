/**
 * Signal Store
 * Hybrid storage: PostgreSQL when available, JSON file fallback
 */

import { Decision } from '../strategies/types.js';
import { createLogger } from '../services/logger.js';
import { getDb, isDbAvailable } from '../db/client.js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = createLogger('SignalStore');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAX_SIGNAL_ENTRIES = 5000;
const SIGNAL_ARCHIVE_DIR = path.join(__dirname, '../../data/archive');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SignalResult = 'win' | 'loss' | 'breakeven' | 'skipped' | null;

export interface StoredSignal {
  id: number;
  uuid?: string;  // Database UUID (used for DB storage)
  symbol: string;
  style: string;
  direction: string;
  grade: string;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_lots: number | null;
  risk_amount: number | null;
  reason: string;
  created_at: string;
  valid_until: string;
  result: SignalResult;
  result_notes: string | null;
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL STORE
// ═══════════════════════════════════════════════════════════════

class SignalStore {
  private signals: StoredSignal[] = [];
  private nextId: number = 1;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(__dirname, '../../data/signals.json');
    this.load();
  }
  
  private archiveOverflow(): void {
    if (this.signals.length <= MAX_SIGNAL_ENTRIES) return;
    
    const overflow = this.signals.length - MAX_SIGNAL_ENTRIES;
    const archiveSignals = this.signals.slice(0, overflow);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(SIGNAL_ARCHIVE_DIR, `signals-archive-${timestamp}.json`);
    
    try {
      if (!fs.existsSync(SIGNAL_ARCHIVE_DIR)) {
        fs.mkdirSync(SIGNAL_ARCHIVE_DIR, { recursive: true });
      }
      fs.writeFileSync(archiveFile, JSON.stringify({
        archivedAt: new Date().toISOString(),
        count: archiveSignals.length,
        signals: archiveSignals,
      }, null, 2));
      this.signals = this.signals.slice(overflow);
      logger.warn(`Archived ${archiveSignals.length} signals to control storage growth (${archiveFile})`);
    } catch (error) {
      logger.error('Failed to archive old signals', { error });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.signals = data.signals || [];
        this.nextId = data.nextId || 1;
        this.archiveOverflow();
        logger.info(`Loaded ${this.signals.length} signals from file`);
      }
    } catch (e) {
      logger.warn('Failed to load signals file, starting fresh');
      this.signals = [];
      this.nextId = 1;
    }
  }

  private persist(): void {
    const tempPath = `${this.filePath}.tmp`;
    try {
      this.archiveOverflow();
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tempPath, JSON.stringify({
        signals: this.signals,
        nextId: this.nextId,
      }, null, 2));
      fs.renameSync(tempPath, this.filePath);
    } catch (e) {
      logger.error('Failed to save signals', e);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }
  }

  /**
   * Save a decision to storage
   */
  async saveSignal(decision: Decision): Promise<string> {
    // V1.1: Use entry.price (new) or entryPrice (legacy fallback)
    const entryPrice = decision.entry?.price ?? decision.entryPrice ?? 0;
    const signalId = randomUUID();

    const signal: StoredSignal = {
      id: this.nextId++,
      uuid: signalId,
      symbol: decision.symbol,
      style: decision.style,
      direction: decision.direction,
      grade: decision.grade,
      entry_low: entryPrice || null,
      entry_high: entryPrice || null,
      stop_loss: decision.stopLoss?.price ?? null,
      take_profit: decision.takeProfit?.price ?? null,
      position_lots: decision.position?.lots ?? null,
      risk_amount: decision.position?.riskAmount ?? null,
      reason: decision.reason,
      created_at: decision.timestamp,
      valid_until: decision.validUntil,
      result: null,
      result_notes: null,
    };

    // Try database first
    if (isDbAvailable()) {
      try {
        const db = getDb();
        await db
          .insertInto('signals')
          .values({
            id: signalId,
            symbol: signal.symbol,
            strategy_id: decision.strategyId,
            strategy_name: decision.strategyName,
            grade: signal.grade,
            direction: signal.direction,
            entry_price: signal.entry_low,
            stop_loss: signal.stop_loss,
            take_profit: signal.take_profit,
            confidence: decision.confidence,
            reason: signal.reason,
            decision_data: JSON.stringify({
              style: signal.style,
              positionLots: signal.position_lots,
              riskAmount: signal.risk_amount,
              validUntil: signal.valid_until,
            }),
            source: 'manual',
          })
          .execute();

        logger.debug(`Saved signal ${signalId} to database for ${decision.symbol}`);
        return signalId;
      } catch (error) {
        logger.error('Failed to save signal to database, using file fallback', { error });
      }
    }

    // Fallback to file storage
    this.signals.push(signal);
    this.persist();

    logger.debug(`Saved signal ${signal.id} for ${decision.symbol}`);
    return signalId;
  }

  /**
   * Update result of a signal
   */
  updateResult(id: number, result: SignalResult, notes?: string): boolean {
    const signal = this.signals.find(s => s.id === id);
    if (!signal) return false;

    signal.result = result;
    signal.result_notes = notes ?? null;
    this.persist();
    return true;
  }

  /**
   * Get recent signals
   */
  async getRecent(limit: number = 50): Promise<StoredSignal[]> {
    // Try database first
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const rows = await db
          .selectFrom('signals')
          .selectAll()
          .orderBy('created_at', 'desc')
          .limit(limit)
          .execute();

        return rows.map(this.rowToStoredSignal);
      } catch (error) {
        logger.error('Failed to get recent signals from database', { error });
      }
    }

    // Fallback to file storage
    return this.signals
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  private rowToStoredSignal(row: Record<string, unknown>): StoredSignal {
    const decisionData = row.decision_data
      ? (typeof row.decision_data === 'string' ? JSON.parse(row.decision_data) : row.decision_data)
      : {};

    return {
      id: 0,  // DB uses UUID
      uuid: String(row.id),
      symbol: String(row.symbol),
      style: decisionData.style || '',
      direction: String(row.direction || ''),
      grade: String(row.grade),
      entry_low: row.entry_price ? Number(row.entry_price) : null,
      entry_high: row.entry_price ? Number(row.entry_price) : null,
      stop_loss: row.stop_loss ? Number(row.stop_loss) : null,
      take_profit: row.take_profit ? Number(row.take_profit) : null,
      position_lots: decisionData.positionLots ?? null,
      risk_amount: decisionData.riskAmount ?? null,
      reason: String(row.reason || ''),
      created_at: String(row.created_at),
      valid_until: decisionData.validUntil || '',
      result: null,  // TODO: Add result tracking to signals table
      result_notes: null,
    };
  }

  /**
   * Get signals by symbol
   */
  async getBySymbol(symbol: string, limit: number = 20): Promise<StoredSignal[]> {
    // Try database first
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const rows = await db
          .selectFrom('signals')
          .selectAll()
          .where('symbol', '=', symbol)
          .orderBy('created_at', 'desc')
          .limit(limit)
          .execute();

        return rows.map(this.rowToStoredSignal);
      } catch (error) {
        logger.error('Failed to get signals by symbol from database', { error });
      }
    }

    // Fallback to file storage
    return this.signals
      .filter(s => s.symbol === symbol)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  /**
   * Get signals by grade
   */
  async getByGrade(grade: string, limit: number = 50): Promise<StoredSignal[]> {
    // Try database first
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const rows = await db
          .selectFrom('signals')
          .selectAll()
          .where('grade', '=', grade)
          .orderBy('created_at', 'desc')
          .limit(limit)
          .execute();

        return rows.map(this.rowToStoredSignal);
      } catch (error) {
        logger.error('Failed to get signals by grade from database', { error });
      }
    }

    // Fallback to file storage
    return this.signals
      .filter(s => s.grade === grade)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  /**
   * Get signal statistics
   */
  async getStats(): Promise<{
    total: number;
    byGrade: Record<string, number>;
    byResult: Record<string, number>;
    winRate: number;
  }> {
    // Try database first
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const rows = await db
          .selectFrom('signals')
          .select(['grade'])
          .execute();

        const byGrade: Record<string, number> = {};
        for (const row of rows) {
          const grade = String(row.grade);
          byGrade[grade] = (byGrade[grade] || 0) + 1;
        }

        // TODO: Add result tracking to signals table for full stats
        return {
          total: rows.length,
          byGrade,
          byResult: {},
          winRate: 0,
        };
      } catch (error) {
        logger.error('Failed to get signal stats from database', { error });
      }
    }

    // Fallback to file storage
    const byGrade: Record<string, number> = {};
    const byResult: Record<string, number> = {};

    for (const signal of this.signals) {
      byGrade[signal.grade] = (byGrade[signal.grade] || 0) + 1;
      if (signal.result) {
        byResult[signal.result] = (byResult[signal.result] || 0) + 1;
      }
    }

    const wins = byResult['win'] || 0;
    const losses = byResult['loss'] || 0;
    const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;

    return {
      total: this.signals.length,
      byGrade,
      byResult,
      winRate,
    };
  }

  /**
   * Delete old signals
   */
  async cleanup(daysOld: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    // Try database first
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const result = await db
          .deleteFrom('signals')
          .where('created_at', '<', cutoff.toISOString())
          .executeTakeFirst();

        const removed = Number(result.numDeletedRows ?? 0);
        if (removed > 0) {
          logger.info(`Cleaned up ${removed} old signals from database`);
        }
        return removed;
      } catch (error) {
        logger.error('Failed to cleanup signals in database', { error });
      }
    }

    // Fallback to file storage
    const before = this.signals.length;
    this.signals = this.signals.filter(s =>
      new Date(s.created_at).getTime() > cutoff.getTime()
    );
    const removed = before - this.signals.length;
    if (removed > 0) {
      this.persist();
      logger.info(`Cleaned up ${removed} old signals`);
    }
    return removed;
  }

  /**
   * Close (save and cleanup)
   */
  close(): void {
    this.persist();
    logger.info('Signal store closed');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const signalStore = new SignalStore();

export { SignalStore };

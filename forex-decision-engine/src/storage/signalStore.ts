/**
 * Signal Store
 * In-memory signal storage (persists to JSON file)
 */

import { Decision } from '../strategies/types.js';
import { createLogger } from '../services/logger.js';
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
  saveSignal(decision: Decision): number {
    // V1.1: Use entry.price (new) or entryPrice (legacy fallback)
    const entryPrice = decision.entry?.price ?? decision.entryPrice ?? 0;
    
    const signal: StoredSignal = {
      id: this.nextId++,
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

    this.signals.push(signal);
    this.persist();

    logger.debug(`Saved signal ${signal.id} for ${decision.symbol}`);
    return signal.id;
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
  getRecent(limit: number = 50): StoredSignal[] {
    return this.signals
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  /**
   * Get signals by symbol
   */
  getBySymbol(symbol: string, limit: number = 20): StoredSignal[] {
    return this.signals
      .filter(s => s.symbol === symbol)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  /**
   * Get signals by grade
   */
  getByGrade(grade: string, limit: number = 50): StoredSignal[] {
    return this.signals
      .filter(s => s.grade === grade)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  /**
   * Get signal statistics
   */
  getStats(): {
    total: number;
    byGrade: Record<string, number>;
    byResult: Record<string, number>;
    winRate: number;
  } {
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
  cleanup(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const before = this.signals.length;
    this.signals = this.signals.filter(s => 
      new Date(s.created_at).getTime() > cutoff
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

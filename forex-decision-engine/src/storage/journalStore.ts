/**
 * Journal Store
 * Trading journal for tracking decisions and outcomes
 * Persists to JSON file with atomic writes
 */

import { createLogger } from '../services/logger.js';
import { getInstrumentSpec } from '../config/e8InstrumentSpecs.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = createLogger('JournalStore');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type TradeSource = 'signal' | 'manual';
export type TradeDirection = 'long' | 'short';
export type TradeStyle = 'intraday' | 'swing';
export type TradeType = 'pullback' | 'counter-trend' | 'liquidity-grab' | 'exhaustion' | 'other';
export type TradeStatus = 'pending' | 'running' | 'closed';
export type TradeAction = 'taken' | 'skipped' | 'missed';
export type TradeResult = 'win' | 'loss' | 'breakeven';

export interface TradeJournalEntry {
  id: string;
  
  source: TradeSource;
  signalId?: number;
  
  symbol: string;
  direction: TradeDirection;
  style: TradeStyle;
  grade?: string;
  
  // Strategy metadata (Phase 3)
  strategyId?: string;
  strategyName?: string;
  confidence?: number;
  reasonCodes?: string[];
  
  tradeType: TradeType;
  tradeTypeNote?: string;
  
  entryZoneLow?: number;
  entryZoneHigh?: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lots: number;
  
  status: TradeStatus;
  action: TradeAction;
  
  exitPrice?: number;
  result?: TradeResult;
  pnlPips?: number;
  pnlDollars?: number;
  rMultiple?: number;
  
  notes?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface JournalFilters {
  symbol?: string;
  status?: TradeStatus;
  result?: TradeResult;
  action?: TradeAction;
  tradeType?: TradeType;
  dateFrom?: string;
  dateTo?: string;
}

export interface JournalStats {
  totalTaken: number;
  totalSkipped: number;
  totalMissed: number;
  totalClosed: number;
  totalRunning: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgR: number;
  totalPnlPips: number;
  totalPnlDollars: number;
  byType: Record<string, { taken: number; wins: number; winRate: number }>;
}

// ═══════════════════════════════════════════════════════════════
// JOURNAL STORE
// ═══════════════════════════════════════════════════════════════

class JournalStore {
  private entries: TradeJournalEntry[] = [];
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(__dirname, '../../data/journal.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.entries = data.entries || [];
        logger.info(`Loaded ${this.entries.length} journal entries from file`);
      }
    } catch (e) {
      logger.warn('Failed to load journal file, starting fresh');
      this.entries = [];
    }
  }

  private persist(): void {
    const tempPath = `${this.filePath}.tmp`;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tempPath, JSON.stringify({
        entries: this.entries,
      }, null, 2));
      fs.renameSync(tempPath, this.filePath);
    } catch (e) {
      logger.error('Failed to save journal', e);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Add a new journal entry
   */
  add(entry: Omit<TradeJournalEntry, 'id' | 'createdAt' | 'updatedAt'>): TradeJournalEntry {
    const now = new Date().toISOString();
    const newEntry: TradeJournalEntry = {
      ...entry,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    this.entries.push(newEntry);
    this.persist();

    logger.info(`Added journal entry ${newEntry.id} for ${entry.symbol} (${entry.action})`);
    return newEntry;
  }

  /**
   * Update an existing entry
   */
  update(id: string, updates: Partial<TradeJournalEntry>): TradeJournalEntry | null {
    const index = this.entries.findIndex(e => e.id === id);
    if (index === -1) return null;

    const entry = this.entries[index];
    
    const updatedEntry: TradeJournalEntry = {
      ...entry,
      ...updates,
      id: entry.id,
      createdAt: entry.createdAt,
      updatedAt: new Date().toISOString(),
    };

    if (updates.status === 'closed' && !entry.closedAt) {
      updatedEntry.closedAt = new Date().toISOString();
    }

    this.entries[index] = updatedEntry;
    this.persist();

    logger.info(`Updated journal entry ${id}`);
    return updatedEntry;
  }

  /**
   * Get single entry by ID
   */
  get(id: string): TradeJournalEntry | null {
    return this.entries.find(e => e.id === id) || null;
  }

  /**
   * Get all entries with optional filters
   */
  getAll(filters?: JournalFilters): TradeJournalEntry[] {
    let result = [...this.entries];

    if (filters) {
      if (filters.symbol) {
        result = result.filter(e => e.symbol === filters.symbol);
      }
      if (filters.status) {
        result = result.filter(e => e.status === filters.status);
      }
      if (filters.result) {
        result = result.filter(e => e.result === filters.result);
      }
      if (filters.action) {
        result = result.filter(e => e.action === filters.action);
      }
      if (filters.tradeType) {
        result = result.filter(e => e.tradeType === filters.tradeType);
      }
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom).getTime();
        result = result.filter(e => new Date(e.createdAt).getTime() >= from);
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo).getTime();
        result = result.filter(e => new Date(e.createdAt).getTime() <= to);
      }
    }

    return result.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Delete an entry
   */
  delete(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.entries.splice(index, 1);
    this.persist();

    logger.info(`Deleted journal entry ${id}`);
    return true;
  }

  /**
   * Calculate P&L for an entry
   * 
   * Forex: P&L = pips × pipValuePerLot × lots
   *   - Standard lot = 100,000 units, pip value = $10 (or $1000 for JPY)
   * Crypto: P&L = price_move × lots (direct units)
   *   - Lots = actual units (e.g., 0.1 BTC)
   */
  calculatePnL(entry: TradeJournalEntry): { pnlPips: number; rMultiple: number; pnlDollars: number } | null {
    if (!entry.exitPrice || entry.status !== 'closed') return null;

    const spec = getInstrumentSpec(entry.symbol);
    const pipValue = spec?.pipValue ?? 10;
    const pipSize = spec?.pipSize ?? Math.pow(10, -((spec?.digits as number | undefined) ?? 4));
    const assetClass = spec?.type || 'forex';
    
    const directionMultiplier = entry.direction === 'long' ? 1 : -1;
    const priceMove = (entry.exitPrice - entry.entryPrice) * directionMultiplier;
    const pnlPips = priceMove / pipSize;
    
    const riskDistance = Math.abs(entry.entryPrice - entry.stopLoss);
    const riskPips = riskDistance / pipSize;
    const rMultiple = riskPips > 0 ? pnlPips / riskPips : 0;
    
    let pnlDollars: number;
    if (assetClass === 'crypto') {
      const contractSize = spec?.contractSize ?? 1;
      pnlDollars = priceMove * contractSize * entry.lots;
    } else {
      pnlDollars = pnlPips * pipValue * entry.lots;
    }

    return {
      pnlPips: Math.round(pnlPips * 10) / 10,
      rMultiple: Math.round(rMultiple * 100) / 100,
      pnlDollars: Math.round(pnlDollars * 100) / 100,
    };
  }

  /**
   * Get aggregated statistics
   */
  getStats(dateFrom?: string, dateTo?: string): JournalStats {
    let entries = this.entries;

    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      entries = entries.filter(e => new Date(e.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime();
      entries = entries.filter(e => new Date(e.createdAt).getTime() <= to);
    }

    const taken = entries.filter(e => e.action === 'taken');
    const skipped = entries.filter(e => e.action === 'skipped');
    const missed = entries.filter(e => e.action === 'missed');
    
    const closed = taken.filter(e => e.status === 'closed');
    const running = taken.filter(e => e.status === 'running');
    
    const wins = closed.filter(e => e.result === 'win');
    const losses = closed.filter(e => e.result === 'loss');
    const breakeven = closed.filter(e => e.result === 'breakeven');

    const winRate = wins.length + losses.length > 0 
      ? (wins.length / (wins.length + losses.length)) * 100 
      : 0;

    const closedWithR = closed.filter(e => typeof e.rMultiple === 'number');
    const avgR = closedWithR.length > 0
      ? closedWithR.reduce((sum, e) => sum + (e.rMultiple || 0), 0) / closedWithR.length
      : 0;

    const totalPnlPips = closed.reduce((sum, e) => sum + (e.pnlPips || 0), 0);
    const totalPnlDollars = closed.reduce((sum, e) => sum + (e.pnlDollars || 0), 0);

    const byType: Record<string, { taken: number; wins: number; winRate: number }> = {};
    const types: TradeType[] = ['pullback', 'counter-trend', 'liquidity-grab', 'exhaustion', 'other'];
    
    for (const type of types) {
      const typeTaken = taken.filter(e => e.tradeType === type);
      const typeClosed = typeTaken.filter(e => e.status === 'closed');
      const typeWins = typeClosed.filter(e => e.result === 'win');
      const typeLosses = typeClosed.filter(e => e.result === 'loss');
      
      byType[type] = {
        taken: typeTaken.length,
        wins: typeWins.length,
        winRate: typeWins.length + typeLosses.length > 0
          ? (typeWins.length / (typeWins.length + typeLosses.length)) * 100
          : 0,
      };
    }

    return {
      totalTaken: taken.length,
      totalSkipped: skipped.length,
      totalMissed: missed.length,
      totalClosed: closed.length,
      totalRunning: running.length,
      wins: wins.length,
      losses: losses.length,
      breakeven: breakeven.length,
      winRate: Math.round(winRate * 10) / 10,
      avgR: Math.round(avgR * 100) / 100,
      totalPnlPips: Math.round(totalPnlPips * 10) / 10,
      totalPnlDollars: Math.round(totalPnlDollars * 100) / 100,
      byType,
    };
  }

  /**
   * Export entries as CSV
   */
  exportCSV(filters?: JournalFilters): string {
    const entries = this.getAll(filters);
    
    const headers = [
      'Date',
      'Symbol',
      'Direction',
      'Type',
      'Grade',
      'Entry',
      'Exit',
      'SL',
      'TP',
      'Lots',
      'Status',
      'Action',
      'Result',
      'PnL Pips',
      'PnL $',
      'R-Multiple',
      'Notes',
    ];

    const rows = entries.map(e => [
      new Date(e.createdAt).toISOString().split('T')[0],
      e.symbol,
      e.direction.toUpperCase(),
      e.tradeType,
      e.grade || '',
      e.entryPrice,
      e.exitPrice || '',
      e.stopLoss,
      e.takeProfit,
      e.lots,
      e.status,
      e.action,
      e.result || '',
      e.pnlPips || '',
      e.pnlDollars || '',
      e.rMultiple || '',
      `"${(e.notes || '').replace(/"/g, '""')}"`,
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');
  }

  /**
   * Close store (persist on shutdown)
   */
  close(): void {
    this.persist();
    logger.info('Journal store closed');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const journalStore = new JournalStore();

export { JournalStore };

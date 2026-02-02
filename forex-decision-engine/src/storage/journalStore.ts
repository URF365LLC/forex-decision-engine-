/**
 * Journal Store
 * Hybrid storage: PostgreSQL when available, JSON file fallback
 */

import { createLogger } from '../services/logger.js';
import { getInstrumentSpec } from '../config/e8InstrumentSpecs.js';
import { getDb, isDbAvailable } from '../db/client.js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = createLogger('JournalStore');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_JOURNAL_ENTRIES = 3000;
const JOURNAL_ARCHIVE_DIR = path.join(__dirname, '../../data/archive');

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
  
  mfePrice?: number;
  maePrice?: number;
  mfePips?: number;
  maePips?: number;
  mfeTimestamp?: string;
  distanceToTpAtMfe?: number;
  
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
  avgMfePips: number;
  avgMaePips: number;
  avgDistanceToTpAtMfe: number;
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
  
  private getPipSize(symbol: string): number {
    const spec = getInstrumentSpec(symbol);
    const decimals = spec?.digits ?? 4;
    return Math.pow(10, -decimals);
  }
  
  private recalcExcursions(entry: TradeJournalEntry): TradeJournalEntry {
    const pipSize = this.getPipSize(entry.symbol);
    const directionFactor = entry.direction === 'long' ? 1 : -1;
    const entryPrice = entry.entryPrice;
    const hasTakeProfit = typeof entry.takeProfit === 'number' && Number.isFinite(entry.takeProfit);
    const updatedEntry = { ...entry };
    
    if (typeof entry.mfePrice === 'number' && Number.isFinite(entry.mfePrice)) {
      const mfePips = ((entry.mfePrice - entryPrice) * directionFactor) / pipSize;
      updatedEntry.mfePips = Math.round(mfePips * 10) / 10;
      if (hasTakeProfit) {
        const distance = (((entry.takeProfit as number) - entry.mfePrice) * directionFactor) / pipSize;
        updatedEntry.distanceToTpAtMfe = Math.round(Math.max(0, distance) * 10) / 10;
      }
    }
    
    if (typeof entry.maePrice === 'number' && Number.isFinite(entry.maePrice)) {
      const maePips = ((entry.maePrice - entryPrice) * directionFactor) / pipSize;
      updatedEntry.maePips = Math.round(maePips * 10) / 10;
    }
    
    return updatedEntry;
  }
  
  private mergeAndNormalize(entry: TradeJournalEntry, updates: Partial<TradeJournalEntry>): TradeJournalEntry {
    const merged: TradeJournalEntry = {
      ...entry,
      ...updates,
      id: entry.id,
      createdAt: entry.createdAt,
      updatedAt: new Date().toISOString(),
    };
    
    if (updates.status === 'closed' && !entry.closedAt) {
      merged.closedAt = new Date().toISOString();
    }
    
    return this.recalcExcursions(merged);
  }
  
  private async archiveOverflow(): Promise<void> {
    if (this.entries.length <= MAX_JOURNAL_ENTRIES) return;

    const overflow = this.entries.length - MAX_JOURNAL_ENTRIES;
    const archiveEntries = this.entries.slice(0, overflow);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(JOURNAL_ARCHIVE_DIR, `journal-archive-${timestamp}.json`);

    try {
      await fsPromises.mkdir(JOURNAL_ARCHIVE_DIR, { recursive: true });
      await fsPromises.writeFile(archiveFile, JSON.stringify({
        archivedAt: new Date().toISOString(),
        count: archiveEntries.length,
        entries: archiveEntries,
      }, null, 2));
      this.entries = this.entries.slice(overflow);
      logger.warn(`Archived ${archiveEntries.length} journal entries to cap file growth (${archiveFile})`);
    } catch (error) {
      logger.error('Failed to archive old journal entries', { error });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.entries = (data.entries || []).map((entry: TradeJournalEntry) => this.recalcExcursions(entry));
        this.archiveOverflow();
        logger.info(`Loaded ${this.entries.length} journal entries from file`);
      }
    } catch (e) {
      logger.warn('Failed to load journal file, starting fresh');
      this.entries = [];
    }
  }

  private async persist(): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;
    try {
      await this.archiveOverflow();
      const dir = path.dirname(this.filePath);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(tempPath, JSON.stringify({
        entries: this.entries,
      }, null, 2));
      await fsPromises.rename(tempPath, this.filePath);
    } catch (e) {
      logger.error('Failed to save journal', e);
      try {
        await fsPromises.unlink(tempPath);
      } catch { /* ignore cleanup errors */ }
    }
  }

  private parseExtras(rawExtras: unknown): Record<string, unknown> {
    if (!rawExtras) return {};
    if (typeof rawExtras === 'string') {
      try { return JSON.parse(rawExtras); } catch { return {}; }
    }
    if (typeof rawExtras === 'object') return rawExtras as Record<string, unknown>;
    return {};
  }

  private rowToJournalEntry(row: Record<string, unknown>): TradeJournalEntry {
    const extras = this.parseExtras(row.extras);

    return {
      id: String(row.id),
      source: (extras.source as TradeSource) || 'manual',
      signalId: typeof extras.signalId === 'number' ? extras.signalId : undefined,
      symbol: String(row.symbol),
      direction: (row.direction as TradeDirection) || 'long',
      style: (row.style as TradeStyle) || 'intraday',
      grade: row.grade ? String(row.grade) : undefined,
      strategyId: row.strategy_id ? String(row.strategy_id) : undefined,
      strategyName: row.strategy_name ? String(row.strategy_name) : undefined,
      confidence: extras.confidence as number | undefined,
      reasonCodes: Array.isArray(extras.reasonCodes) ? extras.reasonCodes : undefined,
      tradeType: (row.trade_type as TradeType) || 'other',
      tradeTypeNote: extras.tradeTypeNote as string | undefined,
      entryZoneLow: extras.entryZoneLow as number | undefined,
      entryZoneHigh: extras.entryZoneHigh as number | undefined,
      entryPrice: Number(row.entry_price || 0),
      stopLoss: Number(row.stop_loss || 0),
      takeProfit: Number(row.take_profit || 0),
      lots: Number(row.lot_size || 0),
      mfePrice: row.mfe_price ? Number(row.mfe_price) : undefined,
      maePrice: row.mae_price ? Number(row.mae_price) : undefined,
      mfePips: row.mfe_pips ? Number(row.mfe_pips) : undefined,
      maePips: row.mae_pips ? Number(row.mae_pips) : undefined,
      mfeTimestamp: row.mfe_timestamp ? String(row.mfe_timestamp) : undefined,
      distanceToTpAtMfe: row.distance_to_tp_at_mfe ? Number(row.distance_to_tp_at_mfe) : undefined,
      status: (row.status as TradeStatus) || 'pending',
      action: (row.action as TradeAction) || 'taken',
      exitPrice: row.exit_price ? Number(row.exit_price) : undefined,
      result: row.outcome as TradeResult | undefined,
      pnlPips: row.pnl_pips ? Number(row.pnl_pips) : undefined,
      pnlDollars: row.pnl_usd ? Number(row.pnl_usd) : undefined,
      rMultiple: row.r_multiple ? Number(row.r_multiple) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      closedAt: row.closed_at ? String(row.closed_at) : undefined,
    };
  }

  /**
   * Add a new journal entry
   */
  async add(entry: Omit<TradeJournalEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<TradeJournalEntry> {
    const now = new Date().toISOString();
    const entryId = randomUUID();
    const newEntry: TradeJournalEntry = {
      ...entry,
      id: entryId,
      createdAt: now,
      updatedAt: now,
    };

    const normalized = this.recalcExcursions(newEntry);

    if (isDbAvailable()) {
      try {
        const db = getDb();
        const extras = {
          source: normalized.source,
          signalId: normalized.signalId,
          confidence: normalized.confidence,
          reasonCodes: normalized.reasonCodes,
          tradeTypeNote: normalized.tradeTypeNote,
          entryZoneLow: normalized.entryZoneLow,
          entryZoneHigh: normalized.entryZoneHigh,
        };

        await db
          .insertInto('journal_entries')
          .values({
            id: entryId,
            symbol: normalized.symbol,
            strategy_id: normalized.strategyId ?? null,
            strategy_name: normalized.strategyName ?? null,
            direction: normalized.direction,
            style: normalized.style,
            grade: normalized.grade ?? null,
            trade_type: normalized.tradeType,
            action: normalized.action,
            entry_price: normalized.entryPrice,
            exit_price: normalized.exitPrice ?? null,
            stop_loss: normalized.stopLoss,
            take_profit: normalized.takeProfit,
            lot_size: normalized.lots,
            status: normalized.status,
            outcome: normalized.result ?? null,
            pnl_pips: normalized.pnlPips ?? null,
            pnl_usd: normalized.pnlDollars ?? null,
            r_multiple: normalized.rMultiple ?? null,
            mfe_price: normalized.mfePrice ?? null,
            mae_price: normalized.maePrice ?? null,
            mfe_pips: normalized.mfePips ?? null,
            mae_pips: normalized.maePips ?? null,
            distance_to_tp_at_mfe: normalized.distanceToTpAtMfe ?? null,
            mfe_timestamp: normalized.mfeTimestamp ?? null,
            extras: JSON.stringify(extras),
            notes: normalized.notes ?? null,
            opened_at: normalized.createdAt,
            closed_at: normalized.closedAt ?? null,
          })
          .execute();

        logger.info(`Added journal entry ${entryId} to database for ${entry.symbol} (${entry.action})`);
        return normalized;
      } catch (error) {
        logger.error('Failed to add journal entry to database, using file fallback', { error });
      }
    }

    this.entries.push(normalized);
    await this.persist();

    logger.info(`Added journal entry ${normalized.id} for ${entry.symbol} (${entry.action})`);
    return normalized;
  }

  /**
   * Update an existing entry
   */
  async update(id: string, updates: Partial<TradeJournalEntry>): Promise<TradeJournalEntry | null> {
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const now = new Date().toISOString();

        const dbUpdates: Record<string, unknown> = { updated_at: now };
        if (updates.exitPrice !== undefined) dbUpdates.exit_price = updates.exitPrice;
        if (updates.status) dbUpdates.status = updates.status;
        if (updates.result) dbUpdates.outcome = updates.result;
        if (updates.pnlPips !== undefined) dbUpdates.pnl_pips = updates.pnlPips;
        if (updates.pnlDollars !== undefined) dbUpdates.pnl_usd = updates.pnlDollars;
        if (updates.rMultiple !== undefined) dbUpdates.r_multiple = updates.rMultiple;
        if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
        if (updates.closedAt) dbUpdates.closed_at = updates.closedAt;
        if (updates.mfePrice !== undefined) dbUpdates.mfe_price = updates.mfePrice;
        if (updates.maePrice !== undefined) dbUpdates.mae_price = updates.maePrice;
        if (updates.mfePips !== undefined) dbUpdates.mfe_pips = updates.mfePips;
        if (updates.maePips !== undefined) dbUpdates.mae_pips = updates.maePips;
        if (updates.mfeTimestamp !== undefined) dbUpdates.mfe_timestamp = updates.mfeTimestamp;
        if (updates.distanceToTpAtMfe !== undefined) dbUpdates.distance_to_tp_at_mfe = updates.distanceToTpAtMfe;

        await db
          .updateTable('journal_entries')
          .set(dbUpdates)
          .where('id', '=', id)
          .execute();

        logger.info(`Updated journal entry ${id} in database`);
        return this.get(id);
      } catch (error) {
        logger.error('Failed to update journal entry in database', { error });
      }
    }

    const index = this.entries.findIndex(e => e.id === id);
    if (index === -1) return null;

    const entry = this.entries[index];
    const updatedEntry = this.mergeAndNormalize(entry, updates);

    this.entries[index] = updatedEntry;
    await this.persist();

    logger.info(`Updated journal entry ${id}`);
    return updatedEntry;
  }

  /**
   * Get single entry by ID
   */
  async get(id: string): Promise<TradeJournalEntry | null> {
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const row = await db
          .selectFrom('journal_entries')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();

        if (row) {
          return this.rowToJournalEntry(row as Record<string, unknown>);
        }
      } catch (error) {
        logger.error('Failed to get journal entry from database', { error });
      }
    }

    return this.entries.find(e => e.id === id) || null;
  }

  /**
   * Get all entries with optional filters
   */
  async getAll(filters?: JournalFilters): Promise<TradeJournalEntry[]> {
    if (isDbAvailable()) {
      try {
        const db = getDb();
        let query = db
          .selectFrom('journal_entries')
          .selectAll()
          .orderBy('created_at', 'desc')
          .limit(1000);

        if (filters?.symbol) {
          query = query.where('symbol', '=', filters.symbol);
        }
        if (filters?.status) {
          query = query.where('status', '=', filters.status);
        }
        if (filters?.result) {
          query = query.where('outcome', '=', filters.result);
        }
        if (filters?.dateFrom) {
          query = query.where('created_at', '>=', filters.dateFrom);
        }
        if (filters?.dateTo) {
          query = query.where('created_at', '<=', filters.dateTo);
        }

        const rows = await query.execute();
        return rows.map(row => this.rowToJournalEntry(row as Record<string, unknown>));
      } catch (error) {
        logger.error('Failed to get journal entries from database', { error });
      }
    }

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
  async delete(id: string): Promise<boolean> {
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const result = await db
          .deleteFrom('journal_entries')
          .where('id', '=', id)
          .executeTakeFirst();

        const deleted = (result.numDeletedRows ?? 0) > 0;
        if (deleted) {
          logger.info(`Deleted journal entry ${id} from database`);
        }
        return deleted;
      } catch (error) {
        logger.error('Failed to delete journal entry from database', { error });
      }
    }

    const index = this.entries.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.entries.splice(index, 1);
    await this.persist();

    logger.info(`Deleted journal entry ${id}`);
    return true;
  }

  /**
   * Find active (running/pending) trades by symbol and direction
   * Used for dedupe awareness between manual and auto scan
   */
  async findActiveBySymbolDirection(
    symbol: string,
    direction: string,
    statuses: TradeStatus[] = ['running', 'pending']
  ): Promise<TradeJournalEntry[]> {
    if (isDbAvailable()) {
      try {
        const db = getDb();
        const rows = await db
          .selectFrom('journal_entries')
          .selectAll()
          .where('symbol', '=', symbol)
          .where('direction', '=', direction)
          .where('status', 'in', statuses)
          .orderBy('created_at', 'desc')
          .limit(10)
          .execute();

        return rows.map(row => this.rowToJournalEntry(row as Record<string, unknown>));
      } catch (error) {
        logger.error('Failed to find active trades from database', { error });
      }
    }

    // Fallback to in-memory
    return this.entries.filter(e =>
      e.symbol === symbol &&
      e.direction === direction &&
      statuses.includes(e.status)
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
  }

  /**
   * Calculate P&L for an entry
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
  async getStats(dateFrom?: string, dateTo?: string): Promise<JournalStats> {
    let entries = await this.getAll();

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
    
    const mfeSamples = closed.filter(e => typeof e.mfePips === 'number');
    const maeSamples = closed.filter(e => typeof e.maePips === 'number');
    const distanceSamples = closed.filter(e => typeof e.distanceToTpAtMfe === 'number');
    
    const avgMfePips = mfeSamples.length > 0
      ? mfeSamples.reduce((sum, e) => sum + (e.mfePips || 0), 0) / mfeSamples.length
      : 0;
    const avgMaePips = maeSamples.length > 0
      ? maeSamples.reduce((sum, e) => sum + (e.maePips || 0), 0) / maeSamples.length
      : 0;
    const avgDistanceToTpAtMfe = distanceSamples.length > 0
      ? distanceSamples.reduce((sum, e) => sum + (e.distanceToTpAtMfe || 0), 0) / distanceSamples.length
      : 0;

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
      avgMfePips: Math.round(avgMfePips * 10) / 10,
      avgMaePips: Math.round(avgMaePips * 10) / 10,
      avgDistanceToTpAtMfe: Math.round(avgDistanceToTpAtMfe * 10) / 10,
    };
  }

  /**
   * Export entries as CSV
   */
  async exportCSV(filters?: JournalFilters): Promise<string> {
    const entries = await this.getAll(filters);
    
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
      'MFE (pips)',
      'MAE (pips)',
      'MFE Time',
      'Dist to TP @ MFE',
      'Notes',
    ];

    const rows = entries.map((e: TradeJournalEntry) => [
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
      e.mfePips || '',
      e.maePips || '',
      e.mfeTimestamp || '',
      e.distanceToTpAtMfe || '',
      `"${(e.notes || '').replace(/"/g, '""')}"`,
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');
  }

  /**
   * Synchronous persist for shutdown - blocks but ensures data is saved
   */
  private persistSync(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({
        entries: this.entries,
        nextId: this.nextId,
      }, null, 2));
      fs.renameSync(tempPath, this.filePath);
      logger.debug('Journal persisted to file synchronously on shutdown');
    } catch (e) {
      logger.error('Failed to save journal on shutdown', e);
    }
  }

  /**
   * Close store (persist on shutdown)
   * Uses sync persist to ensure data is written before process exits
   */
  close(): void {
    this.persistSync();
    logger.info('Journal store closed');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const journalStore = new JournalStore();

export { JournalStore };

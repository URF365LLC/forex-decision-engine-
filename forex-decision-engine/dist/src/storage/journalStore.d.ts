/**
 * Journal Store
 * Trading journal for tracking decisions and outcomes
 * Persists to JSON file with atomic writes
 */
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
    byType: Record<string, {
        taken: number;
        wins: number;
        winRate: number;
    }>;
}
declare class JournalStore {
    private entries;
    private filePath;
    constructor(filePath?: string);
    private load;
    private persist;
    private generateId;
    /**
     * Add a new journal entry
     */
    add(entry: Omit<TradeJournalEntry, 'id' | 'createdAt' | 'updatedAt'>): TradeJournalEntry;
    /**
     * Update an existing entry
     */
    update(id: string, updates: Partial<TradeJournalEntry>): TradeJournalEntry | null;
    /**
     * Get single entry by ID
     */
    get(id: string): TradeJournalEntry | null;
    /**
     * Get all entries with optional filters
     */
    getAll(filters?: JournalFilters): TradeJournalEntry[];
    /**
     * Delete an entry
     */
    delete(id: string): boolean;
    /**
     * Calculate P&L for an entry
     *
     * Forex: P&L = pips × pipValuePerLot × lots
     *   - Standard lot = 100,000 units, pip value = $10 (or $1000 for JPY)
     * Crypto: P&L = price_move × lots (direct units)
     *   - Lots = actual units (e.g., 0.1 BTC)
     */
    calculatePnL(entry: TradeJournalEntry): {
        pnlPips: number;
        rMultiple: number;
        pnlDollars: number;
    } | null;
    /**
     * Get aggregated statistics
     */
    getStats(dateFrom?: string, dateTo?: string): JournalStats;
    /**
     * Export entries as CSV
     */
    exportCSV(filters?: JournalFilters): string;
    /**
     * Close store (persist on shutdown)
     */
    close(): void;
}
export declare const journalStore: JournalStore;
export { JournalStore };

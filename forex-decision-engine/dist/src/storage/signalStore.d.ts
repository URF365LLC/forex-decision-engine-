/**
 * Signal Store
 * In-memory signal storage (persists to JSON file)
 */
import { Decision } from '../engine/decisionEngine.js';
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
declare class SignalStore {
    private signals;
    private nextId;
    private filePath;
    constructor(filePath?: string);
    private load;
    private persist;
    /**
     * Save a decision to storage
     */
    saveSignal(decision: Decision): number;
    /**
     * Update result of a signal
     */
    updateResult(id: number, result: SignalResult, notes?: string): boolean;
    /**
     * Get recent signals
     */
    getRecent(limit?: number): StoredSignal[];
    /**
     * Get signals by symbol
     */
    getBySymbol(symbol: string, limit?: number): StoredSignal[];
    /**
     * Get signals by grade
     */
    getByGrade(grade: string, limit?: number): StoredSignal[];
    /**
     * Get signal statistics
     */
    getStats(): {
        total: number;
        byGrade: Record<string, number>;
        byResult: Record<string, number>;
        winRate: number;
    };
    /**
     * Delete old signals
     */
    cleanup(daysOld?: number): number;
    /**
     * Close (save and cleanup)
     */
    close(): void;
}
export declare const signalStore: SignalStore;
export { SignalStore };

/**
 * Signal Store
 * In-memory signal storage (persists to JSON file)
 */
import { createLogger } from '../services/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const logger = createLogger('SignalStore');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ═══════════════════════════════════════════════════════════════
// SIGNAL STORE
// ═══════════════════════════════════════════════════════════════
class SignalStore {
    signals = [];
    nextId = 1;
    filePath;
    constructor(filePath) {
        this.filePath = filePath || path.join(__dirname, '../../data/signals.json');
        this.load();
    }
    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
                this.signals = data.signals || [];
                this.nextId = data.nextId || 1;
                logger.info(`Loaded ${this.signals.length} signals from file`);
            }
        }
        catch (e) {
            logger.warn('Failed to load signals file, starting fresh');
            this.signals = [];
            this.nextId = 1;
        }
    }
    persist() {
        const tempPath = `${this.filePath}.tmp`;
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(tempPath, JSON.stringify({
                signals: this.signals,
                nextId: this.nextId,
            }, null, 2));
            fs.renameSync(tempPath, this.filePath);
        }
        catch (e) {
            logger.error('Failed to save signals', e);
            if (fs.existsSync(tempPath)) {
                try {
                    fs.unlinkSync(tempPath);
                }
                catch { }
            }
        }
    }
    /**
     * Save a decision to storage
     */
    saveSignal(decision) {
        const signal = {
            id: this.nextId++,
            symbol: decision.symbol,
            style: decision.style,
            direction: decision.direction,
            grade: decision.grade,
            entry_low: decision.entryZone?.low ?? null,
            entry_high: decision.entryZone?.high ?? null,
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
    updateResult(id, result, notes) {
        const signal = this.signals.find(s => s.id === id);
        if (!signal)
            return false;
        signal.result = result;
        signal.result_notes = notes ?? null;
        this.persist();
        return true;
    }
    /**
     * Get recent signals
     */
    getRecent(limit = 50) {
        return this.signals
            .slice()
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit);
    }
    /**
     * Get signals by symbol
     */
    getBySymbol(symbol, limit = 20) {
        return this.signals
            .filter(s => s.symbol === symbol)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit);
    }
    /**
     * Get signals by grade
     */
    getByGrade(grade, limit = 50) {
        return this.signals
            .filter(s => s.grade === grade)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit);
    }
    /**
     * Get signal statistics
     */
    getStats() {
        const byGrade = {};
        const byResult = {};
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
    cleanup(daysOld = 30) {
        const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
        const before = this.signals.length;
        this.signals = this.signals.filter(s => new Date(s.created_at).getTime() > cutoff);
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
    close() {
        this.persist();
        logger.info('Signal store closed');
    }
}
// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════
export const signalStore = new SignalStore();
export { SignalStore };
//# sourceMappingURL=signalStore.js.map
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
export declare const COOLDOWN_CONFIG: {
    intraday: number;
    swing: number;
    gradeRank: Record<Grade, number>;
};
declare class SignalCooldownService {
    private entries;
    constructor();
    /**
     * Generate unique key for signal
     */
    private makeKey;
    /**
     * Check if a new signal is allowed
     */
    check(symbol: string, style: TradingStyle, direction: 'long' | 'short' | 'none', grade: Grade): CooldownCheck;
    /**
     * Record a new signal (starts cooldown)
     */
    record(symbol: string, style: TradingStyle, direction: 'long' | 'short', grade: Grade, validUntil?: string): void;
    /**
     * Clear cooldown for a symbol
     */
    clear(symbol: string, style: TradingStyle): void;
    /**
     * Clear all cooldowns
     */
    clearAll(): void;
    /**
     * Get active cooldowns
     */
    getActive(): CooldownEntry[];
    /**
     * Cleanup expired entries
     */
    private cleanup;
}
export declare const signalCooldown: SignalCooldownService;
export {};

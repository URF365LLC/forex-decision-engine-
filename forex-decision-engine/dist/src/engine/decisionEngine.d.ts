/**
 * Decision Engine
 * Main orchestrator that combines all analysis into a final decision
 *
 * Includes:
 * - Signal Cooldown (prevents duplicate signals)
 * - Volatility Gating (filters extreme conditions)
 */
import { TradingStyle } from '../config/strategy.js';
import { TrendAnalysis } from './trendFilter.js';
import { EntryAnalysis } from './entryTrigger.js';
import { PositionSize } from './positionSizer.js';
import { Grade, GradeResult } from './grader.js';
import { CooldownCheck } from '../services/signalCooldown.js';
import { VolatilityCheck, VolatilityLevel } from '../services/volatilityGate.js';
export type Direction = 'long' | 'short' | 'none';
export interface Decision {
    symbol: string;
    displayName: string;
    style: TradingStyle;
    direction: Direction;
    grade: Grade;
    status: 'ready' | 'building' | 'invalid' | 'cooldown' | 'volatility-blocked';
    entryZone: {
        low: number;
        high: number;
        formatted: string;
    } | null;
    stopLoss: {
        price: number;
        pips: number;
        method: 'swing' | 'atr';
        formatted: string;
    } | null;
    takeProfit: {
        price: number;
        pips: number;
        riskReward: number;
        formatted: string;
    } | null;
    position: PositionSize | null;
    reason: string;
    details: {
        trend: TrendAnalysis;
        entry: EntryAnalysis;
        grade: GradeResult;
        volatility?: VolatilityCheck;
        cooldown?: CooldownCheck;
    };
    timestamp: string;
    validUntil: string;
    validCandles: number;
    timeframes: {
        trend: string;
        entry: string;
    };
    gating: {
        cooldownBlocked: boolean;
        volatilityBlocked: boolean;
        volatilityLevel: VolatilityLevel;
    };
    errors: string[];
}
export interface UserSettings {
    accountSize: number;
    riskPercent: number;
    style: TradingStyle;
    timezone?: string;
}
export declare function analyzeSymbol(symbol: string, settings: UserSettings, options?: {
    skipCooldown?: boolean;
}): Promise<Decision>;
export interface ScanProgress {
    total: number;
    completed: number;
    current: string | null;
    results: Decision[];
    errors: string[];
}
export declare function scanSymbols(symbols: string[], settings: UserSettings, onProgress?: (progress: ScanProgress) => void): Promise<Decision[]>;
/**
 * Format decision for display (one-liner)
 */
export declare function formatDecisionSummary(decision: Decision): string;

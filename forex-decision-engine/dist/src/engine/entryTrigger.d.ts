/**
 * Entry Trigger Engine
 * Detects pullback to EMA zone with RSI reset
 *
 * Rules:
 * - BULLISH ENTRY: Price in EMA20-50 zone, RSI was < 50 and turning up
 * - BEARISH ENTRY: Price in EMA20-50 zone, RSI was > 50 and turning down
 */
import { IndicatorData } from './indicatorService.js';
import { TrendDirection } from './trendFilter.js';
export type EntryStatus = 'ready' | 'building' | 'invalid';
export interface EntryAnalysis {
    status: EntryStatus;
    price: number;
    ema20: number;
    ema50: number;
    rsi: number;
    rsiPrevious: number;
    inPullbackZone: boolean;
    inStrictZone: boolean;
    inToleranceZone: boolean;
    pullbackDepth: 'shallow' | 'deep' | 'none';
    rsiWasReset: boolean;
    rsiTurning: boolean;
    rsiResetStrength: number;
    entryZoneLow: number;
    entryZoneHigh: number;
    isStrong: boolean;
    reason: string;
}
export declare function analyzeEntry(data: IndicatorData, trendDirection: TrendDirection): EntryAnalysis;

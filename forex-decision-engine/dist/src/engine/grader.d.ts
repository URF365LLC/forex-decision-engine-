/**
 * Grader Engine
 * Assigns A+ / B / No-Trade grade based on confluence
 *
 * Grading Rules:
 * - A+: Trend ✓ + Strong ADX + Pullback ✓ + Strong RSI reset
 * - B:  Trend ✓ + Pullback ✓ + (Weak RSI OR borderline ADX)
 * - No-Trade: Missing trend OR not in zone OR no confirmation
 */
import { TrendAnalysis } from './trendFilter.js';
import { EntryAnalysis } from './entryTrigger.js';
export type Grade = 'A+' | 'B' | 'no-trade';
export interface GradeResult {
    grade: Grade;
    score: number;
    trendScore: number;
    entryScore: number;
    momentumScore: number;
    strengths: string[];
    weaknesses: string[];
    reason: string;
}
export declare function calculateGrade(trend: TrendAnalysis, entry: EntryAnalysis): GradeResult;
/**
 * Get grade color for UI
 */
export declare function getGradeColor(grade: Grade): string;
/**
 * Get grade emoji for UI
 */
export declare function getGradeEmoji(grade: Grade): string;

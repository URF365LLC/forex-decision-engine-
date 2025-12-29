/**
 * Grader Engine
 * Assigns A+ / B / No-Trade grade based on confluence
 *
 * Grading Rules:
 * - A+: Trend ✓ + Strong ADX + Pullback ✓ + Strong RSI reset
 * - B:  Trend ✓ + Pullback ✓ + (Weak RSI OR borderline ADX)
 * - No-Trade: Missing trend OR not in zone OR no confirmation
 */
import { STRATEGY } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';
const logger = createLogger('Grader');
// ═══════════════════════════════════════════════════════════════
// GRADING
// ═══════════════════════════════════════════════════════════════
export function calculateGrade(trend, entry) {
    const strengths = [];
    const weaknesses = [];
    // ═══════════════════════════════════════════════════════════════
    // TREND SCORE (0-40 points)
    // ═══════════════════════════════════════════════════════════════
    let trendScore = 0;
    if (trend.direction !== 'none') {
        trendScore += 20; // Base points for having a trend
        strengths.push(`${trend.direction === 'bullish' ? 'Uptrend' : 'Downtrend'} established`);
        if (trend.adxAboveThreshold) {
            trendScore += 15; // Strong ADX
            strengths.push(`ADX ${trend.adx.toFixed(1)} confirms strength`);
        }
        else if (trend.adxBorderline) {
            trendScore += 8; // Borderline ADX
            weaknesses.push(`ADX ${trend.adx.toFixed(1)} borderline`);
        }
        if (trend.isStrong) {
            trendScore += 5; // All trend conditions strong
        }
    }
    else {
        weaknesses.push('No clear trend');
    }
    // ═══════════════════════════════════════════════════════════════
    // ENTRY SCORE (0-35 points)
    // ═══════════════════════════════════════════════════════════════
    let entryScore = 0;
    if (entry.inPullbackZone) {
        entryScore += 15; // In the zone
        if (entry.pullbackDepth === 'deep') {
            entryScore += 10; // Deep pullback is better
            strengths.push('Deep pullback to EMA50');
        }
        else if (entry.pullbackDepth === 'shallow') {
            entryScore += 5;
            strengths.push('Shallow pullback to EMA20');
        }
    }
    else {
        weaknesses.push('Price not in pullback zone');
    }
    if (entry.status === 'ready') {
        entryScore += 10;
    }
    else if (entry.status === 'building') {
        entryScore += 5;
        weaknesses.push('Setup still building');
    }
    // ═══════════════════════════════════════════════════════════════
    // MOMENTUM SCORE (0-25 points)
    // ═══════════════════════════════════════════════════════════════
    let momentumScore = 0;
    if (entry.rsiWasReset) {
        momentumScore += 10;
        strengths.push('RSI reset confirmed');
    }
    else {
        weaknesses.push('RSI not properly reset');
    }
    if (entry.rsiTurning) {
        momentumScore += 10;
        const direction = trend.direction === 'bullish' ? 'up' : 'down';
        strengths.push(`RSI turning ${direction}`);
    }
    else {
        weaknesses.push('RSI not turning in trend direction');
    }
    // RSI reset strength bonus
    if (entry.rsiResetStrength >= STRATEGY.grading.rsiResetStrength.strong) {
        momentumScore += 5;
        strengths.push(`Strong RSI momentum (+${entry.rsiResetStrength.toFixed(1)} pts)`);
    }
    else if (entry.rsiResetStrength >= STRATEGY.grading.rsiResetStrength.weak) {
        momentumScore += 2;
        weaknesses.push('Weak RSI momentum');
    }
    // ═══════════════════════════════════════════════════════════════
    // CALCULATE FINAL GRADE
    // ═══════════════════════════════════════════════════════════════
    const totalScore = trendScore + entryScore + momentumScore;
    let grade;
    let reason;
    // A+ Requirements: Strong trend + Ready entry + Good momentum
    if (trend.direction !== 'none' &&
        trend.adxAboveThreshold &&
        entry.status === 'ready' &&
        entry.rsiWasReset &&
        entry.rsiTurning &&
        totalScore >= 70) {
        grade = 'A+';
        reason = buildReason(trend, entry, 'Full confluence');
    }
    // B Requirements: Trend present + In zone + Some confirmation
    else if (trend.direction !== 'none' &&
        (trend.adxAboveThreshold || trend.adxBorderline) &&
        entry.inPullbackZone &&
        (entry.rsiWasReset || entry.rsiTurning) &&
        totalScore >= 45) {
        grade = 'B';
        reason = buildReason(trend, entry, 'Partial confluence');
    }
    // No-Trade: Missing critical components
    else {
        grade = 'no-trade';
        reason = weaknesses.length > 0
            ? weaknesses[0]
            : 'Insufficient confluence';
    }
    logger.debug(`Grade calculated: ${grade} (score: ${totalScore})`, {
        trendScore,
        entryScore,
        momentumScore,
        strengths,
        weaknesses,
    });
    return {
        grade,
        score: totalScore,
        trendScore,
        entryScore,
        momentumScore,
        strengths,
        weaknesses,
        reason,
    };
}
// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function buildReason(trend, entry, prefix) {
    const parts = [];
    // Trend
    if (trend.direction === 'bullish') {
        parts.push('Uptrend');
    }
    else if (trend.direction === 'bearish') {
        parts.push('Downtrend');
    }
    // Pullback
    if (entry.pullbackDepth === 'deep') {
        parts.push('pullback to EMA50');
    }
    else if (entry.pullbackDepth === 'shallow') {
        parts.push('pullback to EMA20');
    }
    // RSI
    if (entry.rsiWasReset && entry.rsiTurning) {
        parts.push(`RSI ${entry.rsiPrevious.toFixed(0)}→${entry.rsi.toFixed(0)}`);
    }
    // ADX
    if (trend.adxAboveThreshold) {
        parts.push(`ADX ${trend.adx.toFixed(0)}`);
    }
    return parts.join(', ');
}
/**
 * Get grade color for UI
 */
export function getGradeColor(grade) {
    switch (grade) {
        case 'A+': return '#22c55e'; // Green
        case 'B': return '#f59e0b'; // Amber
        case 'no-trade': return '#6b7280'; // Gray
    }
}
/**
 * Get grade emoji for UI
 */
export function getGradeEmoji(grade) {
    switch (grade) {
        case 'A+': return '✅';
        case 'B': return '⚠️';
        case 'no-trade': return '⬚';
    }
}
//# sourceMappingURL=grader.js.map
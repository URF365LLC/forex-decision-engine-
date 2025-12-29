/**
 * Volatility Gate Service
 * Filters out signals during extreme volatility conditions
 *
 * Gating Rules:
 * 1. ATR > 2x 20-period average = HIGH VOLATILITY (gate closed)
 * 2. ATR < 0.3x 20-period average = LOW VOLATILITY (gate closed)
 * 3. Normal ATR range = gate open
 *
 * This prevents:
 * - Trading during news spikes (extreme ATR)
 * - Trading in dead markets (no movement)
 */
export type VolatilityLevel = 'low' | 'normal' | 'high' | 'extreme';
export interface VolatilityCheck {
    allowed: boolean;
    level: VolatilityLevel;
    currentAtr: number;
    averageAtr: number;
    ratio: number;
    reason: string;
}
export declare const VOLATILITY_CONFIG: {
    thresholds: {
        extremeHigh: number;
        high: number;
        low: number;
        extremeLow: number;
    };
    averagePeriod: number;
    assetMultipliers: Record<string, number>;
};
/**
 * Check if volatility conditions allow trading
 */
export declare function checkVolatility(symbol: string, currentAtr: number, atrHistory: number[]): VolatilityCheck;
/**
 * Get volatility level label for UI
 */
export declare function getVolatilityLabel(level: VolatilityLevel): string;
/**
 * Get volatility color for UI
 */
export declare function getVolatilityColor(level: VolatilityLevel): string;

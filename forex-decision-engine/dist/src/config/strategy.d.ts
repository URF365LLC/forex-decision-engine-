/**
 * Strategy Configuration - FIXED PARAMETERS (v1)
 *
 * These are NOT user-editable in MVP v1.
 * Any customization is post-MVP.
 */
export declare const STRATEGY: {
    readonly trend: {
        readonly ema: {
            readonly period: 200;
            readonly slopeLookback: 3;
        };
        readonly adx: {
            readonly period: 14;
            readonly threshold: 20;
        };
    };
    readonly entry: {
        readonly emaFast: {
            readonly period: 20;
        };
        readonly emaSlow: {
            readonly period: 50;
        };
        readonly rsi: {
            readonly period: 14;
            readonly bullishResetBelow: 50;
            readonly bearishResetAbove: 50;
        };
    };
    readonly stopLoss: {
        readonly swingLookback: 10;
        readonly atr: {
            readonly period: 14;
            readonly multiplier: 1.5;
        };
    };
    readonly takeProfit: {
        readonly minRR: 2;
    };
    readonly grading: {
        readonly adxBorderline: {
            readonly min: 18;
            readonly ideal: 20;
        };
        readonly rsiResetStrength: {
            readonly strong: 5;
            readonly weak: 2;
        };
    };
};
export type TradingStyle = 'intraday' | 'swing';
export interface StyleConfig {
    name: string;
    trendTimeframe: string;
    entryTimeframe: string;
    refreshMinutes: number;
    validCandles: number;
    avInterval: string;
    avTrendInterval: string;
}
export declare const STYLE_PRESETS: Record<TradingStyle, StyleConfig>;
export declare function getStyleConfig(style: TradingStyle): StyleConfig;

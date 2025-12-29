/**
 * Trend Filter Engine
 * Determines trend direction on higher timeframe
 *
 * Rules:
 * - BULLISH: Price > EMA200 AND EMA200 slope > 0 AND ADX > 20
 * - BEARISH: Price < EMA200 AND EMA200 slope < 0 AND ADX > 20
 * - NO TREND: Otherwise
 */
import { IndicatorData } from './indicatorService.js';
export type TrendDirection = 'bullish' | 'bearish' | 'none';
export interface TrendAnalysis {
    direction: TrendDirection;
    price: number;
    ema200: number;
    ema200Slope: number;
    adx: number;
    priceAboveEma: boolean;
    priceBelowEma: boolean;
    slopePositive: boolean;
    slopeNegative: boolean;
    adxAboveThreshold: boolean;
    adxBorderline: boolean;
    isStrong: boolean;
    reason: string;
}
export declare function analyzeTrend(data: IndicatorData): TrendAnalysis;

/**
 * Position Sizer Engine
 * Calculates position size based on account, risk, and stop loss
 *
 * Formula: Position Size = Risk Amount / (Stop Loss Distance × Pip Value)
 */
export interface PositionSize {
    lots: number;
    units: number;
    riskAmount: number;
    riskPercent: number;
    pipValue: number;
    stopLossPips: number;
    isValid: boolean;
    warning: string | null;
}
export interface SizingInput {
    symbol: string;
    entryPrice: number;
    stopLossPrice: number;
    accountSize: number;
    riskPercent: number;
}
export declare function calculatePositionSize(input: SizingInput): PositionSize;
export interface StopLossResult {
    price: number;
    pips: number;
    method: 'swing' | 'atr';
}
export declare function calculateStopLoss(entryPrice: number, direction: 'long' | 'short', swingLevel: number | null, atr: number, symbol: string): StopLossResult;
export interface TakeProfitResult {
    price: number;
    pips: number;
    riskReward: number;
}
export declare function calculateTakeProfit(entryPrice: number, stopLossPrice: number, direction: 'long' | 'short', minRR: number, symbol: string): TakeProfitResult;
/**
 * Format position size for display
 */
export declare function formatPositionSize(size: PositionSize): string;
/**
 * Format price with appropriate precision
 */
export declare function formatPrice(price: number, symbol: string): string;

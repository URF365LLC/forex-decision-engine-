/**
 * Position Sizer Engine
 * Calculates position size based on account, risk, and stop loss
 *
 * Formula: Position Size = Risk Amount / (Stop Loss Distance × Pip Value)
 */
import { DEFAULTS, LOT_SIZES, PIP_VALUES } from '../config/defaults.js';
import { getPipDecimals, getAssetClass } from '../config/universe.js';
import { createLogger } from '../services/logger.js';
const logger = createLogger('PositionSizer');
// ═══════════════════════════════════════════════════════════════
// POSITION SIZING
// ═══════════════════════════════════════════════════════════════
export function calculatePositionSize(input) {
    const { symbol, entryPrice, stopLossPrice, accountSize, riskPercent } = input;
    // Calculate risk amount in dollars
    const riskAmount = accountSize * (riskPercent / 100);
    // Calculate stop loss distance
    const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
    // Get pip decimals for this symbol
    const pipDecimals = getPipDecimals(symbol);
    // Calculate pips (for JPY pairs, 1 pip = 0.01, for others 1 pip = 0.0001)
    const pipSize = pipDecimals === 2 ? 0.01 : 0.0001;
    const stopLossPips = stopLossDistance / pipSize;
    // Calculate pip value per standard lot
    // For USD quote pairs (EURUSD, GBPUSD): $10 per pip per lot
    // For JPY pairs: need to convert
    // For crypto: different calculation
    const assetClass = getAssetClass(symbol);
    let pipValue = PIP_VALUES.standard;
    if (symbol.endsWith('JPY')) {
        // JPY pairs: pip value = (pip size / current price) × lot size
        // Simplified: approximately $8-9 per pip per lot
        pipValue = 8.5;
    }
    else if (assetClass === 'crypto') {
        // Crypto: much larger movements, adjust accordingly
        // BTC: 1 pip = $0.01 × contract size
        pipValue = 1; // Will be adjusted by lot size
    }
    // Calculate position size in lots
    // Formula: Risk Amount / (Stop Loss Pips × Pip Value)
    let lots = 0;
    if (stopLossPips > 0 && pipValue > 0) {
        lots = riskAmount / (stopLossPips * pipValue);
    }
    // Round to 2 decimal places (standard lot precision)
    lots = Math.round(lots * 100) / 100;
    // Calculate units
    const units = Math.round(lots * LOT_SIZES.standard);
    // Validate against E8 limits
    let isValid = true;
    let warning = null;
    if (lots > DEFAULTS.risk.maxLotForex) {
        warning = `Position size ${lots} exceeds E8 max lot limit (${DEFAULTS.risk.maxLotForex})`;
        lots = DEFAULTS.risk.maxLotForex;
        isValid = false;
    }
    if (lots < 0.01) {
        warning = 'Position size too small (minimum 0.01 lots)';
        lots = 0.01;
        isValid = false;
    }
    logger.debug(`Position sizing for ${symbol}`, {
        entryPrice,
        stopLossPrice,
        stopLossPips,
        riskAmount,
        lots,
    });
    return {
        lots,
        units,
        riskAmount,
        riskPercent,
        pipValue,
        stopLossPips: Math.round(stopLossPips * 10) / 10,
        isValid,
        warning,
    };
}
export function calculateStopLoss(entryPrice, direction, swingLevel, atr, symbol) {
    const pipDecimals = getPipDecimals(symbol);
    const pipSize = pipDecimals === 2 ? 0.01 : 0.0001;
    const atrMultiplier = 1.5;
    let stopPrice;
    let method;
    // Try swing level first
    if (swingLevel !== null) {
        // Add small buffer beyond swing
        const buffer = atr * 0.3;
        if (direction === 'long') {
            stopPrice = swingLevel - buffer;
        }
        else {
            stopPrice = swingLevel + buffer;
        }
        method = 'swing';
    }
    else {
        // Fallback to ATR-based stop
        const atrStop = atr * atrMultiplier;
        if (direction === 'long') {
            stopPrice = entryPrice - atrStop;
        }
        else {
            stopPrice = entryPrice + atrStop;
        }
        method = 'atr';
    }
    // Calculate pips
    const pips = Math.abs(entryPrice - stopPrice) / pipSize;
    return {
        price: roundPrice(stopPrice, pipDecimals),
        pips: Math.round(pips * 10) / 10,
        method,
    };
}
export function calculateTakeProfit(entryPrice, stopLossPrice, direction, minRR, symbol) {
    const pipDecimals = getPipDecimals(symbol);
    const pipSize = pipDecimals === 2 ? 0.01 : 0.0001;
    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const rewardDistance = riskDistance * minRR;
    let takeProfit;
    if (direction === 'long') {
        takeProfit = entryPrice + rewardDistance;
    }
    else {
        takeProfit = entryPrice - rewardDistance;
    }
    const pips = rewardDistance / pipSize;
    return {
        price: roundPrice(takeProfit, pipDecimals),
        pips: Math.round(pips * 10) / 10,
        riskReward: minRR,
    };
}
// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function roundPrice(price, decimals) {
    const precision = decimals === 2 ? 3 : 5;
    return Math.round(price * Math.pow(10, precision)) / Math.pow(10, precision);
}
/**
 * Format position size for display
 */
export function formatPositionSize(size) {
    return `${size.lots} lots ($${size.riskAmount.toFixed(0)} risk)`;
}
/**
 * Format price with appropriate precision
 */
export function formatPrice(price, symbol) {
    const decimals = getPipDecimals(symbol);
    const precision = decimals === 2 ? 3 : 5;
    return price.toFixed(precision);
}
//# sourceMappingURL=positionSizer.js.map
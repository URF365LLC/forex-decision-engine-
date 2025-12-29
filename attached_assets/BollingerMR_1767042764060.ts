/**
 * STRATEGY: Bollinger Band Mean Reversion (Intraday)
 * 
 * Win Rate: ~65%
 * Risk:Reward: 1:1.5
 * Signals/Day: 3-4
 * 
 * RULES:
 * ══════════════════════════════════════════════════════════════
 * SETUP:
 * - Price touches or penetrates outer Bollinger Band
 * - Wait for reversal candle (rejection)
 * - RSI should be at extreme (confirms oversold/overbought)
 * 
 * ENTRY:
 * - LONG: Price touched lower BB + RSI < 35 + bullish rejection candle
 * - SHORT: Price touched upper BB + RSI > 65 + bearish rejection candle
 * 
 * STOP LOSS:
 * - Beyond the band penetration extreme
 * - Or 1x ATR from entry
 * 
 * TAKE PROFIT:
 * - Middle Bollinger Band (SMA20)
 * - Or 1.5R minimum
 * 
 * NOTE: This works best in ranging markets, not strong trends!
 * ══════════════════════════════════════════════════════════════
 */

import {
  IStrategy,
  StrategyMeta,
  IndicatorData,
  Decision,
  UserSettings,
} from '../types';

import {
  latest,
  previous,
  findSwingHigh,
  findSwingLow,
  buildDecision,
  validateIndicators,
  calculateSlope,
} from '../utils';

// ═══════════════════════════════════════════════════════════════
// STRATEGY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // RSI Confirmation
  rsiOversold: 35,
  rsiOverbought: 65,
  rsiExtreme: 25,      // Extra confidence below this
  rsiExtremeHigh: 75,  // Extra confidence above this
  
  // Rejection Candle
  minWickRatio: 0.5,   // Wick should be at least 50% of candle range
  
  // Trend Filter (avoid trading against strong trends)
  maxEmaSlope: 0.0002, // If EMA200 slope > this, trend is too strong
  
  // Risk Management
  atrMultiplier: 1.0,
  swingLookback: 6,
  minRR: 1.5,
};

// ═══════════════════════════════════════════════════════════════
// STRATEGY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class BollingerMRIntraday implements IStrategy {
  meta: StrategyMeta = {
    id: 'bollinger-mr',
    name: 'Bollinger Band Mean Reversion',
    description: 'Mean reversion from Bollinger Band extremes with RSI and candle confirmation',
    style: 'intraday',
    winRate: 65,
    avgRR: 1.5,
    signalsPerWeek: '15-20',
    requiredIndicators: ['bars', 'bbands', 'rsi', 'atr', 'ema200'],
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    // Validate data
    if (!validateIndicators(data, this.meta.requiredIndicators, 30)) {
      return null;
    }

    const { bars, bbands, rsi, atr, ema200 } = data;
    const symbol = data.symbol;
    
    const currentBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const price = currentBar.close;
    
    const currentBB = latest(bbands)!;
    const currentRsi = latest(rsi)!;
    const currentAtr = latest(atr)!;

    const triggers: string[] = [];
    const warnings: string[] = [];
    let confidence = 0;

    // ════════════════════════════════════════════════════════════
    // STEP 1: CHECK FOR BAND TOUCH
    // ════════════════════════════════════════════════════════════
    
    const touchedLowerBand = currentBar.low <= currentBB.lower || prevBar.low <= currentBB.lower;
    const touchedUpperBand = currentBar.high >= currentBB.upper || prevBar.high >= currentBB.upper;
    
    if (!touchedLowerBand && !touchedUpperBand) {
      return null; // Price not at bands
    }

    // ════════════════════════════════════════════════════════════
    // STEP 2: CHECK RSI CONFIRMATION
    // ════════════════════════════════════════════════════════════
    
    let direction: 'long' | 'short' | null = null;
    
    if (touchedLowerBand && currentRsi < CONFIG.rsiOversold) {
      direction = 'long';
      triggers.push(`Price touched lower BB at ${currentBB.lower.toFixed(5)}`);
      triggers.push(`RSI oversold: ${currentRsi.toFixed(1)}`);
      
      if (currentRsi < CONFIG.rsiExtreme) {
        confidence += 35;
        triggers.push('RSI extremely oversold');
      } else {
        confidence += 25;
      }
    }
    else if (touchedUpperBand && currentRsi > CONFIG.rsiOverbought) {
      direction = 'short';
      triggers.push(`Price touched upper BB at ${currentBB.upper.toFixed(5)}`);
      triggers.push(`RSI overbought: ${currentRsi.toFixed(1)}`);
      
      if (currentRsi > CONFIG.rsiExtremeHigh) {
        confidence += 35;
        triggers.push('RSI extremely overbought');
      } else {
        confidence += 25;
      }
    }
    
    if (!direction) {
      return null; // RSI doesn't confirm
    }

    // ════════════════════════════════════════════════════════════
    // STEP 3: CHECK FOR REJECTION CANDLE
    // ════════════════════════════════════════════════════════════
    
    const candleRange = currentBar.high - currentBar.low;
    const bodySize = Math.abs(currentBar.close - currentBar.open);
    
    let hasRejection = false;
    
    if (direction === 'long') {
      // Lower wick should be long (price rejected from lows)
      const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;
      const wickRatio = candleRange > 0 ? lowerWick / candleRange : 0;
      
      hasRejection = wickRatio >= CONFIG.minWickRatio && currentBar.close > currentBar.open;
      
      if (hasRejection) {
        triggers.push(`Bullish rejection candle (${(wickRatio * 100).toFixed(0)}% lower wick)`);
        confidence += 20;
      } else if (currentBar.close > currentBar.open) {
        triggers.push('Bullish candle at lower band');
        confidence += 10;
      } else {
        warnings.push('No clear rejection candle yet');
        confidence += 5;
      }
    } else {
      // Upper wick should be long (price rejected from highs)
      const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
      const wickRatio = candleRange > 0 ? upperWick / candleRange : 0;
      
      hasRejection = wickRatio >= CONFIG.minWickRatio && currentBar.close < currentBar.open;
      
      if (hasRejection) {
        triggers.push(`Bearish rejection candle (${(wickRatio * 100).toFixed(0)}% upper wick)`);
        confidence += 20;
      } else if (currentBar.close < currentBar.open) {
        triggers.push('Bearish candle at upper band');
        confidence += 10;
      } else {
        warnings.push('No clear rejection candle yet');
        confidence += 5;
      }
    }

    // ════════════════════════════════════════════════════════════
    // STEP 4: TREND STRENGTH CHECK (avoid strong trends)
    // ════════════════════════════════════════════════════════════
    
    if (ema200 && ema200.length > 10) {
      const emaSlope = Math.abs(calculateSlope(ema200, 10));
      
      if (emaSlope > CONFIG.maxEmaSlope) {
        // Strong trend - mean reversion is riskier
        if (direction === 'long' && calculateSlope(ema200, 10) < 0) {
          warnings.push('Strong downtrend - counter-trend long');
          confidence -= 10;
        } else if (direction === 'short' && calculateSlope(ema200, 10) > 0) {
          warnings.push('Strong uptrend - counter-trend short');
          confidence -= 10;
        }
      } else {
        triggers.push('Ranging market - ideal for mean reversion');
        confidence += 15;
      }
    }

    // ════════════════════════════════════════════════════════════
    // STEP 5: BAND WIDTH CHECK (volatility)
    // ════════════════════════════════════════════════════════════
    
    const bandWidth = (currentBB.upper - currentBB.lower) / currentBB.middle;
    
    if (bandWidth > 0.03) {
      triggers.push('Expanded bands - high volatility');
      confidence += 10;
    } else if (bandWidth < 0.015) {
      warnings.push('Squeezed bands - breakout may occur');
      confidence -= 5;
    }

    // ════════════════════════════════════════════════════════════
    // STEP 6: CALCULATE STOP LOSS & TAKE PROFIT
    // ════════════════════════════════════════════════════════════
    
    let stopLossPrice: number;
    let takeProfitPrice: number;
    
    if (direction === 'long') {
      // Stop below the band touch extreme
      const extremeLow = findSwingLow(bars, CONFIG.swingLookback);
      stopLossPrice = Math.min(extremeLow - currentAtr * 0.3, currentBB.lower - currentAtr * 0.5);
      
      // Target middle band
      const risk = price - stopLossPrice;
      takeProfitPrice = Math.max(currentBB.middle, price + risk * CONFIG.minRR);
      triggers.push(`Target: Middle BB at ${currentBB.middle.toFixed(5)}`);
    } else {
      // Stop above the band touch extreme
      const extremeHigh = findSwingHigh(bars, CONFIG.swingLookback);
      stopLossPrice = Math.max(extremeHigh + currentAtr * 0.3, currentBB.upper + currentAtr * 0.5);
      
      // Target middle band
      const risk = stopLossPrice - price;
      takeProfitPrice = Math.min(currentBB.middle, price - risk * CONFIG.minRR);
      triggers.push(`Target: Middle BB at ${currentBB.middle.toFixed(5)}`);
    }

    // Cap confidence at 100
    confidence = Math.min(confidence, 100);
    
    // Minimum confidence threshold
    if (confidence < 50) {
      return null;
    }

    // ════════════════════════════════════════════════════════════
    // STEP 7: BUILD DECISION
    // ════════════════════════════════════════════════════════════
    
    const reason = direction === 'long'
      ? `Price bouncing from lower Bollinger Band with RSI oversold (${currentRsi.toFixed(0)})`
      : `Price rejecting upper Bollinger Band with RSI overbought (${currentRsi.toFixed(0)})`;

    return buildDecision({
      symbol,
      strategyId: this.meta.id,
      strategyName: this.meta.name,
      direction,
      confidence,
      entryPrice: price,
      stopLossPrice,
      takeProfitPrice,
      reason,
      triggers,
      warnings,
      settings,
    });
  }
}

// Export singleton instance
export const bollingerMRIntraday = new BollingerMRIntraday();

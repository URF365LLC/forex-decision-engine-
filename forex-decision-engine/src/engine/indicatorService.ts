/**
 * Indicator Service
 * Fetches all required indicators for a symbol
 */

import { alphaVantage, OHLCVBar, IndicatorValue } from '../services/alphaVantageClient.js';
import { STRATEGY, TradingStyle, getStyleConfig } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('IndicatorService');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface IndicatorData {
  symbol: string;
  style: TradingStyle;
  
  // Price data
  trendBars: OHLCVBar[];        // Higher timeframe bars
  entryBars: OHLCVBar[];        // Lower timeframe bars
  currentPrice: number;
  
  // Trend indicators (HTF)
  ema200: IndicatorValue[];
  adx: IndicatorValue[];
  
  // Entry indicators (LTF)
  ema20: IndicatorValue[];
  ema50: IndicatorValue[];
  rsi: IndicatorValue[];
  atr: IndicatorValue[];
  
  // Additional indicators for multi-strategy system
  stoch: { timestamp: string; k: number; d: number }[];
  willr: IndicatorValue[];
  cci: IndicatorValue[];
  bbands: { timestamp: string; upper: number; middle: number; lower: number }[];
  sma20: IndicatorValue[];
  
  // Metadata
  fetchedAt: string;
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch all indicators needed for analysis
 * Makes ~8 API calls per symbol (with caching)
 */
export async function fetchIndicators(
  symbol: string,
  style: TradingStyle
): Promise<IndicatorData> {
  const config = getStyleConfig(style);
  const errors: string[] = [];
  
  logger.info(`Fetching indicators for ${symbol} (${style})`);

  // Initialize with empty arrays
  const data: IndicatorData = {
    symbol,
    style,
    trendBars: [],
    entryBars: [],
    currentPrice: 0,
    ema200: [],
    adx: [],
    ema20: [],
    ema50: [],
    rsi: [],
    atr: [],
    stoch: [],
    willr: [],
    cci: [],
    bbands: [],
    sma20: [],
    fetchedAt: new Date().toISOString(),
    errors: [],
  };

  try {
    // ═══════════════════════════════════════════════════════════
    // 1. OHLCV DATA
    // ═══════════════════════════════════════════════════════════
    
    // Entry timeframe bars (H1 for intraday, need to aggregate to H4 for swing)
    try {
      data.entryBars = await alphaVantage.getOHLCV(symbol, '60min', 'full');
      logger.debug(`Got ${data.entryBars.length} entry bars for ${symbol}`);
    } catch (e) {
      errors.push(`Entry bars: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // Trend timeframe bars (Daily for both styles works)
    try {
      data.trendBars = await alphaVantage.getOHLCV(symbol, 'daily', 'compact');
      logger.debug(`Got ${data.trendBars.length} trend bars for ${symbol}`);
    } catch (e) {
      errors.push(`Trend bars: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // Current price from most recent bar
    if (data.entryBars.length > 0) {
      data.currentPrice = data.entryBars[data.entryBars.length - 1].close;
    }

    // ═══════════════════════════════════════════════════════════
    // 2. TREND INDICATORS (Higher Timeframe)
    // ═══════════════════════════════════════════════════════════

    // EMA 200 on daily
    try {
      data.ema200 = await alphaVantage.getEMA(symbol, 'daily', STRATEGY.trend.ema.period);
      logger.debug(`Got ${data.ema200.length} EMA200 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA200: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // ADX on daily
    try {
      data.adx = await alphaVantage.getADX(symbol, 'daily', STRATEGY.trend.adx.period);
      logger.debug(`Got ${data.adx.length} ADX values for ${symbol}`);
    } catch (e) {
      errors.push(`ADX: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. ENTRY INDICATORS (Lower Timeframe)
    // ═══════════════════════════════════════════════════════════

    // EMA 20 on 60min
    try {
      data.ema20 = await alphaVantage.getEMA(symbol, '60min', STRATEGY.entry.emaFast.period);
      logger.debug(`Got ${data.ema20.length} EMA20 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA20: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // EMA 50 on 60min
    try {
      data.ema50 = await alphaVantage.getEMA(symbol, '60min', STRATEGY.entry.emaSlow.period);
      logger.debug(`Got ${data.ema50.length} EMA50 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA50: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // RSI on 60min
    try {
      data.rsi = await alphaVantage.getRSI(symbol, '60min', STRATEGY.entry.rsi.period);
      logger.debug(`Got ${data.rsi.length} RSI values for ${symbol}`);
    } catch (e) {
      errors.push(`RSI: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // ATR on 60min (for stop loss calculation)
    try {
      data.atr = await alphaVantage.getATR(symbol, '60min', STRATEGY.stopLoss.atr.period);
      logger.debug(`Got ${data.atr.length} ATR values for ${symbol}`);
    } catch (e) {
      errors.push(`ATR: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // ═══════════════════════════════════════════════════════════
    // 4. ADDITIONAL INDICATORS FOR MULTI-STRATEGY SYSTEM
    // ═══════════════════════════════════════════════════════════

    // Stochastic Oscillator on 60min (for Stochastic Momentum strategy)
    try {
      data.stoch = await alphaVantage.getStochastic(symbol, '60min', 14, 3, 3);
      logger.debug(`Got ${data.stoch.length} STOCH values for ${symbol}`);
    } catch (e) {
      errors.push(`STOCH: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // Williams %R on 60min (for Williams %R Reversal strategy)
    try {
      data.willr = await alphaVantage.getWilliamsR(symbol, '60min', 14);
      logger.debug(`Got ${data.willr.length} WILLR values for ${symbol}`);
    } catch (e) {
      errors.push(`WILLR: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // CCI on 60min (for CCI Trend strategy)
    try {
      data.cci = await alphaVantage.getCCI(symbol, '60min', 20);
      logger.debug(`Got ${data.cci.length} CCI values for ${symbol}`);
    } catch (e) {
      errors.push(`CCI: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // Bollinger Bands on 60min (for Bollinger Breakout strategy)
    try {
      data.bbands = await alphaVantage.getBBands(symbol, '60min', 20, 2, 2);
      logger.debug(`Got ${data.bbands.length} BBANDS values for ${symbol}`);
    } catch (e) {
      errors.push(`BBANDS: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // SMA 20 on 60min (for Multi-Timeframe Alignment strategy)
    try {
      data.sma20 = await alphaVantage.getSMA(symbol, '60min', 20);
      logger.debug(`Got ${data.sma20.length} SMA20 values for ${symbol}`);
    } catch (e) {
      errors.push(`SMA20: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

  } catch (e) {
    errors.push(`General error: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  data.errors = errors;
  
  if (errors.length > 0) {
    logger.warn(`Indicator fetch completed with ${errors.length} errors for ${symbol}`, errors);
  } else {
    logger.info(`Indicator fetch completed successfully for ${symbol}`);
  }

  return data;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get the latest value from an indicator array
 */
export function getLatestValue(indicators: IndicatorValue[]): number | null {
  if (indicators.length === 0) return null;
  return indicators[indicators.length - 1].value;
}

/**
 * Get the previous value from an indicator array
 */
export function getPreviousValue(indicators: IndicatorValue[], offset: number = 1): number | null {
  if (indicators.length <= offset) return null;
  return indicators[indicators.length - 1 - offset].value;
}

/**
 * Calculate slope of indicator over N periods
 */
export function calculateSlope(indicators: IndicatorValue[], periods: number): number {
  if (indicators.length < periods + 1) return 0;
  
  const current = indicators[indicators.length - 1].value;
  const previous = indicators[indicators.length - 1 - periods].value;
  
  return current - previous;
}

/**
 * Find swing high in bars
 */
export function findSwingHigh(bars: OHLCVBar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  
  const recentBars = bars.slice(-lookback);
  let highestHigh = 0;
  
  for (const bar of recentBars) {
    if (bar.high > highestHigh) {
      highestHigh = bar.high;
    }
  }
  
  return highestHigh;
}

/**
 * Find swing low in bars
 */
export function findSwingLow(bars: OHLCVBar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  
  const recentBars = bars.slice(-lookback);
  let lowestLow = Infinity;
  
  for (const bar of recentBars) {
    if (bar.low < lowestLow) {
      lowestLow = bar.low;
    }
  }
  
  return lowestLow === Infinity ? null : lowestLow;
}

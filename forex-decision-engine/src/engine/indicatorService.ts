/**
 * Indicator Service
 * Fetches all required indicators for a symbol
 * TWELVE DATA ONLY - Unified data source for all asset classes
 */

import { twelveData } from '../services/twelveDataClient.js';
import type { OHLCVBar, IndicatorValue, MACDValue } from '../services/twelveDataClient.js';
import { STRATEGY, TradingStyle, getStyleConfig } from '../config/strategy.js';
import { getAssetType } from '../config/e8InstrumentSpecs.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('IndicatorService');

export interface IndicatorData {
  symbol: string;
  style: TradingStyle;
  
  trendBars: OHLCVBar[];
  entryBars: OHLCVBar[];
  currentPrice: number;
  
  ema200: IndicatorValue[];
  adx: IndicatorValue[];
  
  ema20: IndicatorValue[];
  ema50: IndicatorValue[];
  rsi: IndicatorValue[];
  atr: IndicatorValue[];
  
  stoch: { timestamp: string; k: number; d: number }[];
  willr: IndicatorValue[];
  cci: IndicatorValue[];
  bbands: { timestamp: string; upper: number; middle: number; lower: number }[];
  sma20: IndicatorValue[];
  
  ema8?: IndicatorValue[];
  ema21?: IndicatorValue[];
  ema55?: IndicatorValue[];
  macd?: MACDValue[];
  obv?: IndicatorValue[];
  
  fetchedAt: string;
  errors: string[];
}

export { OHLCVBar, IndicatorValue };

export async function fetchIndicators(
  symbol: string,
  style: TradingStyle
): Promise<IndicatorData> {
  const config = getStyleConfig(style);
  const errors: string[] = [];
  
  const assetType = getAssetType(symbol);
  const isMetals = assetType === 'metal';
  
  const entryInterval = isMetals ? 'daily' : '60min';
  
  logger.info(`Fetching indicators for ${symbol} (${style})${isMetals ? ' [metals: daily only]' : ''} via Twelve Data`);

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
    ema8: [],
    ema21: [],
    ema55: [],
    macd: [],
    obv: [],
    fetchedAt: new Date().toISOString(),
    errors: [],
  };

  try {
    try {
      data.entryBars = await twelveData.getOHLCV(symbol, entryInterval, 'full');
      logger.debug(`Got ${data.entryBars.length} entry bars for ${symbol}`);
    } catch (e) {
      errors.push(`Entry bars: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.trendBars = await twelveData.getOHLCV(symbol, 'daily', 'compact');
      logger.debug(`Got ${data.trendBars.length} trend bars for ${symbol}`);
    } catch (e) {
      errors.push(`Trend bars: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    if (data.entryBars.length > 0) {
      data.currentPrice = data.entryBars[data.entryBars.length - 1].close;
    }

    try {
      data.ema200 = await twelveData.getEMA(symbol, 'daily', STRATEGY.trend.ema.period);
      logger.debug(`Got ${data.ema200.length} EMA200 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA200: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.adx = await twelveData.getADX(symbol, 'daily', STRATEGY.trend.adx.period);
      logger.debug(`Got ${data.adx.length} ADX values for ${symbol}`);
    } catch (e) {
      errors.push(`ADX: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.ema20 = await twelveData.getEMA(symbol, entryInterval, STRATEGY.entry.emaFast.period);
      logger.debug(`Got ${data.ema20.length} EMA20 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA20: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.ema50 = await twelveData.getEMA(symbol, entryInterval, STRATEGY.entry.emaSlow.period);
      logger.debug(`Got ${data.ema50.length} EMA50 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA50: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.rsi = await twelveData.getRSI(symbol, entryInterval, STRATEGY.entry.rsi.period);
      logger.debug(`Got ${data.rsi.length} RSI values for ${symbol}`);
    } catch (e) {
      errors.push(`RSI: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.atr = await twelveData.getATR(symbol, entryInterval, STRATEGY.stopLoss.atr.period);
      logger.debug(`Got ${data.atr.length} ATR values for ${symbol}`);
    } catch (e) {
      errors.push(`ATR: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.stoch = await twelveData.getStochastic(symbol, entryInterval, 14, 3, 3);
      logger.debug(`Got ${data.stoch.length} STOCH values for ${symbol}`);
    } catch (e) {
      errors.push(`STOCH: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.willr = await twelveData.getWilliamsR(symbol, entryInterval, 14);
      logger.debug(`Got ${data.willr.length} WILLR values for ${symbol}`);
    } catch (e) {
      errors.push(`WILLR: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.cci = await twelveData.getCCI(symbol, entryInterval, 20);
      logger.debug(`Got ${data.cci.length} CCI values for ${symbol}`);
    } catch (e) {
      errors.push(`CCI: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.bbands = await twelveData.getBBands(symbol, entryInterval, 20, 2, 2);
      logger.debug(`Got ${data.bbands.length} BBANDS values for ${symbol}`);
    } catch (e) {
      errors.push(`BBANDS: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.sma20 = await twelveData.getSMA(symbol, entryInterval, 20);
      logger.debug(`Got ${data.sma20.length} SMA20 values for ${symbol}`);
    } catch (e) {
      errors.push(`SMA20: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.ema8 = await twelveData.getEMA(symbol, entryInterval, 8);
      logger.debug(`Got ${data.ema8.length} EMA8 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA8: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.ema21 = await twelveData.getEMA(symbol, entryInterval, 21);
      logger.debug(`Got ${data.ema21.length} EMA21 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA21: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.ema55 = await twelveData.getEMA(symbol, entryInterval, 55);
      logger.debug(`Got ${data.ema55.length} EMA55 values for ${symbol}`);
    } catch (e) {
      errors.push(`EMA55: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.macd = await twelveData.getMACD(symbol, entryInterval, 12, 26, 9);
      logger.debug(`Got ${data.macd.length} MACD values for ${symbol}`);
    } catch (e) {
      errors.push(`MACD: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    try {
      data.obv = await twelveData.getOBV(symbol, entryInterval);
      logger.debug(`Got ${data.obv.length} OBV values for ${symbol}`);
    } catch (e) {
      errors.push(`OBV: ${e instanceof Error ? e.message : 'Unknown error'}`);
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

export function getLatestValue(indicators: IndicatorValue[]): number | null {
  if (indicators.length === 0) return null;
  return indicators[indicators.length - 1].value;
}

export function getPreviousValue(indicators: IndicatorValue[], offset: number = 1): number | null {
  if (indicators.length <= offset) return null;
  return indicators[indicators.length - 1 - offset].value;
}

export function calculateSlope(indicators: IndicatorValue[], periods: number): number {
  if (indicators.length < periods + 1) return 0;
  
  const current = indicators[indicators.length - 1].value;
  const previous = indicators[indicators.length - 1 - periods].value;
  
  return current - previous;
}

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

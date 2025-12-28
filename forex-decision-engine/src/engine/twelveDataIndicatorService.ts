/**
 * Twelve Data Indicator Service
 * Fetches OHLCV from Twelve Data API
 * Computes technical indicators locally (EMA, RSI, ADX, ATR)
 * Used for Metals, Indices, and Energies
 */

import { OHLCVBar, IndicatorValue } from '../services/alphaVantageClient.js';
import { twelveData } from '../services/twelveDataClient.js';
import { TradingStyle } from '../config/strategy.js';
import { STRATEGY } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';
import {
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateADX,
} from './indicatorCalculations.js';

const logger = createLogger('TwelveDataIndicators');

export interface TwelveDataIndicatorData {
  symbol: string;
  style: TradingStyle;
  
  trendBars: OHLCVBar[];
  entryBars: OHLCVBar[];
  currentPrice: number;
  
  ema200: IndicatorValue[];
  ema50: IndicatorValue[];
  ema20: IndicatorValue[];
  rsi: IndicatorValue[];
  adx: IndicatorValue[];
  atr: IndicatorValue[];
  
  errors: string[];
  fetchedAt: string;
}

export async function fetchTwelveDataIndicators(
  symbol: string,
  style: TradingStyle
): Promise<TwelveDataIndicatorData> {
  const errors: string[] = [];
  
  logger.info(`Fetching Twelve Data indicators for ${symbol} (${style})`);
  
  const data: TwelveDataIndicatorData = {
    symbol,
    style,
    trendBars: [],
    entryBars: [],
    currentPrice: 0,
    ema200: [],
    ema50: [],
    ema20: [],
    rsi: [],
    adx: [],
    atr: [],
    errors: [],
    fetchedAt: new Date().toISOString(),
  };
  
  try {
    const [entryBars, trendBars] = await Promise.all([
      twelveData.getOHLCV(symbol, '60min', 500),
      twelveData.getOHLCV(symbol, 'daily', 200),
    ]);
    
    data.entryBars = entryBars;
    data.trendBars = trendBars;
    
    if (entryBars.length === 0) {
      errors.push(`No OHLCV data returned for ${symbol}`);
      data.errors = errors;
      return data;
    }
    
    data.currentPrice = entryBars[entryBars.length - 1]?.close || 0;
    
    data.ema200 = calculateEMA(entryBars, 200);
    data.ema50 = calculateEMA(entryBars, STRATEGY.entry.emaSlow.period);
    data.ema20 = calculateEMA(entryBars, STRATEGY.entry.emaFast.period);
    data.rsi = calculateRSI(entryBars, STRATEGY.entry.rsi.period);
    data.adx = calculateADX(entryBars, STRATEGY.trend.adx.period);
    data.atr = calculateATR(entryBars, STRATEGY.stopLoss.atr.period);
    
    logger.info(`Twelve Data indicators computed for ${symbol}: ${entryBars.length} bars`);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to fetch Twelve Data indicators for ${symbol}`, { error: message });
    errors.push(message);
  }
  
  data.errors = errors;
  return data;
}

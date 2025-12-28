/**
 * Crypto Indicator Service
 * Fetches OHLCV from Alpha Vantage CRYPTO_INTRADAY
 * Computes technical indicators locally (EMA, RSI, ADX, ATR)
 * 
 * Why separate from forex?
 * Alpha Vantage indicator endpoints (EMA, RSI, etc.) don't support crypto.
 * We must fetch raw OHLCV and calculate indicators ourselves.
 */

import { alphaVantage, OHLCVBar, IndicatorValue } from '../services/alphaVantageClient.js';
import { kucoin } from '../services/kucoinClient.js';
import { TradingStyle, getStyleConfig } from '../config/strategy.js';
import { STRATEGY } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('CryptoIndicators');

const KUCOIN_SYMBOLS = ['BNBUSD', 'BCHUSD'];

export interface CryptoIndicatorData {
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

function calculateEMA(bars: OHLCVBar[], period: number): IndicatorValue[] {
  if (bars.length < period) return [];
  
  const results: IndicatorValue[] = [];
  const multiplier = 2 / (period + 1);
  
  let ema = bars.slice(0, period).reduce((sum, b) => sum + b.close, 0) / period;
  
  for (let i = 0; i < period - 1; i++) {
    results.push({ timestamp: bars[i].timestamp, value: 0 });
  }
  
  results.push({ timestamp: bars[period - 1].timestamp, value: ema });
  
  for (let i = period; i < bars.length; i++) {
    ema = (bars[i].close - ema) * multiplier + ema;
    results.push({ timestamp: bars[i].timestamp, value: ema });
  }
  
  return results;
}

function calculateRSI(bars: OHLCVBar[], period: number = 14): IndicatorValue[] {
  if (bars.length < period + 1) return [];
  
  const results: IndicatorValue[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < period; i++) {
    results.push({ timestamp: bars[i].timestamp, value: 50 });
  }
  
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  results.push({ timestamp: bars[period].timestamp, value: rsi });
  
  for (let i = period; i < gains.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
    results.push({ timestamp: bars[i + 1].timestamp, value: rsi });
  }
  
  return results;
}

function calculateATR(bars: OHLCVBar[], period: number = 14): IndicatorValue[] {
  if (bars.length < period + 1) return [];
  
  const results: IndicatorValue[] = [];
  const trueRanges: number[] = [];
  
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  for (let i = 0; i < period; i++) {
    results.push({ timestamp: bars[i].timestamp, value: 0 });
  }
  
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  results.push({ timestamp: bars[period].timestamp, value: atr });
  
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    results.push({ timestamp: bars[i + 1].timestamp, value: atr });
  }
  
  return results;
}

function calculateADX(bars: OHLCVBar[], period: number = 14): IndicatorValue[] {
  if (bars.length < period * 2) return [];
  
  const results: IndicatorValue[] = [];
  
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];
  
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevHigh = bars[i - 1].high;
    const prevLow = bars[i - 1].low;
    const prevClose = bars[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
    
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  
  for (let i = 0; i < period * 2 - 1; i++) {
    results.push({ timestamp: bars[i].timestamp, value: 25 });
  }
  
  const dxValues: number[] = [];
  
  for (let i = period; i < trueRanges.length; i++) {
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];
    smoothedTR = smoothedTR - (smoothedTR / period) + trueRanges[i];
    
    const plusDI = smoothedTR === 0 ? 0 : (100 * smoothedPlusDM / smoothedTR);
    const minusDI = smoothedTR === 0 ? 0 : (100 * smoothedMinusDM / smoothedTR);
    
    const diSum = plusDI + minusDI;
    const dx = diSum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI) / diSum);
    dxValues.push(dx);
  }
  
  if (dxValues.length < period) return results;
  
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  results.push({ timestamp: bars[period * 2 - 1].timestamp, value: adx });
  
  for (let i = period; i < dxValues.length; i++) {
    adx = ((adx * (period - 1)) + dxValues[i]) / period;
    results.push({ timestamp: bars[period + i].timestamp, value: adx });
  }
  
  return results;
}

export async function fetchCryptoIndicators(
  symbol: string,
  style: TradingStyle
): Promise<CryptoIndicatorData> {
  const errors: string[] = [];
  
  logger.info(`Fetching crypto indicators for ${symbol} (${style})`);
  
  const data: CryptoIndicatorData = {
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
    let entryBars: OHLCVBar[];
    let trendBars: OHLCVBar[];
    
    if (KUCOIN_SYMBOLS.includes(symbol)) {
      logger.info(`${symbol}: Using KuCoin data source`);
      [entryBars, trendBars] = await Promise.all([
        kucoin.getOHLCV(symbol, '60min'),
        kucoin.getOHLCV(symbol, 'daily'),
      ]);
    } else {
      logger.info(`${symbol}: Using Alpha Vantage data source`);
      [entryBars, trendBars] = await Promise.all([
        alphaVantage.getOHLCV(symbol, '60min', 'full'),
        alphaVantage.getOHLCV(symbol, 'daily', 'compact'),
      ]);
    }
    
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
    
    logger.info(`Crypto indicators computed for ${symbol}: ${entryBars.length} bars`);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to fetch crypto indicators for ${symbol}`, { error: message });
    errors.push(message);
  }
  
  data.errors = errors;
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

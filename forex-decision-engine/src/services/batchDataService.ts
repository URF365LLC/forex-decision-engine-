/**
 * Batch Data Service
 * Uses Twelve Data /batch endpoint for efficient multi-symbol data fetching
 * 
 * THREE-WAY VALIDATED SPEC:
 * - Auth: Header only (Authorization: apikey ${key})
 * - Request ID delimiter: :: (safe for symbols like US_500)
 * - Chunk size: 50 requests per batch
 * - Partial failures: Log + skip, don't abort
 */

import { createLogger } from './logger.js';
import { INSTRUMENT_MAP, InstrumentSpec } from '../config/e8InstrumentSpecs.js';
import { Bar } from '../strategies/types.js';

const logger = createLogger('BatchDataService');

const TWELVE_DATA_BATCH_URL = 'https://api.twelvedata.com/batch';
const MAX_BATCH_SIZE = 50;

interface BatchRequest {
  [requestId: string]: { url: string };
}

interface BatchResponseItem {
  status: 'ok' | 'error';
  values?: any[];
  message?: string;
  code?: number;
}

interface BatchResponse {
  [requestId: string]: BatchResponseItem;
}

export interface BatchIndicatorData {
  symbol: string;
  bars: Bar[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  atr: number[];
  adx: number[];
  stoch: { k: number; d: number }[];
  cci: number[];
  bbands: { upper: number; middle: number; lower: number }[];
  willr: number[];
  ema200H4: number[];
  adxH4: number[];
  errors: string[];
}

function getDataSymbol(symbol: string): string | null {
  const spec = INSTRUMENT_MAP.get(symbol);
  return spec?.dataSymbol || null;
}

function chunkRequests(requests: BatchRequest): BatchRequest[] {
  const entries = Object.entries(requests);
  const chunks: BatchRequest[] = [];
  
  for (let i = 0; i < entries.length; i += MAX_BATCH_SIZE) {
    chunks.push(Object.fromEntries(entries.slice(i, i + MAX_BATCH_SIZE)));
  }
  
  return chunks;
}

async function fetchBatch(requests: BatchRequest): Promise<BatchResponse> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  
  if (!apiKey) {
    throw new Error('TWELVE_DATA_API_KEY not configured');
  }
  
  const response = await fetch(TWELVE_DATA_BATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `apikey ${apiKey}`,
    },
    body: JSON.stringify(requests),
  });
  
  if (!response.ok) {
    throw new Error(`Batch request failed: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

function buildBatchRequest(
  symbols: string[],
  options: {
    entryInterval: string;
    trendInterval: string;
    indicators: string[];
  }
): BatchRequest {
  const { entryInterval, trendInterval, indicators } = options;
  const request: BatchRequest = {};
  
  for (const symbol of symbols) {
    const dataSymbol = getDataSymbol(symbol);
    
    if (!dataSymbol) {
      logger.warn(`BATCH_SKIP: Unknown symbol ${symbol}`);
      continue;
    }
    
    const isCrypto = INSTRUMENT_MAP.get(symbol)?.type === 'crypto';
    const symbolParam = isCrypto ? `${dataSymbol}:Binance` : dataSymbol;
    
    request[`${symbol}::time_series::H1`] = {
      url: `/time_series?symbol=${symbolParam}&interval=${entryInterval}&outputsize=200`
    };
    
    if (indicators.includes('ema20')) {
      request[`${symbol}::ema20::H1`] = {
        url: `/ema?symbol=${symbolParam}&interval=${entryInterval}&time_period=20&outputsize=200`
      };
    }
    
    if (indicators.includes('ema50')) {
      request[`${symbol}::ema50::H1`] = {
        url: `/ema?symbol=${symbolParam}&interval=${entryInterval}&time_period=50&outputsize=200`
      };
    }
    
    if (indicators.includes('rsi')) {
      request[`${symbol}::rsi::H1`] = {
        url: `/rsi?symbol=${symbolParam}&interval=${entryInterval}&time_period=14&outputsize=200`
      };
    }
    
    if (indicators.includes('atr')) {
      request[`${symbol}::atr::H1`] = {
        url: `/atr?symbol=${symbolParam}&interval=${entryInterval}&time_period=14&outputsize=200`
      };
    }
    
    if (indicators.includes('stoch')) {
      request[`${symbol}::stoch::H1`] = {
        url: `/stoch?symbol=${symbolParam}&interval=${entryInterval}&slow_k_period=14&slow_d_period=3&outputsize=200`
      };
    }
    
    if (indicators.includes('cci')) {
      request[`${symbol}::cci::H1`] = {
        url: `/cci?symbol=${symbolParam}&interval=${entryInterval}&time_period=20&outputsize=200`
      };
    }
    
    if (indicators.includes('bbands')) {
      request[`${symbol}::bbands::H1`] = {
        url: `/bbands?symbol=${symbolParam}&interval=${entryInterval}&time_period=20&outputsize=200`
      };
    }
    
    if (indicators.includes('willr')) {
      request[`${symbol}::willr::H1`] = {
        url: `/willr?symbol=${symbolParam}&interval=${entryInterval}&time_period=14&outputsize=200`
      };
    }
    
    if (indicators.includes('ema200H4')) {
      request[`${symbol}::ema200::H4`] = {
        url: `/ema?symbol=${symbolParam}&interval=${trendInterval}&time_period=200&outputsize=250`
      };
    }
    
    if (indicators.includes('adxH4')) {
      request[`${symbol}::adx::H4`] = {
        url: `/adx?symbol=${symbolParam}&interval=${trendInterval}&time_period=14&outputsize=250`
      };
    }
  }
  
  return request;
}

function parseTimeSeries(values: any[]): Bar[] {
  if (!values || !Array.isArray(values)) return [];
  
  return values.map(v => ({
    timestamp: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: parseFloat(v.volume || '0'),
  })).reverse();
}

function parseIndicatorValues(values: any[], key: string): number[] {
  if (!values || !Array.isArray(values)) return [];
  
  return values.map(v => parseFloat(v[key] || '0')).reverse();
}

function parseStoch(values: any[]): { k: number; d: number }[] {
  if (!values || !Array.isArray(values)) return [];
  
  return values.map(v => ({
    k: parseFloat(v.slow_k || '0'),
    d: parseFloat(v.slow_d || '0'),
  })).reverse();
}

function parseBBands(values: any[]): { upper: number; middle: number; lower: number }[] {
  if (!values || !Array.isArray(values)) return [];
  
  return values.map(v => ({
    upper: parseFloat(v.upper_band || '0'),
    middle: parseFloat(v.middle_band || '0'),
    lower: parseFloat(v.lower_band || '0'),
  })).reverse();
}

function createEmptyBatchData(symbol: string): BatchIndicatorData {
  return {
    symbol,
    bars: [],
    ema20: [],
    ema50: [],
    ema200: [],
    rsi: [],
    atr: [],
    adx: [],
    stoch: [],
    cci: [],
    bbands: [],
    willr: [],
    ema200H4: [],
    adxH4: [],
    errors: [],
  };
}

function parseAndMergeResults(
  response: BatchResponse,
  results: Map<string, BatchIndicatorData>
): void {
  for (const [requestId, result] of Object.entries(response)) {
    if (result.status === 'error') {
      logger.warn(`BATCH_PARTIAL_FAILURE: ${requestId} - ${result.message || 'Unknown error'}`);
      const [symbol] = requestId.split('::');
      if (results.has(symbol)) {
        results.get(symbol)!.errors.push(`${requestId}: ${result.message}`);
      }
      continue;
    }
    
    if (!result.values || !Array.isArray(result.values)) {
      logger.warn(`BATCH_MISSING_DATA: ${requestId} - No values array`);
      continue;
    }
    
    const [symbol, indicator, timeframe] = requestId.split('::');
    
    if (!results.has(symbol)) {
      results.set(symbol, createEmptyBatchData(symbol));
    }
    
    const data = results.get(symbol)!;
    
    switch (indicator) {
      case 'time_series':
        data.bars = parseTimeSeries(result.values);
        break;
      case 'ema20':
        data.ema20 = parseIndicatorValues(result.values, 'ema');
        break;
      case 'ema50':
        data.ema50 = parseIndicatorValues(result.values, 'ema');
        break;
      case 'ema200':
        if (timeframe === 'H4') {
          data.ema200H4 = parseIndicatorValues(result.values, 'ema');
        } else {
          data.ema200 = parseIndicatorValues(result.values, 'ema');
        }
        break;
      case 'rsi':
        data.rsi = parseIndicatorValues(result.values, 'rsi');
        break;
      case 'atr':
        data.atr = parseIndicatorValues(result.values, 'atr');
        break;
      case 'adx':
        if (timeframe === 'H4') {
          data.adxH4 = parseIndicatorValues(result.values, 'adx');
        } else {
          data.adx = parseIndicatorValues(result.values, 'adx');
        }
        break;
      case 'stoch':
        data.stoch = parseStoch(result.values);
        break;
      case 'cci':
        data.cci = parseIndicatorValues(result.values, 'cci');
        break;
      case 'bbands':
        data.bbands = parseBBands(result.values);
        break;
      case 'willr':
        data.willr = parseIndicatorValues(result.values, 'willr');
        break;
      default:
        logger.debug(`Unknown indicator in batch response: ${indicator}`);
    }
  }
}

export async function fetchAllSymbolData(
  symbols: string[],
  options: {
    indicators?: string[];
    entryInterval?: string;
    trendInterval?: string;
  } = {}
): Promise<Map<string, BatchIndicatorData>> {
  const {
    indicators = ['ema20', 'ema50', 'rsi', 'atr', 'stoch', 'cci', 'bbands', 'willr', 'ema200H4', 'adxH4'],
    entryInterval = '1h',
    trendInterval = '4h',
  } = options;
  
  const results = new Map<string, BatchIndicatorData>();
  
  for (const symbol of symbols) {
    results.set(symbol, createEmptyBatchData(symbol));
  }
  
  const fullRequest = buildBatchRequest(symbols, {
    entryInterval,
    trendInterval,
    indicators,
  });
  
  const chunks = chunkRequests(fullRequest);
  const totalRequests = Object.keys(fullRequest).length;
  
  logger.info(`BATCH_START: ${symbols.length} symbols, ${totalRequests} requests, ${chunks.length} chunks`);
  
  for (let i = 0; i < chunks.length; i++) {
    try {
      logger.debug(`BATCH_CHUNK: Processing chunk ${i + 1}/${chunks.length} (${Object.keys(chunks[i]).length} requests)`);
      
      const response = await fetchBatch(chunks[i]);
      parseAndMergeResults(response, results);
      
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      logger.error(`BATCH_CHUNK_FAILED: Chunk ${i + 1}/${chunks.length} - ${error}`);
    }
  }
  
  let symbolsWithData = 0;
  let symbolsWithErrors = 0;
  
  for (const data of results.values()) {
    if (data.bars.length > 0) symbolsWithData++;
    if (data.errors.length > 0) symbolsWithErrors++;
  }
  
  logger.info(`BATCH_COMPLETE: ${symbolsWithData}/${symbols.length} symbols received data, ${symbolsWithErrors} with partial errors`);
  
  return results;
}

export function validateBatchResults(
  results: Map<string, BatchIndicatorData>,
  requiredIndicators: string[] = ['bars', 'rsi', 'ema20']
): { valid: string[]; incomplete: string[] } {
  const valid: string[] = [];
  const incomplete: string[] = [];
  
  for (const [symbol, data] of results.entries()) {
    let isValid = true;
    
    for (const indicator of requiredIndicators) {
      const value = (data as any)[indicator];
      if (!value || (Array.isArray(value) && value.length === 0)) {
        isValid = false;
        logger.debug(`BATCH_INCOMPLETE: ${symbol} missing ${indicator}`);
        break;
      }
    }
    
    if (isValid) {
      valid.push(symbol);
    } else {
      incomplete.push(symbol);
    }
  }
  
  return { valid, incomplete };
}

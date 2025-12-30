/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P0 TASK #1: MISSING INDICATOR MAPPINGS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: convertToStrategyIndicatorData() lacks stoch, willr, cci, bbands, sma20 mappings
 *          This blocks 5 of 8 intraday strategies from working.
 * 
 * AFFECTED STRATEGIES:
 *   - Stochastic Momentum (needs stoch)
 *   - Williams %R Reversal (needs willr) 
 *   - CCI Trend (needs cci)
 *   - Bollinger Breakout (needs bbands)
 *   - Multi-Timeframe Alignment (needs sma20)
 * 
 * FILES TO MODIFY:
 *   1. src/services/indicatorService.ts - Add new indicator fetching
 *   2. src/engine/strategyAnalyzer.ts - Add mapping in convertToStrategyIndicatorData()
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PART 1: UPDATE src/services/indicatorService.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD these interfaces to IndicatorData (around line 15-30):
 */
export interface IndicatorData {
  symbol: string;
  style: TradingStyle;
  trendBars: OHLCVBar[];
  entryBars: OHLCVBar[];
  currentPrice: number;
  
  // EXISTING indicators
  ema200: IndicatorValue[];
  adx: IndicatorValue[];
  ema20: IndicatorValue[];
  ema50: IndicatorValue[];
  rsi: IndicatorValue[];
  atr: IndicatorValue[];
  
  // ════════════════════════════════════════════════════════════
  // NEW INDICATORS - ADD THESE
  // ════════════════════════════════════════════════════════════
  stoch: { k: IndicatorValue[]; d: IndicatorValue[] };  // Stochastic %K and %D
  willr: IndicatorValue[];                               // Williams %R
  cci: IndicatorValue[];                                 // Commodity Channel Index
  bbands: { upper: IndicatorValue[]; middle: IndicatorValue[]; lower: IndicatorValue[] };  // Bollinger Bands
  sma20: IndicatorValue[];                               // SMA 20 for multi-timeframe
  
  fetchedAt: string;
  errors: string[];
}

/**
 * UPDATE the fetchIndicators() function - ADD after ATR fetch (around line 100-140):
 */
export async function fetchIndicators(
  symbol: string,
  style: TradingStyle
): Promise<IndicatorData> {
  const config = getStyleConfig(style);
  const errors: string[] = [];

  logger.info(`Fetching indicators for ${symbol} (${style})`);

  // Initialize with empty arrays - UPDATE THIS INITIALIZATION
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
    // ════════════════════════════════════════════════════════════
    // NEW - Initialize new indicators
    // ════════════════════════════════════════════════════════════
    stoch: { k: [], d: [] },
    willr: [],
    cci: [],
    bbands: { upper: [], middle: [], lower: [] },
    sma20: [],
    fetchedAt: new Date().toISOString(),
    errors: [],
  };

  try {
    // ... existing OHLCV and indicator fetches ...

    // ════════════════════════════════════════════════════════════════
    // ADD THIS BLOCK AFTER ATR FETCH (around line 120)
    // NEW INDICATORS FOR INTRADAY STRATEGIES
    // ════════════════════════════════════════════════════════════════

    // Stochastic Oscillator on 60min (for Stochastic Momentum strategy)
    try {
      const stochData = await alphaVantage.getSTOCH(symbol, '60min', 14, 3, 3);
      data.stoch = stochData;
      logger.debug(`Got ${stochData.k.length} STOCH values for ${symbol}`);
    } catch (e) {
      errors.push(`STOCH: ${e instanceof Error ? e.message : 'Unknown error'}`);
      // Initialize with empty arrays on error
      data.stoch = { k: [], d: [] };
    }

    // Williams %R on 60min (for Williams %R Reversal strategy)
    try {
      data.willr = await alphaVantage.getWILLR(symbol, '60min', 14);
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
      const bbandsData = await alphaVantage.getBBANDS(symbol, '60min', 20, 2);
      data.bbands = bbandsData;
      logger.debug(`Got ${bbandsData.middle.length} BBANDS values for ${symbol}`);
    } catch (e) {
      errors.push(`BBANDS: ${e instanceof Error ? e.message : 'Unknown error'}`);
      // Initialize with empty arrays on error
      data.bbands = { upper: [], middle: [], lower: [] };
    }

    // SMA 20 on 60min (for Multi-Timeframe Alignment strategy)
    try {
      data.sma20 = await alphaVantage.getSMA(symbol, '60min', 20);
      logger.debug(`Got ${data.sma20.length} SMA20 values for ${symbol}`);
    } catch (e) {
      errors.push(`SMA20: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    // ════════════════════════════════════════════════════════════════

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


// ═══════════════════════════════════════════════════════════════════════════════
// PART 2: UPDATE src/services/alphaVantageClient.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD these methods to the AlphaVantageClient class:
 */

// Add to the class (after getATR method):

async getSTOCH(
  symbol: string,
  interval: string,
  fastkperiod: number = 14,
  slowkperiod: number = 3,
  slowdperiod: number = 3
): Promise<{ k: IndicatorValue[]; d: IndicatorValue[] }> {
  const cacheKey = `stoch:${symbol}:${interval}:${fastkperiod}`;
  const cached = this.cache.get<{ k: IndicatorValue[]; d: IndicatorValue[] }>(cacheKey);
  if (cached) return cached;

  await this.rateLimiter.acquire();

  const params = new URLSearchParams({
    function: 'STOCH',
    symbol: this.normalizeSymbol(symbol),
    interval,
    fastkperiod: fastkperiod.toString(),
    slowkperiod: slowkperiod.toString(),
    slowdperiod: slowdperiod.toString(),
    apikey: this.apiKey,
  });

  const response = await fetch(`${this.baseUrl}?${params}`);
  const data = await response.json();

  if (data['Error Message']) {
    throw new Error(data['Error Message']);
  }

  const technicalKey = 'Technical Analysis: STOCH';
  const rawData = data[technicalKey];

  if (!rawData) {
    throw new Error('No STOCH data returned');
  }

  const kValues: IndicatorValue[] = [];
  const dValues: IndicatorValue[] = [];

  for (const [timestamp, values] of Object.entries(rawData)) {
    const v = values as Record<string, string>;
    kValues.push({
      timestamp,
      value: parseFloat(v['SlowK']),
    });
    dValues.push({
      timestamp,
      value: parseFloat(v['SlowD']),
    });
  }

  // Sort by timestamp ascending
  kValues.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  dValues.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const result = { k: kValues, d: dValues };
  this.cache.set(cacheKey, result, 5 * 60 * 1000); // 5 min cache

  return result;
}

async getWILLR(
  symbol: string,
  interval: string,
  timePeriod: number = 14
): Promise<IndicatorValue[]> {
  const cacheKey = `willr:${symbol}:${interval}:${timePeriod}`;
  const cached = this.cache.get<IndicatorValue[]>(cacheKey);
  if (cached) return cached;

  await this.rateLimiter.acquire();

  const params = new URLSearchParams({
    function: 'WILLR',
    symbol: this.normalizeSymbol(symbol),
    interval,
    time_period: timePeriod.toString(),
    apikey: this.apiKey,
  });

  const response = await fetch(`${this.baseUrl}?${params}`);
  const data = await response.json();

  if (data['Error Message']) {
    throw new Error(data['Error Message']);
  }

  const technicalKey = 'Technical Analysis: WILLR';
  const values = this.parseIndicatorData(data, technicalKey, 'WILLR');

  this.cache.set(cacheKey, values, 5 * 60 * 1000);
  return values;
}

async getCCI(
  symbol: string,
  interval: string,
  timePeriod: number = 20
): Promise<IndicatorValue[]> {
  const cacheKey = `cci:${symbol}:${interval}:${timePeriod}`;
  const cached = this.cache.get<IndicatorValue[]>(cacheKey);
  if (cached) return cached;

  await this.rateLimiter.acquire();

  const params = new URLSearchParams({
    function: 'CCI',
    symbol: this.normalizeSymbol(symbol),
    interval,
    time_period: timePeriod.toString(),
    apikey: this.apiKey,
  });

  const response = await fetch(`${this.baseUrl}?${params}`);
  const data = await response.json();

  if (data['Error Message']) {
    throw new Error(data['Error Message']);
  }

  const technicalKey = 'Technical Analysis: CCI';
  const values = this.parseIndicatorData(data, technicalKey, 'CCI');

  this.cache.set(cacheKey, values, 5 * 60 * 1000);
  return values;
}

async getBBANDS(
  symbol: string,
  interval: string,
  timePeriod: number = 20,
  nbdevup: number = 2,
  nbdevdn: number = 2
): Promise<{ upper: IndicatorValue[]; middle: IndicatorValue[]; lower: IndicatorValue[] }> {
  const cacheKey = `bbands:${symbol}:${interval}:${timePeriod}`;
  const cached = this.cache.get<{ upper: IndicatorValue[]; middle: IndicatorValue[]; lower: IndicatorValue[] }>(cacheKey);
  if (cached) return cached;

  await this.rateLimiter.acquire();

  const params = new URLSearchParams({
    function: 'BBANDS',
    symbol: this.normalizeSymbol(symbol),
    interval,
    time_period: timePeriod.toString(),
    nbdevup: nbdevup.toString(),
    nbdevdn: nbdevdn.toString(),
    series_type: 'close',
    apikey: this.apiKey,
  });

  const response = await fetch(`${this.baseUrl}?${params}`);
  const data = await response.json();

  if (data['Error Message']) {
    throw new Error(data['Error Message']);
  }

  const technicalKey = 'Technical Analysis: BBANDS';
  const rawData = data[technicalKey];

  if (!rawData) {
    throw new Error('No BBANDS data returned');
  }

  const upper: IndicatorValue[] = [];
  const middle: IndicatorValue[] = [];
  const lower: IndicatorValue[] = [];

  for (const [timestamp, values] of Object.entries(rawData)) {
    const v = values as Record<string, string>;
    upper.push({ timestamp, value: parseFloat(v['Real Upper Band']) });
    middle.push({ timestamp, value: parseFloat(v['Real Middle Band']) });
    lower.push({ timestamp, value: parseFloat(v['Real Lower Band']) });
  }

  // Sort by timestamp ascending
  upper.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  middle.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  lower.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const result = { upper, middle, lower };
  this.cache.set(cacheKey, result, 5 * 60 * 1000);

  return result;
}

async getSMA(
  symbol: string,
  interval: string,
  timePeriod: number
): Promise<IndicatorValue[]> {
  const cacheKey = `sma:${symbol}:${interval}:${timePeriod}`;
  const cached = this.cache.get<IndicatorValue[]>(cacheKey);
  if (cached) return cached;

  await this.rateLimiter.acquire();

  const params = new URLSearchParams({
    function: 'SMA',
    symbol: this.normalizeSymbol(symbol),
    interval,
    time_period: timePeriod.toString(),
    series_type: 'close',
    apikey: this.apiKey,
  });

  const response = await fetch(`${this.baseUrl}?${params}`);
  const data = await response.json();

  if (data['Error Message']) {
    throw new Error(data['Error Message']);
  }

  const technicalKey = 'Technical Analysis: SMA';
  const values = this.parseIndicatorData(data, technicalKey, 'SMA');

  this.cache.set(cacheKey, values, 5 * 60 * 1000);
  return values;
}


// ═══════════════════════════════════════════════════════════════════════════════
// PART 3: UPDATE src/engine/strategyAnalyzer.ts - convertToStrategyIndicatorData()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * FIND the convertToStrategyIndicatorData() function (around lines 51-59)
 * and ADD the new indicator mappings:
 */

function convertToStrategyIndicatorData(data: IndicatorData): StrategyIndicatorData {
  const getLatest = (arr: IndicatorValue[]): number | null => {
    if (!arr || arr.length === 0) return null;
    return arr[arr.length - 1]?.value ?? null;
  };

  const getPrevious = (arr: IndicatorValue[], offset: number = 1): number | null => {
    if (!arr || arr.length <= offset) return null;
    return arr[arr.length - 1 - offset]?.value ?? null;
  };

  return {
    // EXISTING mappings
    symbol: data.symbol,
    currentPrice: data.currentPrice,
    ema200: getLatest(data.ema200),
    ema50: getLatest(data.ema50),
    ema20: getLatest(data.ema20),
    rsi: getLatest(data.rsi),
    rsiPrevious: getPrevious(data.rsi, 1),
    adx: getLatest(data.adx),
    atr: getLatest(data.atr),
    
    // ════════════════════════════════════════════════════════════════
    // NEW MAPPINGS - ADD THESE
    // ════════════════════════════════════════════════════════════════
    
    // Stochastic Oscillator
    stochK: getLatest(data.stoch?.k ?? []),
    stochD: getLatest(data.stoch?.d ?? []),
    stochKPrevious: getPrevious(data.stoch?.k ?? [], 1),
    stochDPrevious: getPrevious(data.stoch?.d ?? [], 1),
    
    // Williams %R
    willr: getLatest(data.willr ?? []),
    willrPrevious: getPrevious(data.willr ?? [], 1),
    
    // CCI
    cci: getLatest(data.cci ?? []),
    cciPrevious: getPrevious(data.cci ?? [], 1),
    
    // Bollinger Bands
    bbandsUpper: getLatest(data.bbands?.upper ?? []),
    bbandsMiddle: getLatest(data.bbands?.middle ?? []),
    bbandsLower: getLatest(data.bbands?.lower ?? []),
    bbandsPreviousUpper: getPrevious(data.bbands?.upper ?? [], 1),
    bbandsPreviousLower: getPrevious(data.bbands?.lower ?? [], 1),
    
    // SMA 20
    sma20: getLatest(data.sma20 ?? []),
    
    // OHLCV for candle-based strategies
    bars: data.entryBars,
    trendBars: data.trendBars,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// PART 4: UPDATE src/types/strategy.ts - StrategyIndicatorData interface
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UPDATE the StrategyIndicatorData interface to include new fields:
 */

export interface StrategyIndicatorData {
  symbol: string;
  currentPrice: number;
  
  // EMAs
  ema200: number | null;
  ema50: number | null;
  ema20: number | null;
  
  // RSI
  rsi: number | null;
  rsiPrevious: number | null;
  
  // ADX & ATR
  adx: number | null;
  atr: number | null;
  
  // ════════════════════════════════════════════════════════════════
  // NEW INDICATORS - ADD THESE
  // ════════════════════════════════════════════════════════════════
  
  // Stochastic
  stochK: number | null;
  stochD: number | null;
  stochKPrevious: number | null;
  stochDPrevious: number | null;
  
  // Williams %R
  willr: number | null;
  willrPrevious: number | null;
  
  // CCI
  cci: number | null;
  cciPrevious: number | null;
  
  // Bollinger Bands
  bbandsUpper: number | null;
  bbandsMiddle: number | null;
  bbandsLower: number | null;
  bbandsPreviousUpper: number | null;
  bbandsPreviousLower: number | null;
  
  // SMA
  sma20: number | null;
  
  // OHLCV bars for candle analysis
  bars: OHLCVBar[];
  trendBars: OHLCVBar[];
}

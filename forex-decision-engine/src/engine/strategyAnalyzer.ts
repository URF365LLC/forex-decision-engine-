/**
 * Strategy Analyzer
 * Bridge between new multi-strategy system and existing indicator infrastructure
 * 
 * Key features:
 * - Routes to correct strategy based on strategyId
 * - Uses shared indicator cache (raw data)
 * - Caches strategy-specific decisions separately
 */

import { getIndicators, AnyIndicatorData } from './indicatorFactory.js';
import { IndicatorData as OldIndicatorData, getLatestValue } from './indicatorService.js';
import { strategyRegistry } from '../strategies/index.js';
import { 
  IndicatorData as StrategyIndicatorData, 
  Decision as StrategyDecision,
  UserSettings,
  Bar 
} from '../strategies/types.js';
import { getDisplayName } from '../config/universe.js';
import { cache, CACHE_TTL } from '../services/cache.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('StrategyAnalyzer');

const DECISION_CACHE_TTL = 60 * 60;

function makeDecisionCacheKey(symbol: string, strategyId: string): string {
  return `decision:${symbol}:${strategyId}`;
}

function convertToStrategyIndicatorData(
  symbol: string,
  oldData: AnyIndicatorData
): StrategyIndicatorData {
  const bars: Bar[] = oldData.entryBars.map(b => ({
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));

  const extractValues = (arr: { timestamp: string; value: number | null }[] | undefined): number[] => {
    if (!arr) return [];
    return arr.map(v => v.value ?? 0);
  };

  return {
    symbol,
    bars,
    ema20: extractValues(oldData.ema20),
    ema50: extractValues(oldData.ema50),
    ema200: extractValues(oldData.ema200),
    rsi: extractValues(oldData.rsi),
    atr: extractValues(oldData.atr),
    adx: extractValues(oldData.adx),
  };
}

export interface StrategyAnalysisResult {
  decision: StrategyDecision | null;
  fromCache: boolean;
  strategyId: string;
  errors: string[];
}

export async function analyzeWithStrategy(
  symbol: string,
  strategyId: string,
  settings: UserSettings
): Promise<StrategyAnalysisResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  logger.info(`Analyzing ${symbol} with strategy ${strategyId}`);
  
  const cacheKey = makeDecisionCacheKey(symbol, strategyId);
  const cachedDecision = cache.get<StrategyDecision>(cacheKey);
  if (cachedDecision) {
    logger.debug(`Cache HIT for decision: ${symbol}:${strategyId}`);
    return {
      decision: cachedDecision,
      fromCache: true,
      strategyId,
      errors: [],
    };
  }
  
  const strategy = strategyRegistry.get(strategyId);
  if (!strategy) {
    logger.error(`Strategy not found: ${strategyId}`);
    return {
      decision: null,
      fromCache: false,
      strategyId,
      errors: [`Strategy not found: ${strategyId}`],
    };
  }
  
  let oldIndicators: AnyIndicatorData;
  try {
    oldIndicators = await getIndicators(symbol, settings.style);
    errors.push(...oldIndicators.errors);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    logger.error(`Failed to fetch indicators for ${symbol}`, { error });
    return {
      decision: null,
      fromCache: false,
      strategyId,
      errors: [`Failed to fetch data: ${error}`],
    };
  }
  
  if (oldIndicators.entryBars.length < 50) {
    return {
      decision: null,
      fromCache: false,
      strategyId,
      errors: ['Insufficient price data'],
    };
  }
  
  const strategyData = convertToStrategyIndicatorData(symbol, oldIndicators);
  
  let decision: StrategyDecision | null = null;
  try {
    decision = await strategy.analyze(strategyData, settings);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    logger.error(`Strategy analysis failed for ${symbol}`, { error, strategyId });
    errors.push(`Strategy analysis failed: ${error}`);
  }
  
  if (decision) {
    decision.displayName = getDisplayName(symbol);
    
    const meta = strategyRegistry.getMeta(strategyId);
    if (meta?.timeframes) {
      decision.timeframes = meta.timeframes;
    }
    
    cache.set(cacheKey, decision, DECISION_CACHE_TTL);
    logger.debug(`Cached decision: ${symbol}:${strategyId}`);
  }
  
  const elapsed = Date.now() - startTime;
  logger.info(`Strategy analysis complete for ${symbol}: ${decision?.grade || 'no-trade'} (${elapsed}ms)`);
  
  return {
    decision,
    fromCache: false,
    strategyId,
    errors,
  };
}

export async function scanWithStrategy(
  symbols: string[],
  strategyId: string,
  settings: UserSettings,
  onProgress?: (current: number, total: number, symbol: string) => void
): Promise<StrategyDecision[]> {
  const results: StrategyDecision[] = [];
  
  logger.info(`Starting strategy scan: ${symbols.length} symbols with ${strategyId}`);
  
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    
    if (onProgress) {
      onProgress(i, symbols.length, symbol);
    }
    
    const result = await analyzeWithStrategy(symbol, strategyId, settings);
    
    if (result.decision) {
      results.push(result.decision);
    } else {
      results.push(createNoTradeDecision(symbol, strategyId, result.errors));
    }
  }
  
  logger.info(`Strategy scan complete: ${results.length} results`);
  
  return results;
}

function createNoTradeDecision(symbol: string, strategyId: string, errors: string[]): StrategyDecision {
  const now = new Date();
  const meta = strategyRegistry.getMeta(strategyId);
  
  return {
    symbol,
    displayName: getDisplayName(symbol),
    strategyId,
    strategyName: meta?.name || strategyId,
    direction: 'long',
    grade: 'no-trade',
    confidence: 0,
    entryPrice: 0,
    entryZone: null,
    stopLoss: null,
    takeProfit: null,
    position: null,
    reason: errors[0] || 'No trade setup found',
    triggers: [],
    reasonCodes: [],
    warnings: errors,
    style: 'intraday',
    executionModel: 'NEXT_OPEN',
    timeframes: meta?.timeframes || { trend: 'H4', entry: 'H1' },
    timestamp: now.toISOString(),
    validUntil: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
  };
}

export function clearStrategyCache(strategyId?: string): number {
  if (strategyId) {
    const pattern = `decision:*:${strategyId}`;
    return cache.deletePattern(pattern);
  }
  return cache.deletePattern('decision:*');
}

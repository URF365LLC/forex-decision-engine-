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
  Bar,
  GatingInfo,
  VolatilityLevel
} from '../strategies/types.js';
import { getInstrumentSpec } from '../config/e8InstrumentSpecs.js';
import { cache, CACHE_TTL } from '../services/cache.js';
import { createLogger } from '../services/logger.js';
import { signalCooldown, CooldownCheck } from '../services/signalCooldown.js';
import { checkVolatility, VolatilityCheck } from '../services/volatilityGate.js';
import { gradeTracker } from '../services/gradeTracker.js';

const logger = createLogger('StrategyAnalyzer');

const DECISION_CACHE_TTL = 5 * 60;       // 5 minutes for actionable signals
const NO_TRADE_CACHE_TTL = CACHE_TTL.noTrade;  // 2 minutes for no-trade decisions

function makeDecisionCacheKey(symbol: string, strategyId: string): string {
  return `decision:${symbol}:${strategyId}`;
}

function makeNoTradeCacheKey(symbol: string, strategyId: string): string {
  return `no-trade:${symbol}:${strategyId}`;
}

function padIndicatorToBarsLength<T>(
  indicator: T[],
  barsLength: number,
  indicatorName: string,
  symbol: string
): T[] {
  if (indicator.length === barsLength) {
    return indicator;
  }

  if (indicator.length === 0) {
    logger.warn(`${symbol}: ${indicatorName} is empty, filling with NaN`);
    return new Array(barsLength).fill(NaN as unknown as T);
  }

  if (indicator.length > barsLength) {
    logger.warn(`${symbol}: ${indicatorName} longer than bars (${indicator.length} > ${barsLength}), trimming oldest`);
    return indicator.slice(indicator.length - barsLength);
  }

  const padCount = barsLength - indicator.length;
  logger.warn(`${symbol}: ${indicatorName} shorter than bars (${indicator.length} < ${barsLength}), padding with NaN`);
  const padding = new Array(padCount).fill(NaN as unknown as T);
  return [...padding, ...indicator];
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

  const barsLength = bars.length;

  const extractAndPad = (
    arr: { timestamp: string; value: number | null }[] | undefined,
    name: string
  ): number[] => {
    if (!arr || arr.length === 0) {
      logger.warn(`${symbol}: ${name} is empty, filling with NaN`);
      return new Array(barsLength).fill(NaN);
    }
    const values = arr.map(v => (v.value !== null && v.value !== undefined ? v.value : NaN));
    return padIndicatorToBarsLength(values, barsLength, name, symbol);
  };

  const stochRaw = oldData.stoch?.map(s => ({ k: s.k, d: s.d })) || [];
  const stochData = padIndicatorToBarsLength(stochRaw, barsLength, 'stoch', symbol);

  const bbandsRaw = oldData.bbands?.map(b => ({ 
    upper: b.upper, 
    middle: b.middle, 
    lower: b.lower 
  })) || [];
  const bbandsData = padIndicatorToBarsLength(bbandsRaw, barsLength, 'bbands', symbol);

  const macdRaw = oldData.macd?.map(m => ({
    macd: m.macd,
    signal: m.signal,
    histogram: m.histogram,
  })) || [];
  const macdData = padIndicatorToBarsLength(macdRaw, barsLength, 'macd', symbol);

  // Convert H4 trend data if available
  const trendBarsH4: Bar[] | undefined = oldData.trendBarsH4?.map(b => ({
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
  
  const ema200H4: number[] | undefined = oldData.ema200H4
    ? oldData.ema200H4.map(v => (v.value !== null && v.value !== undefined ? v.value : NaN))
    : undefined;
    
  const adxH4: number[] | undefined = oldData.adxH4
    ? oldData.adxH4.map(v => (v.value !== null && v.value !== undefined ? v.value : NaN))
    : undefined;

  return {
    symbol,
    bars,
    ema20: extractAndPad(oldData.ema20, 'ema20'),
    ema50: extractAndPad(oldData.ema50, 'ema50'),
    ema200: extractAndPad(oldData.ema200, 'ema200'),
    sma20: extractAndPad(oldData.sma20, 'sma20'),
    rsi: extractAndPad(oldData.rsi, 'rsi'),
    stoch: stochData,
    willr: extractAndPad(oldData.willr, 'willr'),
    cci: extractAndPad(oldData.cci, 'cci'),
    bbands: bbandsData,
    atr: extractAndPad(oldData.atr, 'atr'),
    adx: extractAndPad(oldData.adx, 'adx'),
    ema8: extractAndPad(oldData.ema8, 'ema8'),
    ema21: extractAndPad(oldData.ema21, 'ema21'),
    ema55: extractAndPad(oldData.ema55, 'ema55'),
    macd: macdData,
    obv: extractAndPad(oldData.obv, 'obv'),
    // H4 Trend Data
    trendBarsH4,
    ema200H4,
    adxH4,
    trendTimeframeUsed: oldData.trendTimeframeUsed,
    trendFallbackUsed: oldData.trendFallbackUsed,
  };
}

export interface AnalysisOptions {
  skipCooldown?: boolean;
  skipCache?: boolean;
  skipVolatility?: boolean;
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
  settings: UserSettings,
  options: AnalysisOptions = {}
): Promise<StrategyAnalysisResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  logger.info(`Analyzing ${symbol} with strategy ${strategyId}`);
  
  // Check for cached actionable decision first (skip if force refresh)
  if (!options.skipCache) {
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
    
    // Check for cached no-trade decision (shorter TTL to allow quick re-checks)
    const noTradeCacheKey = makeNoTradeCacheKey(symbol, strategyId);
    const cachedNoTrade = cache.get<StrategyDecision>(noTradeCacheKey);
    if (cachedNoTrade) {
      logger.debug(`Cache HIT for no-trade: ${symbol}:${strategyId}`);
      return {
        decision: cachedNoTrade,
        fromCache: true,
        strategyId,
        errors: [],
      };
    }
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
    decision.displayName = getInstrumentSpec(symbol)?.displayName || symbol;
    
    const meta = strategyRegistry.getMeta(strategyId);
    if (meta?.timeframes) {
      decision.timeframes = meta.timeframes;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // SAFETY GATE CHECKS
    // ════════════════════════════════════════════════════════════════════════════
    
    const direction = decision.direction;
    const grade = decision.grade;
    
    // 1. VOLATILITY GATE CHECK
    const atrValues = oldIndicators.atr?.map(v => v.value).filter((v): v is number => v !== null) || [];
    const currentAtr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;
    
    let volatilityCheck: VolatilityCheck = { 
      allowed: true, 
      level: 'normal' as VolatilityLevel, 
      currentAtr, 
      averageAtr: currentAtr, 
      ratio: 1, 
      reason: '' 
    };
    
    if (!options.skipVolatility && atrValues.length >= 5) {
      volatilityCheck = checkVolatility(symbol, currentAtr, atrValues);
    }
    
    // 2. COOLDOWN CHECK (only if we have a trade signal)
    let cooldownCheck: CooldownCheck = { allowed: true, reason: '' };
    if (grade !== 'no-trade' && !options.skipCooldown) {
      cooldownCheck = signalCooldown.check(symbol, settings.style, direction, grade);
    }
    
    // 3. BUILD GATING INFO
    const gating: GatingInfo = {
      cooldownBlocked: !cooldownCheck.allowed,
      cooldownReason: cooldownCheck.reason || undefined,
      volatilityBlocked: !volatilityCheck.allowed,
      volatilityLevel: volatilityCheck.level as VolatilityLevel,
      volatilityReason: volatilityCheck.reason || undefined,
    };
    
    decision.gating = gating;
    
    // 4. APPLY GATING - Volatility takes precedence
    let isBlocked = false;
    const originalReason = decision.reason;
    
    if (!volatilityCheck.allowed && grade !== 'no-trade') {
      decision.reason = `${volatilityCheck.reason} (Original: ${originalReason})`;
      isBlocked = true;
      logger.info(`${symbol}/${strategyId}: Blocked by volatility gate - ${volatilityCheck.reason}`);
    } else if (!cooldownCheck.allowed && grade !== 'no-trade') {
      decision.reason = `${cooldownCheck.reason} (Original: ${originalReason})`;
      isBlocked = true;
      logger.info(`${symbol}/${strategyId}: Blocked by cooldown - ${cooldownCheck.reason}`);
    }
    
    // 5. RECORD SIGNAL IN COOLDOWN (only if not blocked by volatility or cooldown)
    if (!isBlocked && grade !== 'no-trade') {
      signalCooldown.record(
        symbol,
        settings.style,
        direction,
        grade,
        decision.validUntil
      );
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // GRADE UPGRADE DETECTION
    // ════════════════════════════════════════════════════════════════════════════
    
    // Always track grades to detect no-trade → trade transitions
    // Only attach upgrade info if not blocked
    const upgrade = gradeTracker.updateGrade(
      symbol,
      strategyId,
      decision.strategyName,
      decision.grade,
      decision.direction
    );
    
    if (upgrade && !isBlocked) {
      decision.upgrade = upgrade;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CACHE DECISION
    // ════════════════════════════════════════════════════════════════════════════
    
    const cacheKey = makeDecisionCacheKey(symbol, strategyId);
    const noTradeCacheKey = makeNoTradeCacheKey(symbol, strategyId);
    
    if (!options.skipCache) {
      // Don't cache blocked decisions as actionable - treat them as no-trade for caching
      if (decision.grade === 'no-trade' || isBlocked) {
        cache.set(noTradeCacheKey, decision, NO_TRADE_CACHE_TTL);
        logger.debug(`Cached no-trade/blocked decision: ${symbol}:${strategyId} (TTL: ${NO_TRADE_CACHE_TTL}s)`);
      } else {
        cache.set(cacheKey, decision, DECISION_CACHE_TTL);
        logger.debug(`Cached actionable decision: ${symbol}:${strategyId}`);
      }
    }
  }
  
  const elapsed = Date.now() - startTime;
  const gatingTags = decision?.gating 
    ? `${decision.gating.cooldownBlocked ? ' [COOLDOWN]' : ''}${decision.gating.volatilityBlocked ? ' [VOL-BLOCKED]' : ''}`
    : '';
  logger.info(`Strategy analysis complete for ${symbol}: ${decision?.grade || 'no-trade'} (${elapsed}ms)${gatingTags}`);
  
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
    displayName: getInstrumentSpec(symbol)?.displayName || symbol,
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

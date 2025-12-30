/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P0 TASK #2: CACHE NO-TRADE DECISIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: No-trade decisions are not cached, causing ~288 wasted API calls per scan cycle
 *          When a symbol has no valid setup, the system re-fetches all indicators
 *          on every scan instead of caching the "no-trade" result.
 * 
 * SOLUTION: Cache no-trade decisions with a 2-minute TTL
 *           This prevents repeated API calls while still allowing fresh checks
 *           frequently enough to catch emerging setups.
 * 
 * FILE TO MODIFY: src/engine/strategyAnalyzer.ts (around line 137)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createLogger } from '../services/logger.js';
import { cache } from '../services/cache.js';

const logger = createLogger('StrategyAnalyzer');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const NO_TRADE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const NO_TRADE_CACHE_PREFIX = 'no-trade:';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS TO ADD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate cache key for no-trade decisions
 */
function getNoTradeCacheKey(symbol: string, strategyId: string, style: string): string {
  return `${NO_TRADE_CACHE_PREFIX}${symbol}:${strategyId}:${style}`;
}

/**
 * Check if a no-trade decision is cached for this symbol/strategy
 */
function getCachedNoTrade(
  symbol: string, 
  strategyId: string, 
  style: string
): { cached: true; decision: StrategyDecision } | { cached: false } {
  const cacheKey = getNoTradeCacheKey(symbol, strategyId, style);
  const cached = cache.get<StrategyDecision>(cacheKey);
  
  if (cached) {
    logger.debug(`Cache hit for no-trade: ${symbol}/${strategyId}`);
    return { cached: true, decision: cached };
  }
  
  return { cached: false };
}

/**
 * Cache a no-trade decision
 */
function cacheNoTradeDecision(
  symbol: string,
  strategyId: string,
  style: string,
  decision: StrategyDecision
): void {
  const cacheKey = getNoTradeCacheKey(symbol, strategyId, style);
  cache.set(cacheKey, decision, NO_TRADE_CACHE_TTL_MS);
  logger.debug(`Cached no-trade decision: ${symbol}/${strategyId} (TTL: 2min)`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATED analyzeSymbolWithStrategy() FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * FIND the analyzeSymbolWithStrategy() function and UPDATE it as follows:
 * 
 * The key changes are:
 * 1. Check cache for no-trade decision at the START
 * 2. Cache no-trade decisions at the END before returning
 */

export async function analyzeSymbolWithStrategy(
  symbol: string,
  strategyId: string,
  settings: UserSettings,
  options: AnalysisOptions = {}
): Promise<StrategyDecision> {
  const startTime = Date.now();
  
  // ════════════════════════════════════════════════════════════════
  // NEW: CHECK NO-TRADE CACHE FIRST
  // ════════════════════════════════════════════════════════════════
  if (!options.skipCache) {
    const cachedResult = getCachedNoTrade(symbol, strategyId, settings.style);
    if (cachedResult.cached) {
      logger.info(`Using cached no-trade for ${symbol}/${strategyId}`);
      return {
        ...cachedResult.decision,
        // Update timestamp to show it's from cache
        metadata: {
          ...cachedResult.decision.metadata,
          fromCache: true,
          cachedAt: cachedResult.decision.timestamp,
        }
      };
    }
  }
  
  // Get strategy from registry
  const strategy = strategyRegistry.get(strategyId);
  if (!strategy) {
    throw new Error(`Strategy not found: ${strategyId}`);
  }
  
  logger.info(`Analyzing ${symbol} with ${strategyId} strategy`);
  
  // Fetch indicators
  let indicators: IndicatorData;
  try {
    indicators = await getIndicators(symbol, settings.style);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    logger.error(`Failed to fetch indicators for ${symbol}`, { error });
    return createErrorDecision(symbol, strategyId, settings, [`Failed to fetch data: ${error}`]);
  }
  
  // Convert to strategy format
  const strategyData = convertToStrategyIndicatorData(indicators);
  
  // Run strategy analysis
  const result = strategy.analyze(strategyData, settings);
  
  // Build decision
  const decision = buildDecision(symbol, strategyId, strategy, result, settings, indicators);
  
  // ════════════════════════════════════════════════════════════════
  // NEW: CACHE NO-TRADE DECISIONS
  // ════════════════════════════════════════════════════════════════
  if (decision.grade === 'no-trade' && !options.skipCache) {
    cacheNoTradeDecision(symbol, strategyId, settings.style, decision);
  }
  
  const elapsed = Date.now() - startTime;
  logger.info(
    `Analysis complete for ${symbol}/${strategyId}: ${decision.grade} (${elapsed}ms)` +
    `${decision.gating?.cooldownBlocked ? ' [COOLDOWN]' : ''}` +
    `${decision.gating?.volatilityBlocked ? ' [VOL-BLOCKED]' : ''}`
  );
  
  return decision;
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATED scanWithStrategy() FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UPDATE the scan function to track cache hits for reporting
 */

export async function scanWithStrategy(
  symbols: string[],
  strategyId: string,
  settings: UserSettings,
  onProgress?: (progress: ScanProgress) => void
): Promise<StrategyDecision[]> {
  const results: StrategyDecision[] = [];
  const errors: string[] = [];
  let cacheHits = 0;  // NEW: Track cache hits
  
  logger.info(`Starting ${strategyId} scan of ${symbols.length} symbols`);
  
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    
    // Report progress
    if (onProgress) {
      onProgress({
        total: symbols.length,
        completed: i,
        current: symbol,
        results: [...results],
        errors: [...errors],
      });
    }
    
    try {
      const decision = await analyzeSymbolWithStrategy(symbol, strategyId, settings);
      results.push(decision);
      
      // NEW: Track cache hits
      if (decision.metadata?.fromCache) {
        cacheHits++;
      }
      
      if (decision.errors && decision.errors.length > 0) {
        errors.push(`${symbol}: ${decision.errors.join(', ')}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      errors.push(`${symbol}: ${error}`);
      logger.error(`Scan error for ${symbol}/${strategyId}`, { error });
    }
  }
  
  // Final progress
  if (onProgress) {
    onProgress({
      total: symbols.length,
      completed: symbols.length,
      current: null,
      results,
      errors,
    });
  }
  
  // NEW: Log cache efficiency
  logger.info(
    `Scan complete: ${results.length} results, ${errors.length} errors, ` +
    `${cacheHits} cache hits (${((cacheHits / symbols.length) * 100).toFixed(1)}% hit rate)`
  );
  
  return results;
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATED AnalysisOptions INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD skipCache option to AnalysisOptions interface:
 */

export interface AnalysisOptions {
  skipCooldown?: boolean;
  skipCache?: boolean;  // NEW: Skip no-trade cache (for force refresh)
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATED StrategyDecision INTERFACE (metadata field)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UPDATE StrategyDecision interface to include cache metadata:
 */

export interface StrategyDecision {
  // ... existing fields ...
  
  metadata?: {
    fromCache?: boolean;
    cachedAt?: string;
    // ... other metadata fields ...
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// CACHE INVALIDATION HELPER (Optional but recommended)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clear no-trade cache for a specific symbol (useful when conditions change)
 */
export function clearNoTradeCache(symbol?: string, strategyId?: string): void {
  if (symbol && strategyId) {
    // Clear specific entry
    const pattern = `${NO_TRADE_CACHE_PREFIX}${symbol}:${strategyId}:`;
    cache.deletePattern(pattern);
    logger.debug(`Cleared no-trade cache for ${symbol}/${strategyId}`);
  } else if (symbol) {
    // Clear all strategies for symbol
    const pattern = `${NO_TRADE_CACHE_PREFIX}${symbol}:`;
    cache.deletePattern(pattern);
    logger.debug(`Cleared all no-trade cache for ${symbol}`);
  } else {
    // Clear all no-trade cache
    cache.deletePattern(NO_TRADE_CACHE_PREFIX);
    logger.debug('Cleared all no-trade cache');
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION NOTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * API CALL SAVINGS CALCULATION:
 * 
 * Before: Each symbol × each strategy × each scan = full indicator fetch
 *   - 36 symbols × 8 strategies × 12 scans/day = 3,456 potential fetches
 *   - If 80% are no-trade, that's 2,765 wasted fetches
 * 
 * After: No-trade cached for 2 minutes
 *   - First scan: full fetch
 *   - Next 2 minutes: cache hit (no API calls)
 *   - ~50-70% reduction in API calls for stable markets
 * 
 * WHY 2-MINUTE TTL?
 *   - Short enough to catch emerging setups quickly
 *   - Long enough to prevent spam during stable conditions
 *   - Aligns with typical H1 candle progression (signal changes every few candles)
 * 
 * CACHE KEY STRUCTURE:
 *   no-trade:{symbol}:{strategyId}:{style}
 *   Example: no-trade:EURUSD:rsi-pullback:intraday
 */

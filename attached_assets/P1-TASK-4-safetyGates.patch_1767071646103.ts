/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P1 TASK #4: INTEGRATE SAFETY GATES INTO STRATEGY ANALYZER
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: The multi-strategy system in strategyAnalyzer.ts bypasses the safety
 *          gates (signalCooldown and volatilityGate) that exist in decisionEngine.ts
 *          
 *          This means:
 *          - Duplicate signals can fire for the same symbol/direction
 *          - Extreme volatility conditions don't block signals
 *          - Risk management is compromised
 * 
 * SOLUTION: Import and call both safety gates before returning any trade decision
 *           in the strategyAnalyzer.ts module.
 * 
 * FILE TO MODIFY: src/engine/strategyAnalyzer.ts
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: ADD IMPORTS (at top of strategyAnalyzer.ts)
// ═══════════════════════════════════════════════════════════════════════════════

import { signalCooldown, CooldownCheck } from '../services/signalCooldown.js';
import { checkVolatility, VolatilityCheck, VolatilityLevel } from '../services/volatilityGate.js';
import { getLatestValue } from './indicatorService.js';


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: UPDATE StrategyDecision INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ADD the gating field to StrategyDecision interface if not present:
 */
export interface StrategyDecision {
  symbol: string;
  strategyId: string;
  strategyName: string;
  direction: 'long' | 'short' | 'none';
  grade: 'A+' | 'B' | 'no-trade';
  status: 'ready' | 'building' | 'invalid' | 'cooldown' | 'volatility-blocked';
  
  // Entry details
  entryZone: {
    low: number;
    high: number;
    formatted: string;
  } | null;
  
  // Risk management
  stopLoss: {
    price: number;
    pips: number;
    method: 'swing' | 'atr';
    formatted: string;
  } | null;
  
  takeProfit: {
    price: number;
    pips: number;
    riskReward: number;
    formatted: string;
  } | null;
  
  position: PositionSize | null;
  
  // Analysis details
  reason: string;
  details: StrategyDetails;
  
  // Timing
  timestamp: string;
  validUntil: string;
  timeframes: {
    trend: string;
    entry: string;
  };
  
  // ════════════════════════════════════════════════════════════════
  // GATING - ADD THIS FIELD
  // ════════════════════════════════════════════════════════════════
  gating: {
    cooldownBlocked: boolean;
    cooldownReason?: string;
    cooldownUntil?: string;
    volatilityBlocked: boolean;
    volatilityLevel: VolatilityLevel;
    volatilityReason?: string;
  };
  
  // Metadata
  errors: string[];
  metadata?: {
    fromCache?: boolean;
    cachedAt?: string;
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: UPDATE analyzeSymbolWithStrategy() FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * FIND the analyzeSymbolWithStrategy() function and ADD safety gate checks
 * AFTER the strategy analysis but BEFORE returning the decision.
 */

export async function analyzeSymbolWithStrategy(
  symbol: string,
  strategyId: string,
  settings: UserSettings,
  options: AnalysisOptions = {}
): Promise<StrategyDecision> {
  const startTime = Date.now();
  
  // Check no-trade cache first (from Task #2)
  if (!options.skipCache) {
    const cachedResult = getCachedNoTrade(symbol, strategyId, settings.style);
    if (cachedResult.cached) {
      logger.info(`Using cached no-trade for ${symbol}/${strategyId}`);
      return cachedResult.decision;
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
  
  // ════════════════════════════════════════════════════════════════════════════
  // NEW: SAFETY GATE CHECKS
  // ════════════════════════════════════════════════════════════════════════════
  
  // Determine initial direction from strategy result
  let direction: 'long' | 'short' | 'none' = 'none';
  if (result.grade !== 'no-trade' && result.signal) {
    direction = result.signal.direction;
  }
  
  // 1. VOLATILITY GATE CHECK
  const currentAtr = getLatestValue(indicators.atr) || 0;
  const atrHistory = indicators.atr
    .filter(v => v.value !== null)
    .map(v => v.value as number);
  
  const volatilityCheck = checkVolatility(symbol, currentAtr, atrHistory);
  
  // 2. COOLDOWN CHECK (only if we have a trade signal)
  let cooldownCheck: CooldownCheck = { allowed: true, reason: '' };
  if (direction !== 'none' && !options.skipCooldown) {
    cooldownCheck = signalCooldown.check(
      symbol,
      settings.style,
      direction,
      result.grade
    );
  }
  
  // 3. APPLY GATING RESULTS
  let finalStatus = result.status;
  let finalReason = result.reason;
  let finalDirection = direction;
  let finalGrade = result.grade;
  
  // Volatility gate takes precedence
  if (!volatilityCheck.allowed && direction !== 'none') {
    finalStatus = 'volatility-blocked';
    finalReason = volatilityCheck.reason;
    finalDirection = 'none';
    finalGrade = 'no-trade';
    logger.info(`${symbol}/${strategyId}: Blocked by volatility gate - ${volatilityCheck.reason}`);
  }
  // Then cooldown check
  else if (!cooldownCheck.allowed && direction !== 'none') {
    finalStatus = 'cooldown';
    finalReason = cooldownCheck.reason;
    // Keep direction and grade for display, but mark as cooldown
    logger.info(`${symbol}/${strategyId}: Blocked by cooldown - ${cooldownCheck.reason}`);
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // END SAFETY GATE CHECKS
  // ════════════════════════════════════════════════════════════════════════════
  
  // Build decision with gating info
  const decision = buildDecision(
    symbol,
    strategyId,
    strategy,
    {
      ...result,
      status: finalStatus,
      reason: finalReason,
      grade: finalGrade,
      signal: result.signal ? { ...result.signal, direction: finalDirection } : null,
    },
    settings,
    indicators
  );
  
  // Add gating information to decision
  decision.gating = {
    cooldownBlocked: !cooldownCheck.allowed && !options.skipCooldown,
    cooldownReason: cooldownCheck.reason || undefined,
    cooldownUntil: cooldownCheck.until || undefined,
    volatilityBlocked: !volatilityCheck.allowed,
    volatilityLevel: volatilityCheck.level,
    volatilityReason: volatilityCheck.reason || undefined,
  };
  
  // Record signal in cooldown (only if not blocked)
  if (
    finalDirection !== 'none' &&
    !decision.gating.cooldownBlocked &&
    !decision.gating.volatilityBlocked
  ) {
    const validUntil = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours default
    signalCooldown.record(
      symbol,
      settings.style,
      finalDirection,
      finalGrade,
      validUntil.toISOString()
    );
  }
  
  // Cache no-trade decisions (from Task #2)
  if (decision.grade === 'no-trade' && !options.skipCache) {
    cacheNoTradeDecision(symbol, strategyId, settings.style, decision);
  }
  
  const elapsed = Date.now() - startTime;
  logger.info(
    `Analysis complete for ${symbol}/${strategyId}: ${decision.grade} (${elapsed}ms)` +
    `${decision.gating.cooldownBlocked ? ' [COOLDOWN]' : ''}` +
    `${decision.gating.volatilityBlocked ? ' [VOL-BLOCKED]' : ''}`
  );
  
  return decision;
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: UPDATE AnalysisOptions INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

export interface AnalysisOptions {
  skipCooldown?: boolean;  // Skip cooldown check (for force refresh)
  skipCache?: boolean;     // Skip no-trade cache (from Task #2)
  skipVolatility?: boolean; // Skip volatility check (rarely used)
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: UPDATE buildDecision() TO INCLUDE DEFAULT GATING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UPDATE the buildDecision() helper to include default gating values
 */
function buildDecision(
  symbol: string,
  strategyId: string,
  strategy: Strategy,
  result: StrategyResult,
  settings: UserSettings,
  indicators: IndicatorData
): StrategyDecision {
  const now = new Date();
  const styleConfig = getStyleConfig(settings.style);
  const validUntil = new Date(now.getTime() + styleConfig.validCandles * 60 * 60 * 1000);
  
  // ... existing buildDecision logic ...
  
  return {
    symbol,
    strategyId,
    strategyName: strategy.meta.name,
    direction: result.signal?.direction || 'none',
    grade: result.grade,
    status: result.status,
    entryZone: result.signal?.entryZone || null,
    stopLoss: result.signal?.stopLoss || null,
    takeProfit: result.signal?.takeProfit || null,
    position: result.signal?.position || null,
    reason: result.reason,
    details: result.details,
    timestamp: now.toISOString(),
    validUntil: validUntil.toISOString(),
    timeframes: {
      trend: styleConfig.trendTimeframe,
      entry: styleConfig.entryTimeframe,
    },
    // Default gating - will be overwritten by caller
    gating: {
      cooldownBlocked: false,
      volatilityBlocked: false,
      volatilityLevel: 'normal',
    },
    errors: indicators.errors,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: UPDATE createErrorDecision() TO INCLUDE GATING
// ═══════════════════════════════════════════════════════════════════════════════

function createErrorDecision(
  symbol: string,
  strategyId: string,
  settings: UserSettings,
  errors: string[]
): StrategyDecision {
  const now = new Date();
  const styleConfig = getStyleConfig(settings.style);
  
  return {
    symbol,
    strategyId,
    strategyName: 'Unknown',
    direction: 'none',
    grade: 'no-trade',
    status: 'invalid',
    entryZone: null,
    stopLoss: null,
    takeProfit: null,
    position: null,
    reason: errors[0] || 'Analysis failed',
    details: {} as StrategyDetails,
    timestamp: now.toISOString(),
    validUntil: now.toISOString(),
    timeframes: {
      trend: styleConfig.trendTimeframe,
      entry: styleConfig.entryTimeframe,
    },
    // Include gating even for error decisions
    gating: {
      cooldownBlocked: false,
      volatilityBlocked: false,
      volatilityLevel: 'normal',
    },
    errors,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// REFERENCE: signalCooldown SERVICE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The signalCooldown service should already exist in src/services/signalCooldown.ts
 * with these methods. If not, here's the expected interface:
 */

/*
export interface CooldownCheck {
  allowed: boolean;
  reason: string;
  until?: string;  // ISO timestamp when cooldown expires
}

export const signalCooldown = {
  check(
    symbol: string,
    style: TradingStyle,
    direction: 'long' | 'short',
    grade: Grade
  ): CooldownCheck,
  
  record(
    symbol: string,
    style: TradingStyle,
    direction: 'long' | 'short',
    grade: Grade,
    validUntil: string
  ): void,
  
  clear(symbol?: string): void,
};
*/


// ═══════════════════════════════════════════════════════════════════════════════
// REFERENCE: volatilityGate SERVICE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The volatilityGate service should already exist in src/services/volatilityGate.ts
 * with these methods. If not, here's the expected interface:
 */

/*
export type VolatilityLevel = 'low' | 'normal' | 'high' | 'extreme';

export interface VolatilityCheck {
  allowed: boolean;
  level: VolatilityLevel;
  reason: string;
  currentAtr: number;
  averageAtr: number;
  ratio: number;
}

export function checkVolatility(
  symbol: string,
  currentAtr: number,
  atrHistory: number[]
): VolatilityCheck;
*/


// ═══════════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION NOTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SAFETY GATE LOGIC:
 * 
 * 1. VOLATILITY GATE (checked first, takes precedence)
 *    - Compares current ATR to historical average
 *    - Blocks if ATR > 2x average ("extreme" volatility)
 *    - Warns if ATR > 1.5x average ("high" volatility)
 *    - Purpose: Avoid entries during news spikes, flash crashes
 * 
 * 2. SIGNAL COOLDOWN (checked second)
 *    - Tracks recently fired signals by symbol/direction/grade
 *    - Blocks duplicate signals within cooldown window
 *    - A+ signals have shorter cooldown than B signals
 *    - Purpose: Prevent signal spam, avoid duplicate entries
 * 
 * GATE PRIORITY:
 *    Volatility > Cooldown > Trade Signal
 * 
 *    If volatility blocks → status = 'volatility-blocked', direction = 'none'
 *    If cooldown blocks → status = 'cooldown', direction preserved for display
 *    If both pass → normal signal returned
 * 
 * FORCE REFRESH:
 *    Use options.skipCooldown = true to bypass cooldown (manual refresh button)
 *    Volatility gate cannot be skipped (safety critical)
 */

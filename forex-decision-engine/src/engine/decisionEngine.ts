/**
 * Decision Engine
 * Main orchestrator that combines all analysis into a final decision
 * 
 * Includes:
 * - Signal Cooldown (prevents duplicate signals)
 * - Volatility Gating (filters extreme conditions)
 */

import { TradingStyle, getStyleConfig } from '../config/strategy.js';
import { STRATEGY } from '../config/strategy.js';
import { DEFAULTS } from '../config/defaults.js';
import { getDisplayName, getPipDecimals } from '../config/universe.js';
import { fetchIndicators, IndicatorData, getLatestValue, findSwingHigh, findSwingLow } from './indicatorService.js';
import { analyzeTrend, TrendAnalysis, TrendDirection } from './trendFilter.js';
import { analyzeEntry, EntryAnalysis } from './entryTrigger.js';
import { 
  calculatePositionSize, 
  calculateStopLoss, 
  calculateTakeProfit,
  PositionSize,
  formatPrice 
} from './positionSizer.js';
import { calculateGrade, Grade, GradeResult, getGradeEmoji } from './grader.js';
import { createLogger } from '../services/logger.js';
import { signalCooldown, CooldownCheck } from '../services/signalCooldown.js';
import { checkVolatility, VolatilityCheck, VolatilityLevel } from '../services/volatilityGate.js';

const logger = createLogger('DecisionEngine');

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type Direction = 'long' | 'short' | 'none';

export interface Decision {
  // Identity
  symbol: string;
  displayName: string;
  style: TradingStyle;
  
  // Decision
  direction: Direction;
  grade: Grade;
  status: 'ready' | 'building' | 'invalid' | 'cooldown' | 'volatility-blocked';
  
  // Trade parameters (only if direction !== 'none')
  entryZone: {
    low: number;
    high: number;
    formatted: string;
  } | null;
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
  
  // Explanation
  reason: string;
  details: {
    trend: TrendAnalysis;
    entry: EntryAnalysis;
    grade: GradeResult;
    volatility?: VolatilityCheck;
    cooldown?: CooldownCheck;
  };
  
  // Metadata
  timestamp: string;
  validUntil: string;
  validCandles: number;
  timeframes: {
    trend: string;
    entry: string;
  };
  
  // Gating status
  gating: {
    cooldownBlocked: boolean;
    volatilityBlocked: boolean;
    volatilityLevel: VolatilityLevel;
  };
  
  // Errors
  errors: string[];
}

export interface UserSettings {
  accountSize: number;
  riskPercent: number;
  style: TradingStyle;
  timezone?: string;
}

// ═══════════════════════════════════════════════════════════════
// DECISION ENGINE
// ═══════════════════════════════════════════════════════════════

export async function analyzeSymbol(
  symbol: string,
  settings: UserSettings,
  options: { skipCooldown?: boolean } = {}
): Promise<Decision> {
  const startTime = Date.now();
  const styleConfig = getStyleConfig(settings.style);
  const errors: string[] = [];
  
  logger.info(`Analyzing ${symbol} with ${settings.style} style`);
  
  // ═══════════════════════════════════════════════════════════════
  // 1. FETCH INDICATORS
  // ═══════════════════════════════════════════════════════════════
  
  let indicators: IndicatorData;
  try {
    indicators = await fetchIndicators(symbol, settings.style);
    errors.push(...indicators.errors);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    logger.error(`Failed to fetch indicators for ${symbol}`, { error });
    return createErrorDecision(symbol, settings, [`Failed to fetch data: ${error}`]);
  }
  
  // Check minimum data
  if (indicators.entryBars.length < 50 || indicators.trendBars.length < 20) {
    return createErrorDecision(symbol, settings, ['Insufficient price data']);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 2. VOLATILITY CHECK
  // ═══════════════════════════════════════════════════════════════
  
  const currentAtr = getLatestValue(indicators.atr) || 0;
  const atrHistory = indicators.atr
    .filter(v => v.value !== null)
    .map(v => v.value as number);
  
  const volatilityCheck = checkVolatility(symbol, currentAtr, atrHistory);
  
  // ═══════════════════════════════════════════════════════════════
  // 3. ANALYZE TREND
  // ═══════════════════════════════════════════════════════════════
  
  const trend = analyzeTrend(indicators);
  
  // ═══════════════════════════════════════════════════════════════
  // 4. ANALYZE ENTRY
  // ═══════════════════════════════════════════════════════════════
  
  const entry = analyzeEntry(indicators, trend.direction);
  
  // ═══════════════════════════════════════════════════════════════
  // 5. CALCULATE GRADE
  // ═══════════════════════════════════════════════════════════════
  
  const gradeResult = calculateGrade(trend, entry);
  
  // ═══════════════════════════════════════════════════════════════
  // 6. DETERMINE DIRECTION & CHECK COOLDOWN
  // ═══════════════════════════════════════════════════════════════
  
  const now = new Date();
  const validUntil = new Date(now.getTime() + styleConfig.validCandles * 60 * 60 * 1000);
  
  // Determine direction
  let direction: Direction = 'none';
  if (gradeResult.grade !== 'no-trade' && trend.direction !== 'none') {
    direction = trend.direction === 'bullish' ? 'long' : 'short';
  }
  
  // Check cooldown (only for actual trade signals)
  const cooldownCheck = signalCooldown.check(
    symbol,
    settings.style,
    direction,
    gradeResult.grade
  );
  
  // Determine final status based on gating
  let finalStatus: Decision['status'] = entry.status;
  let finalReason = gradeResult.reason;
  let finalDirection = direction;
  let finalGrade = gradeResult.grade;
  
  // Volatility gate takes precedence
  if (!volatilityCheck.allowed && direction !== 'none') {
    finalStatus = 'volatility-blocked';
    finalReason = volatilityCheck.reason;
    finalDirection = 'none';
    finalGrade = 'no-trade';
    logger.info(`${symbol}: Blocked by volatility gate - ${volatilityCheck.reason}`);
  }
  // Then cooldown check (unless skipped for force refresh)
  else if (!cooldownCheck.allowed && !options.skipCooldown && direction !== 'none') {
    finalStatus = 'cooldown';
    finalReason = cooldownCheck.reason;
    // Keep direction and grade for display, but mark as cooldown
    logger.info(`${symbol}: Blocked by cooldown - ${cooldownCheck.reason}`);
  }
  
  // Build base decision
  const decision: Decision = {
    symbol,
    displayName: getDisplayName(symbol),
    style: settings.style,
    direction: finalDirection,
    grade: finalGrade,
    status: finalStatus,
    entryZone: null,
    stopLoss: null,
    takeProfit: null,
    position: null,
    reason: finalReason,
    details: {
      trend,
      entry,
      grade: gradeResult,
      volatility: volatilityCheck,
      cooldown: cooldownCheck,
    },
    timestamp: now.toISOString(),
    validUntil: validUntil.toISOString(),
    validCandles: styleConfig.validCandles,
    timeframes: {
      trend: styleConfig.trendTimeframe,
      entry: styleConfig.entryTimeframe,
    },
    gating: {
      cooldownBlocked: !cooldownCheck.allowed && !options.skipCooldown,
      volatilityBlocked: !volatilityCheck.allowed,
      volatilityLevel: volatilityCheck.level,
    },
    errors,
  };
  
  // ═══════════════════════════════════════════════════════════════
  // 6. CALCULATE TRADE PARAMETERS (if valid trade)
  // ═══════════════════════════════════════════════════════════════
  
  if (direction !== 'none' && entry.status === 'ready') {
    const pipDecimals = getPipDecimals(symbol);
    
    // Entry zone
    decision.entryZone = {
      low: entry.entryZoneLow,
      high: entry.entryZoneHigh,
      formatted: `${formatPrice(entry.entryZoneLow, symbol)} - ${formatPrice(entry.entryZoneHigh, symbol)}`,
    };
    
    // Stop loss
    const swingLevel = direction === 'long'
      ? findSwingLow(indicators.entryBars, STRATEGY.stopLoss.swingLookback)
      : findSwingHigh(indicators.entryBars, STRATEGY.stopLoss.swingLookback);
    
    const atr = getLatestValue(indicators.atr) || indicators.currentPrice * 0.01;
    const entryPrice = (entry.entryZoneLow + entry.entryZoneHigh) / 2;
    
    const sl = calculateStopLoss(
      entryPrice,
      direction,
      swingLevel,
      atr,
      symbol
    );
    
    decision.stopLoss = {
      price: sl.price,
      pips: sl.pips,
      method: sl.method,
      formatted: `${formatPrice(sl.price, symbol)} (${sl.pips} pips)`,
    };
    
    // Take profit
    const tp = calculateTakeProfit(
      entryPrice,
      sl.price,
      direction,
      STRATEGY.takeProfit.minRR,
      symbol
    );
    
    decision.takeProfit = {
      price: tp.price,
      pips: tp.pips,
      riskReward: tp.riskReward,
      formatted: `${formatPrice(tp.price, symbol)} (${tp.riskReward}R)`,
    };
    
    // Position size
    decision.position = calculatePositionSize({
      symbol,
      entryPrice,
      stopLossPrice: sl.price,
      accountSize: settings.accountSize,
      riskPercent: settings.riskPercent,
    });
    
    // Record signal in cooldown (only if not blocked)
    if (!decision.gating.cooldownBlocked && !decision.gating.volatilityBlocked) {
      signalCooldown.record(
        symbol,
        settings.style,
        direction as 'long' | 'short',
        gradeResult.grade,
        validUntil.toISOString()
      );
    }
  }
  
  const elapsed = Date.now() - startTime;
  logger.info(`Analysis complete for ${symbol}: ${finalGrade} (${elapsed}ms)${decision.gating.cooldownBlocked ? ' [COOLDOWN]' : ''}${decision.gating.volatilityBlocked ? ' [VOL-BLOCKED]' : ''}`);
  
  return decision;
}

// ═══════════════════════════════════════════════════════════════
// BATCH SCANNING
// ═══════════════════════════════════════════════════════════════

export interface ScanProgress {
  total: number;
  completed: number;
  current: string | null;
  results: Decision[];
  errors: string[];
}

export async function scanSymbols(
  symbols: string[],
  settings: UserSettings,
  onProgress?: (progress: ScanProgress) => void
): Promise<Decision[]> {
  const results: Decision[] = [];
  const errors: string[] = [];
  
  logger.info(`Starting scan of ${symbols.length} symbols`);
  
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
      const decision = await analyzeSymbol(symbol, settings);
      results.push(decision);
      
      if (decision.errors.length > 0) {
        errors.push(`${symbol}: ${decision.errors.join(', ')}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      errors.push(`${symbol}: ${error}`);
      logger.error(`Scan error for ${symbol}`, { error });
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
  
  logger.info(`Scan complete: ${results.length} results, ${errors.length} errors`);
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function createErrorDecision(
  symbol: string,
  settings: UserSettings,
  errors: string[]
): Decision {
  const styleConfig = getStyleConfig(settings.style);
  const now = new Date();
  
  return {
    symbol,
    displayName: getDisplayName(symbol),
    style: settings.style,
    direction: 'none',
    grade: 'no-trade',
    status: 'invalid',
    entryZone: null,
    stopLoss: null,
    takeProfit: null,
    position: null,
    reason: errors[0] || 'Analysis failed',
    details: {
      trend: {
        direction: 'none',
        price: 0,
        ema200: 0,
        ema200Slope: 0,
        adx: 0,
        priceAboveEma: false,
        priceBelowEma: false,
        slopePositive: false,
        slopeNegative: false,
        adxAboveThreshold: false,
        adxBorderline: false,
        isStrong: false,
        reason: 'Analysis failed',
      },
      entry: {
        status: 'invalid',
        price: 0,
        ema20: 0,
        ema50: 0,
        rsi: 0,
        rsiPrevious: 0,
        inPullbackZone: false,
        pullbackDepth: 'none',
        rsiWasReset: false,
        rsiTurning: false,
        rsiResetStrength: 0,
        entryZoneLow: 0,
        entryZoneHigh: 0,
        isStrong: false,
        reason: 'Analysis failed',
      },
      grade: {
        grade: 'no-trade',
        score: 0,
        trendScore: 0,
        entryScore: 0,
        momentumScore: 0,
        strengths: [],
        weaknesses: errors,
        reason: errors[0] || 'Analysis failed',
      },
    },
    timestamp: now.toISOString(),
    validUntil: now.toISOString(),
    validCandles: styleConfig.validCandles,
    timeframes: {
      trend: styleConfig.trendTimeframe,
      entry: styleConfig.entryTimeframe,
    },
    gating: {
      cooldownBlocked: false,
      volatilityBlocked: false,
      volatilityLevel: 'normal',
    },
    errors,
  };
}

/**
 * Format decision for display (one-liner)
 */
export function formatDecisionSummary(decision: Decision): string {
  const emoji = getGradeEmoji(decision.grade);
  
  if (decision.grade === 'no-trade') {
    return `${decision.displayName} ${emoji} NO TRADE - ${decision.reason}`;
  }
  
  const dir = decision.direction.toUpperCase();
  return `${decision.displayName} ${emoji} ${dir} ${decision.grade} - ${decision.reason}`;
}

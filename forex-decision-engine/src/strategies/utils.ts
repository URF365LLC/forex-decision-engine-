/**
 * UDO Multi-Strategy System - Shared Utilities
 * Version: 2025-12-29
 * 
 * IMPORTANT: Indicator arrays must be generated 1:1 with bars length, aligned by bar index.
 * Use atIndex() for aligned access - it only works if indicator.length === bars.length.
 */

import { 
  Bar, 
  Decision, 
  SignalDirection, 
  SignalGrade, 
  UserSettings, 
  RequiredIndicator,
  ReasonCode,
  TradingStyle,
  getPipInfo, 
  formatPrice, 
  calculatePips,
  TieredExitPlan,
  ExitTarget 
} from './types.js';
import { createLogger } from '../services/logger.js';
import { getCryptoContractSize, DEFAULTS, LOT_SIZES } from '../config/defaults.js';
import { trackSignal } from '../storage/signalFreshnessTracker.js';
import { formatSignalAge, isStale, formatEntryPrice } from '../utils/timeUtils.js';
import { getInstrumentSpec } from '../config/e8InstrumentSpecs.js';
import { getCurrentSession, TradingSession } from '../utils/timezone.js';

const logger = createLogger('StrategyUtils');

export function latest<T>(arr: T[] | undefined): T | null {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1];
}

export function atIndex<T>(arr: T[] | undefined, idx: number): T | null {
  if (!arr || idx < 0 || idx >= arr.length) return null;
  return arr[idx];
}

export function safeDiv(n: number, d: number, fallback = 0): number {
  return d === 0 ? fallback : n / d;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function validateOrder(
  direction: 'long' | 'short',
  entry: number,
  sl: number,
  tp: number
): boolean {
  if (![entry, sl, tp].every(n => typeof n === 'number' && Number.isFinite(n))) return false;
  if (direction === 'long') return sl < entry && tp > entry;
  return sl > entry && tp < entry;
}

export function isRejectionCandle(
  bar: Bar,
  direction: 'long' | 'short',
  minWickRatio = 0.5,
  maxBodyRatio = 0.5
): { ok: boolean; wickRatio: number; bodyRatio: number } {
  const range = bar.high - bar.low;
  if (range <= 0) return { ok: false, wickRatio: 0, bodyRatio: 0 };

  const body = Math.abs(bar.close - bar.open);
  const bodyRatio = safeDiv(body, range, 1);

  if (direction === 'long') {
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const wickRatio = safeDiv(lowerWick, range, 0);
    const ok = wickRatio >= minWickRatio && bodyRatio <= maxBodyRatio && bar.close > bar.open;
    return { ok, wickRatio, bodyRatio };
  } else {
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const wickRatio = safeDiv(upperWick, range, 0);
    const ok = wickRatio >= minWickRatio && bodyRatio <= maxBodyRatio && bar.close < bar.open;
    return { ok, wickRatio, bodyRatio };
  }
}

export function normalizedSlope(series: number[] | undefined, lookback: number): number {
  if (!series || series.length < lookback + 1) return 0;
  const end = series[series.length - 1];
  const start = series[series.length - 1 - lookback];
  if (!Number.isFinite(end) || !Number.isFinite(start) || start === 0) return 0;

  const raw = end - start;
  const pct = raw / start;
  return pct / lookback;
}

export function validateIndicators(
  data: Record<string, unknown>,
  required: RequiredIndicator[],
  minBars: number = 50
): boolean {
  if (!data.bars || !Array.isArray(data.bars) || data.bars.length < minBars) {
    return false;
  }

  const barsLength = (data.bars as unknown[]).length;
  
  for (const ind of required) {
    if (ind === 'bars') continue;
    const indicator = data[ind];
    if (!indicator || !Array.isArray(indicator)) return false;
    if (indicator.length < minBars) return false;
    if (indicator.length !== barsLength) {
      logger.error('FATAL: Indicator length mismatch - signal generation ABORTED', { 
        indicator: ind, 
        indicatorLength: indicator.length, 
        barsLength,
        difference: Math.abs(indicator.length - barsLength),
        action: 'Trade rejected to prevent data corruption'
      });
      return false;
    }
  }
  return true;
}

export function calculateGrade(confidence: number): SignalGrade {
  if (confidence >= 90) return 'A+';
  if (confidence >= 80) return 'A';
  if (confidence >= 70) return 'B+';
  if (confidence >= 60) return 'B';
  if (confidence >= 50) return 'C';
  return 'no-trade';
}

export interface PositionSizeResult {
  lots: number;
  units: number;
  riskAmount: number;
  isApproximate: boolean;
  isValid: boolean;
  warnings: string[];
}

function getLeverage(symbol: string, isCrypto: boolean): number {
  if (isCrypto) return DEFAULTS.leverage.crypto;
  if (symbol.includes('XAU') || symbol.includes('XAG')) return DEFAULTS.leverage.metals;
  if (symbol.includes('US30') || symbol.includes('NAS') || symbol.includes('SP500')) return DEFAULTS.leverage.indices;
  return DEFAULTS.leverage.forex;
}

export function calculatePositionSize(
  symbol: string,
  accountSize: number,
  riskPercent: number,
  stopLossPips: number,
  entryPrice: number,
  stopLossPrice?: number
): PositionSizeResult {
  const warnings: string[] = [];
  let isValid = true;
  let contractSize: number | null = null;
  
  if (!accountSize || accountSize <= 0 || !isFinite(accountSize)) {
    logger.warn('Invalid account size for position sizing', { symbol, accountSize });
    return { lots: 0, units: 0, riskAmount: 0, isApproximate: false, isValid: false, warnings: ['Invalid account size'] };
  }
  
  if (!riskPercent || riskPercent <= 0 || riskPercent > 100) {
    logger.warn('Invalid risk percent for position sizing', { symbol, riskPercent });
    return { lots: 0, units: 0, riskAmount: 0, isApproximate: false, isValid: false, warnings: ['Invalid risk percent'] };
  }
  
  const riskAmount = accountSize * (riskPercent / 100);
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BNB', 'BCH', 'LTC'].some(c => symbol.includes(c));
  const leverage = getLeverage(symbol, isCrypto);
  
  let lots: number;
  let isApproximate: boolean;
  let marginLimited = false;
  
  if (isCrypto) {
    contractSize = getCryptoContractSize(symbol);
    if (!contractSize) {
      warnings.push('Unknown crypto contract size - sizing halted');
      return { lots: 0, units: 0, riskAmount: 0, isApproximate: false, isValid: false, warnings };
    }
    const stopDistance = stopLossPrice 
      ? Math.abs(entryPrice - stopLossPrice)
      : stopLossPips;
    
    if (!stopDistance || stopDistance <= 0 || !isFinite(stopDistance)) {
      logger.warn('Invalid stop distance for crypto position sizing', { symbol, stopDistance });
      return { lots: 0, units: 0, riskAmount: 0, isApproximate: false, isValid: false, warnings: ['Invalid stop distance'] };
    }
    
    const maxLotsByMargin = (accountSize * leverage) / (entryPrice * contractSize);
    
    lots = riskAmount / (stopDistance * contractSize);
    
    if (lots > maxLotsByMargin) {
      marginLimited = true;
      logger.info('Crypto margin limit hit', {
        symbol,
        riskBasedLots: Math.round(lots * 100) / 100,
        maxLotsByMargin: Math.round(maxLotsByMargin * 100) / 100,
        leverage,
        entryPrice,
      });
      lots = maxLotsByMargin;
      warnings.push(`Margin limit: reduced to ${Math.round(lots * 100) / 100} lots (${leverage}:1 leverage)`);
      isValid = false;
    }
    
    isApproximate = false;
    
    logger.debug('Crypto position size (E8 formula)', { 
      symbol, 
      contractSize, 
      stopDistance, 
      riskAmount,
      leverage,
      maxLotsByMargin: Math.round(maxLotsByMargin * 100) / 100,
      marginLimited,
      lots: Math.round(lots * 100) / 100 
    });
  } else {
    if (!stopLossPips || stopLossPips <= 0 || !isFinite(stopLossPips)) {
      logger.warn('Invalid stop loss pips for position sizing', { symbol, stopLossPips });
      return { lots: 0, units: 0, riskAmount: 0, isApproximate: false, isValid: false, warnings: ['Invalid stop loss pips'] };
    }
    
    const { pipValue } = getPipInfo(symbol);
    let effectivePipValue = pipValue;
    if (symbol.endsWith('JPY')) {
      effectivePipValue = 8.5;
    }
    
    lots = riskAmount / (stopLossPips * effectivePipValue);
    isApproximate = true;
    
    logger.debug('Forex position size (pip-based)', { 
      symbol, 
      pipValue: effectivePipValue, 
      stopLossPips, 
      riskAmount, 
      leverage,
      lots: Math.round(lots * 100) / 100 
    });
  }
  
  if (marginLimited && lots < 0.01) {
    warnings.push('Cannot trade: margin insufficient for minimum lot');
    lots = 0;
    isValid = false;
  } else if (lots < 0.01) {
    warnings.push('Position size below minimum lot (0.01)');
    lots = 0.01;
    isValid = false;
  }
  
  if (lots > 100) {
    warnings.push('Position size capped at 100 lots');
    lots = 100;
    isValid = false;
  }
  
  lots = Math.round(lots * 100) / 100;
  const units = isCrypto && contractSize ? lots * contractSize : Math.round(lots * 100000);
  
  return { 
    lots, 
    units, 
    riskAmount: Math.round(riskAmount * 100) / 100,
    isApproximate,
    isValid,
    warnings
  };
}

type AssetClass = 'forex' | 'metal' | 'crypto' | 'index' | 'commodity';

export interface SessionTpProfile {
  enabled?: boolean;
  offPeakSessions?: TradingSession[];
  reductionPct?: number;
  assetClassOverrides?: Partial<Record<AssetClass, { reductionPct?: number; sessions?: TradingSession[] }>>;
}

export const DEFAULT_SESSION_TP_PROFILE: SessionTpProfile = {
  enabled: true,
  offPeakSessions: ['sydney', 'tokyo'],
  reductionPct: 0.2,
  assetClassOverrides: {
    crypto: { reductionPct: 0, sessions: [] },      // 24/7 liquidity - no reduction
    metal: { reductionPct: 0.15, sessions: ['sydney', 'tokyo'] },
    index: { reductionPct: 0.25, sessions: ['sydney', 'tokyo'] },
  },
};

export interface AdaptiveTakeProfitConfig {
  preferStructure?: boolean;
  structureLookback?: number;
  rrTarget?: number;
  atrMultiplier?: number;
  allowAtrFallback?: boolean;
  sessionProfile?: SessionTpProfile;
}

interface ResolveTpInput {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  desiredTakeProfit: number;
  bars?: Bar[];
  atr?: number | null;
  config?: AdaptiveTakeProfitConfig;
}

interface ResolveTpResult {
  price: number;
  pips: number;
  rr: number;
  source: 'rr' | 'structure' | 'atr' | 'session-adjusted';
  notes: string[];
}

function findStructureTarget(
  bars: Bar[] | undefined,
  direction: SignalDirection,
  entryPrice: number,
  lookback: number
): number | null {
  if (!bars || bars.length < 5) return null;
  
  const pivot = 2;
  const slice = bars.slice(-Math.max(lookback, pivot * 2 + 1));
  const candidates: number[] = [];
  
  for (let i = pivot; i < slice.length - pivot; i++) {
    const window = slice.slice(i - pivot, i + pivot + 1);
    const high = Math.max(...window.map(b => b.high));
    const low = Math.min(...window.map(b => b.low));
    const bar = slice[i];
    
    if (direction === 'long' && bar.high === high && bar.high > entryPrice) {
      candidates.push(bar.high);
    }
    if (direction === 'short' && bar.low === low && bar.low < entryPrice) {
      candidates.push(bar.low);
    }
  }
  
  if (candidates.length === 0) return null;
  
  if (direction === 'long') {
    const nearest = candidates.reduce((best, price) => 
      price >= entryPrice && price < best ? price : best
    , Infinity);
    return Number.isFinite(nearest) && nearest !== Infinity ? nearest : Math.max(...candidates);
  }
  
  const nearestShort = candidates.reduce((best, price) => 
    price <= entryPrice && price > best ? price : best
  , -Infinity);
  return Number.isFinite(nearestShort) && nearestShort !== -Infinity ? nearestShort : Math.min(...candidates);
}

function applySessionTpAdjustment(params: {
  symbol: string;
  entryPrice: number;
  targetPrice: number;
  direction: SignalDirection;
  profile: SessionTpProfile;
}): { price: number; note: string } | null {
  const { symbol, entryPrice, targetPrice, direction, profile } = params;
  if (!profile?.enabled) return null;
  
  const assetClass = (getInstrumentSpec(symbol)?.type || 'forex') as AssetClass;
  const session = getCurrentSession();
  const baseReduction = profile.reductionPct ?? 0;
  const baseSessions = profile.offPeakSessions ?? [];
  const override = profile.assetClassOverrides?.[assetClass];
  const reduction = override?.reductionPct ?? baseReduction;
  const sessions = override?.sessions ?? baseSessions;
  
  if (!reduction || reduction <= 0 || sessions.length === 0) return null;
  if (!sessions.includes(session)) return null;
  
  const distance = Math.abs(targetPrice - entryPrice);
  const adjustedDistance = distance * (1 - reduction);
  const price = direction === 'long'
    ? entryPrice + adjustedDistance
    : entryPrice - adjustedDistance;
  
  return {
    price,
    note: `Session ${session} adjustment: TP reduced by ${(reduction * 100).toFixed(0)}% for ${assetClass}`,
  };
}

function resolveTakeProfit(input: ResolveTpInput): ResolveTpResult {
  const { symbol, direction, entryPrice, stopLoss, desiredTakeProfit, bars, atr, config } = input;
  const { pipSize } = getPipInfo(symbol);
  const riskPips = Math.abs(entryPrice - stopLoss) / pipSize;
  const baseTpPips = Math.abs(desiredTakeProfit - entryPrice) / pipSize;
  const baseRr = safeDiv(baseTpPips, riskPips, 0);
  
  const preferStructure = config?.preferStructure ?? false;
  const structureLookback = config?.structureLookback ?? 60;
  const rrTarget = config?.rrTarget ?? (baseRr || 2);
  const atrMultiplier = config?.atrMultiplier ?? rrTarget;
  const allowAtrFallback = config?.allowAtrFallback ?? true;
  
  let targetPrice = desiredTakeProfit;
  let source: ResolveTpResult['source'] = 'rr';
  const notes: string[] = [];
  
  if (preferStructure) {
    const structureTarget = findStructureTarget(bars, direction, entryPrice, structureLookback);
    if (structureTarget !== null) {
      const structurePips = Math.abs(structureTarget - entryPrice) / pipSize;
      const structureRr = safeDiv(structurePips, riskPips, 0);
      if (structureRr >= 1 || structureRr >= rrTarget * 0.65) {
        targetPrice = structureTarget;
        source = 'structure';
        notes.push(`Structure TP from recent swing (${structureRr.toFixed(2)}R)`);
      } else {
        notes.push(`Structure TP rejected: only ${structureRr.toFixed(2)}R`);
      }
    }
  }
  
  if (source === 'rr' && allowAtrFallback && atr && atr > 0) {
    const atrDistance = atr * atrMultiplier;
    targetPrice = direction === 'long'
      ? entryPrice + atrDistance
      : entryPrice - atrDistance;
    source = 'atr';
    const atrRr = safeDiv((atrDistance / pipSize), riskPips, rrTarget);
    notes.push(`ATR fallback (${atrMultiplier.toFixed(2)}x ATR ≈ ${atrRr.toFixed(2)}R)`);
  }
  
  const sessionAdjustment = applySessionTpAdjustment({
    symbol,
    entryPrice,
    targetPrice,
    direction,
    profile: config?.sessionProfile ?? DEFAULT_SESSION_TP_PROFILE,
  });
  
  if (sessionAdjustment) {
    targetPrice = sessionAdjustment.price;
    source = 'session-adjusted';
    notes.push(sessionAdjustment.note);
  }
  
  const tpPips = Math.abs(targetPrice - entryPrice) / pipSize;
  const rr = safeDiv(tpPips, riskPips, 0);
  
  return {
    price: targetPrice,
    pips: Math.round(tpPips * 10) / 10,
    rr: Math.round(rr * 10) / 10,
    source,
    notes,
  };
}

export interface DecisionParams {
  symbol: string;
  strategyId: string;
  strategyName: string;
  direction: SignalDirection;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  triggers: string[];
  reasonCodes: ReasonCode[];
  settings: UserSettings;
  timeframes?: { trend: string; entry: string };
  bars?: Bar[];
  atr?: number | null;
  takeProfitConfig?: AdaptiveTakeProfitConfig;
}

const STYLE_TIMEFRAMES: Record<TradingStyle, { trend: string; entry: string }> = {
  intraday: { trend: 'H4', entry: 'H1' },
  swing: { trend: 'D1', entry: 'H4' },
};

export function getStrategyTimeframes(
  strategyTimeframes: { trend: string; entry: string } | undefined,
  style: TradingStyle,
  symbol?: string
): { trend: string; entry: string } {
  if (strategyTimeframes) {
    return strategyTimeframes;
  }
  return STYLE_TIMEFRAMES[style] || STYLE_TIMEFRAMES.intraday;
}

function getTimingWindows(entryTimeframe: string | undefined) {
  const tf = (entryTimeframe || 'H1').toUpperCase();
  if (tf === 'H4' || tf === '4H') {
    return { optimalMinutes: 120, expiryMinutes: 240 };
  }
  if (tf === 'D1' || tf === '1D') {
    return { optimalMinutes: 360, expiryMinutes: 720 };
  }
  return { optimalMinutes: 30, expiryMinutes: 60 };
}

function buildTieredExitPlan(
  symbol: string,
  direction: SignalDirection,
  entryPrice: number,
  stopLoss: number,
  pipSize: number,
  stopLossPips: number,
  atrPips?: number
): TieredExitPlan {
  const tp1Rr = 1.0;
  const tp2Rr = 2.0;
  const tp1Price = direction === 'long'
    ? entryPrice + stopLossPips * pipSize * tp1Rr
    : entryPrice - stopLossPips * pipSize * tp1Rr;
  const tp2Price = direction === 'long'
    ? entryPrice + stopLossPips * pipSize * tp2Rr
    : entryPrice - stopLossPips * pipSize * tp2Rr;

  const tp1: ExitTarget = {
    label: 'TP1',
    price: tp1Price,
    pips: Math.round(stopLossPips * tp1Rr * 10) / 10,
    rr: Math.round(tp1Rr * 10) / 10,
    percent: 50,
    action: 'Close 50% and move SL to BE',
    formatted: formatPrice(tp1Price, symbol),
  };

  const tp2: ExitTarget = {
    label: 'TP2',
    price: tp2Price,
    pips: Math.round(stopLossPips * tp2Rr * 10) / 10,
    rr: Math.round(tp2Rr * 10) / 10,
    percent: 30,
    action: 'Close 30% and trail remainder',
    formatted: formatPrice(tp2Price, symbol),
  };

  const trailOffset = atrPips ? Math.round(atrPips * 10) / 10 : Math.round(stopLossPips * 0.5 * 10) / 10;

  return {
    tp1,
    tp2,
    runner: {
      percent: 20,
      trail: {
        type: 'atr',
        activateAtRr: 2,
        offsetPips: trailOffset,
        notes: 'Trail at 1x ATR after TP2; lock in profit as structure forms',
      },
    },
  };
}

export function buildDecision(params: DecisionParams): Decision {
  const {
    symbol,
    strategyId,
    strategyName,
    direction,
    confidence,
    entryPrice,
    stopLoss,
    takeProfit,
    triggers,
    reasonCodes,
    settings,
    timeframes: strategyTimeframes,
    bars,
    atr,
    takeProfitConfig,
  } = params;

  const grade = calculateGrade(confidence);
  const { pipSize, digits } = getPipInfo(symbol);
  
  const stopLossPips = Math.abs(entryPrice - stopLoss) / pipSize;
  const baseTpPips = Math.abs(takeProfit - entryPrice) / pipSize;
  const baseRr = safeDiv(baseTpPips, stopLossPips, 0);
  
  const adaptiveTp = takeProfitConfig
    ? resolveTakeProfit({
        symbol,
        direction,
        entryPrice,
        stopLoss,
        desiredTakeProfit: takeProfit,
        bars,
        atr,
        config: takeProfitConfig,
      })
    : {
        price: takeProfit,
        pips: Math.round(baseTpPips * 10) / 10,
        rr: Math.round(baseRr * 10) / 10,
        source: 'rr' as const,
        notes: [] as string[],
      };
  
  const takeProfitPrice = adaptiveTp.price;
  const takeProfitPips = adaptiveTp.pips;
  const rr = adaptiveTp.rr;
  
  const position = calculatePositionSize(
    symbol,
    settings.accountSize,
    settings.riskPercent,
    stopLossPips,
    entryPrice,
    stopLoss
  );
  
  const warnings: string[] = [];
  if (position.isApproximate) {
    warnings.push('Lot size is approximate - verify with broker');
  }

  const now = new Date();
  const resolvedTimeframes = getStrategyTimeframes(strategyTimeframes, settings.style, symbol);
  const trackedSignal = trackSignal(symbol, strategyId, direction);
  const signalAge = formatSignalAge(trackedSignal.firstDetected);
  const timingWindows = getTimingWindows(resolvedTimeframes.entry);
  const detectedAt = new Date(trackedSignal.firstDetected).getTime() || now.getTime();
  const degradeAfter = new Date(detectedAt + timingWindows.optimalMinutes * 60 * 1000);
  const validUntil = new Date(detectedAt + timingWindows.expiryMinutes * 60 * 1000);
  const state = signalAge.ms >= timingWindows.expiryMinutes * 60 * 1000
    ? 'expired'
    : signalAge.ms >= timingWindows.optimalMinutes * 60 * 1000
      ? 'degrading'
      : 'optimal';

  return {
    symbol,
    displayName: symbol,
    strategyId,
    strategyName,
    direction,
    grade,
    confidence,
    entryPrice,
    entry: {
      price: entryPrice,
      formatted: formatEntryPrice(entryPrice, symbol),
    },
    entryZone: null,
    stopLoss: {
      price: stopLoss,
      pips: Math.round(stopLossPips * 10) / 10,
      formatted: formatPrice(stopLoss, symbol),
    },
    takeProfit: {
      price: takeProfitPrice,
      pips: Math.round(takeProfitPips * 10) / 10,
      rr: Math.round(rr * 10) / 10,
      formatted: formatPrice(takeProfitPrice, symbol),
    },
    takeProfitSource: adaptiveTp.source,
    takeProfitNotes: adaptiveTp.notes,
    position,
    reason: triggers.join('. '),
    triggers,
    reasonCodes,
    warnings,
    style: settings.style,
    executionModel: 'NEXT_OPEN',
    timeframes: resolvedTimeframes,
    timestamp: now.toISOString(),
    validUntil: validUntil.toISOString(),
    timing: {
      firstDetected: trackedSignal.firstDetected,
      signalAge,
      validUntil: validUntil.toISOString(),
      degradeAfter: degradeAfter.toISOString(),
      optimalWindowMinutes: timingWindows.optimalMinutes,
      expiryMinutes: timingWindows.expiryMinutes,
      state,
      isStale: isStale(signalAge.ms),
    },
  };
}

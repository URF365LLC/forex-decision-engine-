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
  calculatePips 
} from './types.js';
import { createLogger } from '../services/logger.js';
import { getCryptoContractSize, DEFAULTS } from '../config/defaults.js';

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
  
  for (const ind of required) {
    if (ind === 'bars') continue;
    const indicator = data[ind];
    if (!indicator || !Array.isArray(indicator)) return false;
    if (indicator.length < minBars) return false;
    if (indicator.length !== (data.bars as unknown[]).length) {
      logger.warn('Indicator length mismatch', { 
        indicator: ind, 
        indicatorLength: indicator.length, 
        barsLength: (data.bars as unknown[]).length 
      });
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
    const contractSize = getCryptoContractSize(symbol);
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
  const units = isCrypto ? lots * getCryptoContractSize(symbol) : Math.round(lots * 100000);
  
  return { 
    lots, 
    units, 
    riskAmount: Math.round(riskAmount * 100) / 100,
    isApproximate,
    isValid,
    warnings
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
  } = params;

  const grade = calculateGrade(confidence);
  const { pipSize, digits } = getPipInfo(symbol);
  
  const stopLossPips = Math.abs(entryPrice - stopLoss) / pipSize;
  const takeProfitPips = Math.abs(takeProfit - entryPrice) / pipSize;
  const rr = safeDiv(takeProfitPips, stopLossPips, 0);
  
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
  const validUntil = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  return {
    symbol,
    displayName: symbol,
    strategyId,
    strategyName,
    direction,
    grade,
    confidence,
    entryPrice,
    entryZone: null,
    stopLoss: {
      price: stopLoss,
      pips: Math.round(stopLossPips * 10) / 10,
      formatted: formatPrice(stopLoss, symbol),
    },
    takeProfit: {
      price: takeProfit,
      pips: Math.round(takeProfitPips * 10) / 10,
      rr: Math.round(rr * 10) / 10,
      formatted: formatPrice(takeProfit, symbol),
    },
    position,
    reason: triggers.join('. '),
    triggers,
    reasonCodes,
    warnings,
    style: settings.style,
    executionModel: 'NEXT_OPEN',
    timeframes: getStrategyTimeframes(strategyTimeframes, settings.style, symbol),
    timestamp: now.toISOString(),
    validUntil: validUntil.toISOString(),
  };
}

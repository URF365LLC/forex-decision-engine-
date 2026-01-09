/**
 * Portfolio Risk Manager - Currency Exposure & Risk Aggregation
 * 
 * Features:
 * - Tracks net exposure by currency (USD, EUR, JPY, etc.)
 * - Enforces max exposure per currency (default 2%)
 * - Integrates with drawdownGuard for daily/total DD limits
 * - Blocks correlated trades that would exceed limits
 * 
 * E8 Markets Compliance:
 * - 4% daily loss limit (delegated to drawdownGuard)
 * - 6% max drawdown (delegated to drawdownGuard)
 * - Max 100 open orders
 * 
 * Created: 2026-01-09 (Quantitative Audit Implementation)
 */

import { createLogger } from './logger.js';
import { checkDrawdownLimits, DrawdownCheckResult } from './drawdownGuard.js';
import { DEFAULTS } from '../config/defaults.js';
import { getInstrumentSpec, InstrumentSpec } from '../config/e8InstrumentSpecs.js';

const logger = createLogger('PortfolioRiskManager');

export interface Position {
  symbol: string;
  direction: 'long' | 'short';
  lots: number;
  entryPrice: number;
  currentPrice?: number;
  stopLoss: number;
  riskAmount: number;
  openedAt: string;
}

export interface CurrencyExposure {
  currency: string;
  netExposure: number;
  exposurePercent: number;
  positions: string[];
}

export interface PortfolioRiskCheck {
  allowed: boolean;
  reason?: string;
  currencyExposures: CurrencyExposure[];
  openPositionCount: number;
  totalRiskPercent: number;
  drawdownCheck: DrawdownCheckResult;
  warnings: string[];
}

export interface NewTradeCheck {
  symbol: string;
  direction: 'long' | 'short';
  riskPercent: number;
  lots?: number;
}

const MAX_CURRENCY_EXPOSURE_PCT = 2.0;
const MAX_OPEN_ORDERS = DEFAULTS.risk.maxOrders;

const openPositions = new Map<string, Position>();

// Currency buckets for exposure netting - covers all E8 instrument symbols, dataSymbols, and common broker aliases
// Regional index buckets: US_INDEX, EU_INDEX, JP_INDEX, AU_INDEX | Commodity buckets: OIL, GOLD, SILVER
const SYMBOL_CURRENCY_MAP: Record<string, { base: string; quote: string }> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // FOREX (28 pairs) - symbol format from e8InstrumentSpecs
  // ═══════════════════════════════════════════════════════════════════════════
  'EURUSD': { base: 'EUR', quote: 'USD' },
  'GBPUSD': { base: 'GBP', quote: 'USD' },
  'AUDUSD': { base: 'AUD', quote: 'USD' },
  'NZDUSD': { base: 'NZD', quote: 'USD' },
  'USDJPY': { base: 'USD', quote: 'JPY' },
  'EURJPY': { base: 'EUR', quote: 'JPY' },
  'GBPJPY': { base: 'GBP', quote: 'JPY' },
  'AUDJPY': { base: 'AUD', quote: 'JPY' },
  'NZDJPY': { base: 'NZD', quote: 'JPY' },
  'CADJPY': { base: 'CAD', quote: 'JPY' },
  'CHFJPY': { base: 'CHF', quote: 'JPY' },
  'USDCAD': { base: 'USD', quote: 'CAD' },
  'EURCAD': { base: 'EUR', quote: 'CAD' },
  'GBPCAD': { base: 'GBP', quote: 'CAD' },
  'AUDCAD': { base: 'AUD', quote: 'CAD' },
  'NZDCAD': { base: 'NZD', quote: 'CAD' },
  'USDCHF': { base: 'USD', quote: 'CHF' },
  'EURCHF': { base: 'EUR', quote: 'CHF' },
  'GBPCHF': { base: 'GBP', quote: 'CHF' },
  'AUDCHF': { base: 'AUD', quote: 'CHF' },
  'NZDCHF': { base: 'NZD', quote: 'CHF' },
  'CADCHF': { base: 'CAD', quote: 'CHF' },
  'EURGBP': { base: 'EUR', quote: 'GBP' },
  'EURAUD': { base: 'EUR', quote: 'AUD' },
  'GBPAUD': { base: 'GBP', quote: 'AUD' },
  'AUDNZD': { base: 'AUD', quote: 'NZD' },
  'EURNZD': { base: 'EUR', quote: 'NZD' },
  'GBPNZD': { base: 'GBP', quote: 'NZD' },
  // ═══════════════════════════════════════════════════════════════════════════
  // METALS - symbol + dataSymbol variants
  // ═══════════════════════════════════════════════════════════════════════════
  'XAUUSD': { base: 'GOLD', quote: 'USD' },
  'XAGUSD': { base: 'SILVER', quote: 'USD' },
  // ═══════════════════════════════════════════════════════════════════════════
  // CRYPTO (8 pairs) - symbol format from e8InstrumentSpecs
  // ═══════════════════════════════════════════════════════════════════════════
  'BTCUSD': { base: 'BTC', quote: 'USD' },
  'ETHUSD': { base: 'ETH', quote: 'USD' },
  'XRPUSD': { base: 'XRP', quote: 'USD' },
  'ADAUSD': { base: 'ADA', quote: 'USD' },
  'SOLUSD': { base: 'SOL', quote: 'USD' },
  'LTCUSD': { base: 'LTC', quote: 'USD' },
  'BCHUSD': { base: 'BCH', quote: 'USD' },
  'BNBUSD': { base: 'BNB', quote: 'USD' },
  // ═══════════════════════════════════════════════════════════════════════════
  // INDICES - spec symbols + dataSymbols + common broker aliases (all map to regional buckets)
  // ═══════════════════════════════════════════════════════════════════════════
  // S&P 500 bucket (US_INDEX)
  'SP': { base: 'US_INDEX', quote: 'USD' },       // spec.symbol
  'SPX': { base: 'US_INDEX', quote: 'USD' },      // spec.dataSymbol
  'SPX500': { base: 'US_INDEX', quote: 'USD' },   // broker alias
  'US500': { base: 'US_INDEX', quote: 'USD' },    // broker alias
  // Nasdaq 100 bucket (US_INDEX)
  'NSDQ': { base: 'US_INDEX', quote: 'USD' },     // spec.symbol
  'NDX': { base: 'US_INDEX', quote: 'USD' },      // spec.dataSymbol
  'NAS100': { base: 'US_INDEX', quote: 'USD' },   // broker alias
  'USTEC': { base: 'US_INDEX', quote: 'USD' },    // broker alias
  // Dow Jones bucket (US_INDEX)
  'DOW': { base: 'US_INDEX', quote: 'USD' },      // spec.symbol
  'DJI': { base: 'US_INDEX', quote: 'USD' },      // spec.dataSymbol
  'US30': { base: 'US_INDEX', quote: 'USD' },     // broker alias
  'DJ30': { base: 'US_INDEX', quote: 'USD' },     // broker alias
  // Germany DAX bucket (EU_INDEX)
  'DAX': { base: 'EU_INDEX', quote: 'EUR' },      // spec.symbol
  'GDAXI': { base: 'EU_INDEX', quote: 'EUR' },    // spec.dataSymbol
  'DE40': { base: 'EU_INDEX', quote: 'EUR' },     // broker alias
  'GER40': { base: 'EU_INDEX', quote: 'EUR' },    // broker alias
  // France CAC bucket (EU_INDEX)
  'FRA40': { base: 'EU_INDEX', quote: 'EUR' },    // broker alias
  'CAC40': { base: 'EU_INDEX', quote: 'EUR' },    // broker alias
  // Japan Nikkei bucket (JP_INDEX)
  'NIKKEI': { base: 'JP_INDEX', quote: 'JPY' },   // spec.symbol
  'N225': { base: 'JP_INDEX', quote: 'JPY' },     // spec.dataSymbol
  'JPN225': { base: 'JP_INDEX', quote: 'JPY' },   // broker alias
  'JP225': { base: 'JP_INDEX', quote: 'JPY' },    // broker alias
  // Australia ASX bucket (AU_INDEX)
  'ASX': { base: 'AU_INDEX', quote: 'AUD' },      // spec.symbol
  'AXJO': { base: 'AU_INDEX', quote: 'AUD' },     // spec.dataSymbol
  'AUS200': { base: 'AU_INDEX', quote: 'AUD' },   // broker alias
  // UK FTSE bucket (UK_INDEX) - common alias
  'UK100': { base: 'UK_INDEX', quote: 'GBP' },    // broker alias
  'FTSE': { base: 'UK_INDEX', quote: 'GBP' },     // broker alias
  // ═══════════════════════════════════════════════════════════════════════════
  // COMMODITIES - spec symbols + dataSymbols + common broker aliases
  // ═══════════════════════════════════════════════════════════════════════════
  'WTI': { base: 'OIL', quote: 'USD' },           // spec.symbol
  'CL': { base: 'OIL', quote: 'USD' },            // spec.dataSymbol
  'USOIL': { base: 'OIL', quote: 'USD' },         // broker alias
  'CRUDEOIL': { base: 'OIL', quote: 'USD' },      // broker alias
  'BRENT': { base: 'OIL', quote: 'USD' },         // spec.symbol
  'BZ': { base: 'OIL', quote: 'USD' },            // spec.dataSymbol
  'UKOIL': { base: 'OIL', quote: 'USD' },         // broker alias
};

function extractCurrencies(symbol: string): { base: string; quote: string } | null {
  const normalized = symbol.toUpperCase().replace(/[\/\-_]/g, '');
  
  // Check explicit map first (covers all 46 E8 instruments + aliases)
  if (SYMBOL_CURRENCY_MAP[normalized]) {
    return SYMBOL_CURRENCY_MAP[normalized];
  }
  
  // Fallback for unknown symbols - try to derive from spec type
  // Use regional buckets for proper exposure aggregation
  const spec = getInstrumentSpec(symbol);
  if (spec && spec.quoteCurrency) {
    logger.warn(`Symbol ${symbol} not in currency map, deriving from spec type: ${spec.type}`);
    
    if (spec.type === 'index') {
      // Map to regional bucket based on quote currency
      if (spec.quoteCurrency === 'USD') return { base: 'US_INDEX', quote: 'USD' };
      if (spec.quoteCurrency === 'EUR') return { base: 'EU_INDEX', quote: 'EUR' };
      if (spec.quoteCurrency === 'JPY') return { base: 'JP_INDEX', quote: 'JPY' };
      if (spec.quoteCurrency === 'GBP') return { base: 'UK_INDEX', quote: 'GBP' };
      if (spec.quoteCurrency === 'AUD') return { base: 'AU_INDEX', quote: 'AUD' };
      return { base: 'OTHER_INDEX', quote: spec.quoteCurrency };
    }
    if (spec.type === 'commodity') {
      return { base: 'OIL', quote: 'USD' }; // Default commodity bucket
    }
    if (spec.type === 'metal') {
      return { base: normalized.includes('XAU') ? 'GOLD' : 'SILVER', quote: 'USD' };
    }
    // Forex/crypto fallback - use symbol parts
    return { base: normalized, quote: spec.quoteCurrency };
  }
  
  logger.warn(`Could not extract currencies from symbol: ${symbol} - not in map or specs`);
  return null;
}

function calculateCurrencyExposures(
  accountSize: number,
  additionalTrade?: { symbol: string; direction: 'long' | 'short'; riskPercent: number }
): Map<string, CurrencyExposure> {
  const exposures = new Map<string, CurrencyExposure>();
  
  function addExposure(currency: string, amount: number, positionSymbol: string) {
    const existing = exposures.get(currency) || {
      currency,
      netExposure: 0,
      exposurePercent: 0,
      positions: [],
    };
    existing.netExposure += amount;
    existing.exposurePercent = (Math.abs(existing.netExposure) / accountSize) * 100;
    if (!existing.positions.includes(positionSymbol)) {
      existing.positions.push(positionSymbol);
    }
    exposures.set(currency, existing);
  }
  
  for (const [positionId, position] of openPositions) {
    const currencies = extractCurrencies(position.symbol);
    if (!currencies) continue;
    
    const riskAmount = position.riskAmount;
    
    if (position.direction === 'long') {
      addExposure(currencies.base, riskAmount, position.symbol);
      addExposure(currencies.quote, -riskAmount, position.symbol);
    } else {
      addExposure(currencies.base, -riskAmount, position.symbol);
      addExposure(currencies.quote, riskAmount, position.symbol);
    }
  }
  
  if (additionalTrade) {
    const currencies = extractCurrencies(additionalTrade.symbol);
    if (currencies) {
      const riskAmount = accountSize * (additionalTrade.riskPercent / 100);
      
      if (additionalTrade.direction === 'long') {
        addExposure(currencies.base, riskAmount, additionalTrade.symbol + ' (pending)');
        addExposure(currencies.quote, -riskAmount, additionalTrade.symbol + ' (pending)');
      } else {
        addExposure(currencies.base, -riskAmount, additionalTrade.symbol + ' (pending)');
        addExposure(currencies.quote, riskAmount, additionalTrade.symbol + ' (pending)');
      }
    }
  }
  
  return exposures;
}

export function checkPortfolioRisk(
  accountSize: number,
  equity: number,
  newTrade?: NewTradeCheck
): PortfolioRiskCheck {
  const warnings: string[] = [];
  
  const drawdownCheck = checkDrawdownLimits({
    equity,
    dailyLossLimitPct: DEFAULTS.risk.dailyLossLimit,
    maxDrawdownPct: DEFAULTS.risk.maxDrawdown,
  });
  
  if (!drawdownCheck.allowed) {
    return {
      allowed: false,
      reason: drawdownCheck.reason,
      currencyExposures: [],
      openPositionCount: openPositions.size,
      totalRiskPercent: 0,
      drawdownCheck,
      warnings,
    };
  }
  
  if (newTrade && openPositions.size >= MAX_OPEN_ORDERS) {
    return {
      allowed: false,
      reason: `Max open orders reached (${MAX_OPEN_ORDERS})`,
      currencyExposures: [],
      openPositionCount: openPositions.size,
      totalRiskPercent: 0,
      drawdownCheck,
      warnings,
    };
  }
  
  const currencyExposureMap = calculateCurrencyExposures(accountSize, newTrade);
  const currencyExposures = Array.from(currencyExposureMap.values());
  
  for (const exposure of currencyExposures) {
    if (exposure.exposurePercent > MAX_CURRENCY_EXPOSURE_PCT) {
      if (newTrade) {
        return {
          allowed: false,
          reason: `${exposure.currency} exposure would reach ${exposure.exposurePercent.toFixed(1)}% (max ${MAX_CURRENCY_EXPOSURE_PCT}%)`,
          currencyExposures,
          openPositionCount: openPositions.size,
          totalRiskPercent: calculateTotalRiskPercent(accountSize),
          drawdownCheck,
          warnings,
        };
      } else {
        warnings.push(`${exposure.currency} exposure at ${exposure.exposurePercent.toFixed(1)}% (limit: ${MAX_CURRENCY_EXPOSURE_PCT}%)`);
      }
    } else if (exposure.exposurePercent > MAX_CURRENCY_EXPOSURE_PCT * 0.75) {
      warnings.push(`${exposure.currency} exposure approaching limit: ${exposure.exposurePercent.toFixed(1)}%`);
    }
  }
  
  const totalRiskPercent = calculateTotalRiskPercent(accountSize);
  
  if (drawdownCheck.metrics.headroom.dailyRemaining < 1) {
    warnings.push(`Daily loss headroom low: ${drawdownCheck.metrics.headroom.dailyRemaining.toFixed(1)}% remaining`);
  }
  
  if (drawdownCheck.metrics.headroom.totalRemaining < 2) {
    warnings.push(`Max drawdown headroom low: ${drawdownCheck.metrics.headroom.totalRemaining.toFixed(1)}% remaining`);
  }
  
  return {
    allowed: true,
    currencyExposures,
    openPositionCount: openPositions.size,
    totalRiskPercent,
    drawdownCheck,
    warnings,
  };
}

function calculateTotalRiskPercent(accountSize: number): number {
  let totalRisk = 0;
  for (const position of openPositions.values()) {
    totalRisk += position.riskAmount;
  }
  return (totalRisk / accountSize) * 100;
}

export function addPosition(position: Position): string {
  const positionId = `${position.symbol}-${Date.now()}`;
  openPositions.set(positionId, position);
  
  logger.info(`Position added: ${positionId}`, {
    symbol: position.symbol,
    direction: position.direction,
    lots: position.lots,
    riskAmount: position.riskAmount,
  });
  
  return positionId;
}

export function removePosition(positionId: string): boolean {
  const removed = openPositions.delete(positionId);
  if (removed) {
    logger.info(`Position removed: ${positionId}`);
  }
  return removed;
}

export function closePositionBySymbol(symbol: string, direction?: 'long' | 'short'): boolean {
  for (const [id, position] of openPositions) {
    if (position.symbol === symbol && (!direction || position.direction === direction)) {
      openPositions.delete(id);
      logger.info(`Position closed by symbol: ${symbol} ${direction || ''}`);
      return true;
    }
  }
  return false;
}

export function getOpenPositions(): Position[] {
  return Array.from(openPositions.values());
}

export function clearAllPositions(): void {
  openPositions.clear();
  logger.info('All positions cleared');
}

export function getPortfolioSummary(accountSize: number, equity: number): PortfolioRiskCheck {
  return checkPortfolioRisk(accountSize, equity);
}

export function canTakeNewPosition(
  symbol: string,
  direction: 'long' | 'short',
  riskPercent: number,
  accountSize: number,
  equity: number
): PortfolioRiskCheck {
  return checkPortfolioRisk(accountSize, equity, {
    symbol,
    direction,
    riskPercent,
  });
}

export { extractCurrencies };

/**
 * Indicator Factory
 * Routes to correct indicator service based on asset class
 */

import { getAssetClass } from '../config/universe.js';
import { fetchIndicators, IndicatorData } from './indicatorService.js';
import { fetchCryptoIndicators, CryptoIndicatorData } from './cryptoIndicatorService.js';
import { TradingStyle } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('IndicatorFactory');

export type AnyIndicatorData = IndicatorData | CryptoIndicatorData;

export async function getIndicators(
  symbol: string,
  style: TradingStyle
): Promise<AnyIndicatorData> {
  const assetClass = getAssetClass(symbol);
  
  logger.debug(`Routing ${symbol} to ${assetClass} indicator service`);
  
  if (assetClass === 'crypto') {
    return fetchCryptoIndicators(symbol, style);
  }
  
  // Forex and metals use Alpha Vantage indicator endpoints
  return fetchIndicators(symbol, style);
}

export function isCryptoData(data: AnyIndicatorData): data is CryptoIndicatorData {
  return getAssetClass(data.symbol) === 'crypto';
}

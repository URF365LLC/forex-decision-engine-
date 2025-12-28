/**
 * Indicator Factory
 * Routes to correct indicator service based on asset class
 * 
 * Routing:
 * - Forex → Alpha Vantage indicators
 * - Crypto → Alpha Vantage/KuCoin OHLCV + local calculations
 * - Metals/Indices/Energies → Twelve Data OHLCV + local calculations
 */

import { getAssetClass, usesTwelveData, usesCryptoIndicators } from '../config/universe.js';
import { fetchIndicators, IndicatorData } from './indicatorService.js';
import { fetchCryptoIndicators, CryptoIndicatorData } from './cryptoIndicatorService.js';
import { fetchTwelveDataIndicators, TwelveDataIndicatorData } from './twelveDataIndicatorService.js';
import { TradingStyle } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('IndicatorFactory');

export type AnyIndicatorData = IndicatorData | CryptoIndicatorData | TwelveDataIndicatorData;

export async function getIndicators(
  symbol: string,
  style: TradingStyle
): Promise<AnyIndicatorData> {
  const assetClass = getAssetClass(symbol);
  
  if (usesTwelveData(symbol)) {
    logger.info(`${symbol}: Using Twelve Data source (${assetClass})`);
    return fetchTwelveDataIndicators(symbol, style);
  }
  
  if (usesCryptoIndicators(symbol)) {
    logger.info(`${symbol}: Using Crypto service (AV + KuCoin)`);
    return fetchCryptoIndicators(symbol, style);
  }
  
  logger.info(`${symbol}: Using Alpha Vantage (Forex)`);
  return fetchIndicators(symbol, style);
}

export function isCryptoData(data: AnyIndicatorData): data is CryptoIndicatorData {
  return getAssetClass(data.symbol) === 'crypto';
}

export function isTwelveDataData(data: AnyIndicatorData): data is TwelveDataIndicatorData {
  return usesTwelveData(data.symbol);
}

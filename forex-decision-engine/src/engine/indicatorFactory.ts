/**
 * Indicator Factory
 * Unified routing to Twelve Data - ALL symbols use the same path
 * TWELVE DATA ONLY - No Alpha Vantage, No KuCoin
 */

import { fetchIndicators, IndicatorData } from './indicatorService.js';
import { TradingStyle } from '../config/strategy.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('IndicatorFactory');

export type AnyIndicatorData = IndicatorData;

export async function getIndicators(
  symbol: string,
  style: TradingStyle
): Promise<AnyIndicatorData> {
  logger.debug(`Routing ${symbol} to Twelve-only indicator service`);
  return fetchIndicators(symbol, style);
}

export function isCryptoData(_data: AnyIndicatorData): _data is AnyIndicatorData {
  return false;
}

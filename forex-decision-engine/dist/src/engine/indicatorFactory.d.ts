/**
 * Indicator Factory
 * Routes to correct indicator service based on asset class
 */
import { IndicatorData } from './indicatorService.js';
import { CryptoIndicatorData } from './cryptoIndicatorService.js';
import { TradingStyle } from '../config/strategy.js';
export type AnyIndicatorData = IndicatorData | CryptoIndicatorData;
export declare function getIndicators(symbol: string, style: TradingStyle): Promise<AnyIndicatorData>;
export declare function isCryptoData(data: AnyIndicatorData): data is CryptoIndicatorData;

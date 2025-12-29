/**
 * Indicator Factory
 * Routes to correct indicator service based on asset class
 */
import { getAssetClass } from '../config/universe.js';
import { fetchIndicators } from './indicatorService.js';
import { fetchCryptoIndicators } from './cryptoIndicatorService.js';
import { createLogger } from '../services/logger.js';
const logger = createLogger('IndicatorFactory');
export async function getIndicators(symbol, style) {
    const assetClass = getAssetClass(symbol);
    logger.debug(`Routing ${symbol} to ${assetClass} indicator service`);
    if (assetClass === 'crypto') {
        return fetchCryptoIndicators(symbol, style);
    }
    return fetchIndicators(symbol, style);
}
export function isCryptoData(data) {
    return getAssetClass(data.symbol) === 'crypto';
}
//# sourceMappingURL=indicatorFactory.js.map
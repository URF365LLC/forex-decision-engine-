/**
 * Alpha Vantage Client (stub)
 * This project now uses Twelve Data as the primary provider.
 * Stub exists to satisfy legacy cryptoIndicatorService imports for typechecking.
 */

import type { OHLCVBar, IndicatorValue } from './twelveDataClient.js';

export const alphaVantage = {
  async getOHLCV(
    _symbol: string,
    _interval: string,
    _outputSize: 'compact' | 'full' = 'compact'
  ): Promise<OHLCVBar[]> {
    return [];
  },
};

export type { OHLCVBar, IndicatorValue };

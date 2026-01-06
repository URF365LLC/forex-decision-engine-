/**
 * KuCoin Client (stub)
 * Placeholder to keep legacy crypto indicator paths type-safe.
 */

import type { OHLCVBar } from './twelveDataClient.js';

export const kucoin = {
  async getOHLCV(
    _symbol: string,
    _interval: string
  ): Promise<OHLCVBar[]> {
    return [];
  },
};

export type { OHLCVBar };

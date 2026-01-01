/**
 * KuCoin API Client
 * DEPRECATED: Twelve-only mode is enabled
 * This file is kept as backup only
 */

throw new Error('FATAL: KuCoin disabled - Twelve-only mode');

import { OHLCVBar } from './alphaVantageClient.js';
import { createLogger } from './logger.js';

const logger = createLogger('KuCoin');

const BASE_URL = 'https://api.kucoin.com';

const SYMBOL_MAP: Record<string, string> = {
  'BNBUSD': 'BNB-USDT',
  'BCHUSD': 'BCH-USDT',
};

const INTERVAL_MAP: Record<string, string> = {
  '60min': '1hour',
  '15min': '15min',
  'daily': '1day',
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isKucoinSymbol(symbol: string): boolean {
  return symbol in SYMBOL_MAP;
}

export async function getKucoinOHLCV(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<OHLCVBar[]> {
  const kucoinSymbol = SYMBOL_MAP[symbol];
  if (!kucoinSymbol) {
    throw new Error(`Symbol ${symbol} not supported by KuCoin client`);
  }

  const kucoinInterval = INTERVAL_MAP[interval];
  if (!kucoinInterval) {
    throw new Error(`Interval ${interval} not supported by KuCoin client`);
  }

  const now = Math.floor(Date.now() / 1000);
  let secondsPerCandle: number;
  switch (kucoinInterval) {
    case '1hour': secondsPerCandle = 3600; break;
    case '15min': secondsPerCandle = 900; break;
    case '1day': secondsPerCandle = 86400; break;
    default: secondsPerCandle = 3600;
  }
  const startAt = now - (limit * secondsPerCandle);

  const url = `${BASE_URL}/api/v1/market/candles?symbol=${kucoinSymbol}&type=${kucoinInterval}&startAt=${startAt}&endAt=${now}`;
  
  logger.debug(`Fetching ${kucoinSymbol} ${kucoinInterval} from KuCoin (${limit} bars)`);

  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`KuCoin API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();

  if (json.code !== '200000') {
    throw new Error(`KuCoin error: ${json.msg || 'Unknown error'}`);
  }

  const data = json.data as string[][];
  
  if (!data || data.length === 0) {
    logger.warn(`No data returned from KuCoin for ${kucoinSymbol}`);
    return [];
  }

  const bars: OHLCVBar[] = data
    .slice(0, limit)
    .map((kline: string[]) => ({
      timestamp: new Date(Number(kline[0]) * 1000).toISOString(),
      open: parseFloat(kline[1]),
      close: parseFloat(kline[2]),
      high: parseFloat(kline[3]),
      low: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }))
    .reverse();

  logger.info(`Fetched ${bars.length} bars from KuCoin for ${symbol}`);

  await sleep(100);

  return bars;
}

export const kucoin = {
  getOHLCV: getKucoinOHLCV,
  isSupported: isKucoinSymbol,
};

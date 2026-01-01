/**
 * Time Utilities
 * Signal age formatting and price formatting utilities
 */

export interface SignalAge {
  ms: number;
  display: string;
}

/**
 * Format signal age for display
 * @param firstDetected ISO timestamp of first detection
 * @returns Object with milliseconds and human-readable display
 */
export function formatSignalAge(firstDetected: string): SignalAge {
  const ms = Date.now() - new Date(firstDetected).getTime();
  
  let display: string;
  
  if (ms < 60_000) {
    display = 'Just now';
  } else if (ms < 3600_000) {
    const mins = Math.floor(ms / 60_000);
    display = `${mins}m ago`;
  } else if (ms < 86400_000) {
    const hours = Math.floor(ms / 3600_000);
    const mins = Math.floor((ms % 3600_000) / 60_000);
    display = mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  } else {
    const days = Math.floor(ms / 86400_000);
    const hours = Math.floor((ms % 86400_000) / 3600_000);
    display = hours > 0 ? `${days}d ${hours}h ago` : `${days}d ago`;
  }
  
  return { ms, display };
}

/**
 * Check if signal is stale (default threshold: 4 hours)
 * NOTE: This is INFO ONLY - never blocks trades
 * @param ms Milliseconds since first detection
 * @param thresholdHours Hours after which signal is considered stale
 */
export function isStale(ms: number, thresholdHours: number = 4): boolean {
  return ms > thresholdHours * 60 * 60 * 1000;
}

/**
 * Format price with appropriate decimal places
 * @param price The price to format
 * @param symbol The trading symbol (for JPY detection)
 */
export function formatEntryPrice(price: number, symbol: string): string {
  const isJpy = symbol.toUpperCase().includes('JPY');
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'BNB', 'BCH', 'LTC'].some(
    c => symbol.toUpperCase().includes(c)
  );
  
  if (isCrypto) {
    return price.toFixed(2);
  }
  if (isJpy) {
    return price.toFixed(3);
  }
  return price.toFixed(5);
}

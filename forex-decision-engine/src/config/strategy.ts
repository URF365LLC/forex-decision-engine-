/**
 * Strategy Configuration - FIXED PARAMETERS (v1)
 * 
 * These are NOT user-editable in MVP v1.
 * Any customization is post-MVP.
 */

export const STRATEGY = {
  // ═══════════════════════════════════════════════════════════════
  // TREND FILTER (Higher Timeframe)
  // ═══════════════════════════════════════════════════════════════
  trend: {
    ema: {
      period: 200,           // EMA period for trend direction
      slopeLookback: 3,      // Bars to calculate slope
    },
    adx: {
      period: 14,            // ADX period
      threshold: 20,         // Minimum ADX for valid trend
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // ENTRY TRIGGER (Lower Timeframe)
  // ═══════════════════════════════════════════════════════════════
  entry: {
    emaFast: {
      period: 20,            // Fast EMA for shallow pullback
    },
    emaSlow: {
      period: 50,            // Slow EMA for deep pullback
    },
    rsi: {
      period: 14,
      bullishResetBelow: 50, // RSI must go below this for bullish reset
      bearishResetAbove: 50, // RSI must go above this for bearish reset
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // STOP LOSS
  // ═══════════════════════════════════════════════════════════════
  stopLoss: {
    swingLookback: 10,       // Bars to find swing high/low
    atr: {
      period: 14,
      multiplier: 1.5,       // ATR multiplier for fallback SL
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // TAKE PROFIT
  // ═══════════════════════════════════════════════════════════════
  takeProfit: {
    minRR: 2.0,              // Minimum risk:reward ratio
  },

  // ═══════════════════════════════════════════════════════════════
  // GRADING THRESHOLDS
  // ═══════════════════════════════════════════════════════════════
  grading: {
    // A+ requires all conditions perfectly met
    // B allows slightly weaker RSI or borderline ADX
    adxBorderline: {
      min: 18,               // ADX 18-20 = borderline (B grade)
      ideal: 20,             // ADX 20+ = strong (A+ eligible)
    },
    rsiResetStrength: {
      strong: 5,             // RSI moved 5+ points from reset level
      weak: 2,               // RSI moved 2-5 points (B grade)
    },
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// TRADING STYLE PRESETS
// ═══════════════════════════════════════════════════════════════

export type TradingStyle = 'intraday' | 'swing';

export interface StyleConfig {
  name: string;
  trendTimeframe: string;      // Higher timeframe for trend
  entryTimeframe: string;      // Lower timeframe for entry
  refreshMinutes: number;      // How often to refresh
  validCandles: number;        // How many candles signal is valid
}

export const STYLE_PRESETS: Record<TradingStyle, StyleConfig> = {
  intraday: {
    name: 'Intraday',
    trendTimeframe: 'D1',      // Using Daily for EMA200/ADX (more reliable than H4)
    entryTimeframe: 'H1',      // 60min for entry triggers
    refreshMinutes: 5,
    validCandles: 4,           // Signal valid for ~4 hours
  },
  swing: {
    name: 'Swing',
    trendTimeframe: 'D1',      // Daily for trend direction
    entryTimeframe: 'H4',      // 4-hour for entry (aggregated from 60min)
    refreshMinutes: 15,
    validCandles: 6,           // Signal valid for ~24 hours
  },
};

export function getStyleConfig(style: TradingStyle): StyleConfig {
  return STYLE_PRESETS[style];
}

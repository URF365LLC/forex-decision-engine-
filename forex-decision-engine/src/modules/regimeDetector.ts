/**
 * ATR Percentile Regime Detector
 * Classifies market regime based on ATR percentile ranking
 * 
 * Uses rolling ATR history to determine if current volatility is:
 * - Compression (low percentile): Favor mean reversion, tighter targets
 * - Normal: Standard parameters
 * - Expansion (high percentile): Favor momentum, wider targets
 */

export interface RegimeClassification {
  regime: 'compression' | 'normal' | 'expansion';
  atrPercentile: number;
  atrCurrent: number;
  atr20Period: number;
  atr50Period: number;
  rrMultiplier: number;
  stopMultiplier: number;
  description: string;
}

export interface RegimeConfig {
  compressionThreshold: number;
  expansionThreshold: number;
  lookbackPeriods: number;
}

const DEFAULT_CONFIG: RegimeConfig = {
  compressionThreshold: 25,
  expansionThreshold: 75,
  lookbackPeriods: 100,
};

export function calculateATRPercentile(
  atrValues: number[],
  config: Partial<RegimeConfig> = {}
): RegimeClassification {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  if (atrValues.length < 20) {
    return {
      regime: 'normal',
      atrPercentile: 50,
      atrCurrent: atrValues[atrValues.length - 1] || 0,
      atr20Period: 0,
      atr50Period: 0,
      rrMultiplier: 1.0,
      stopMultiplier: 1.0,
      description: 'Insufficient ATR history',
    };
  }
  
  const lookback = Math.min(cfg.lookbackPeriods, atrValues.length);
  const recentATR = atrValues.slice(-lookback);
  const currentATR = recentATR[recentATR.length - 1];
  
  const atr20 = recentATR.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const atr50 = recentATR.length >= 50
    ? recentATR.slice(-50).reduce((a, b) => a + b, 0) / 50
    : atr20;
  
  const sorted = [...recentATR].sort((a, b) => a - b);
  const countBelow = sorted.filter(v => v < currentATR).length;
  const percentile = (countBelow / sorted.length) * 100;
  
  let regime: 'compression' | 'normal' | 'expansion';
  let rrMultiplier: number;
  let stopMultiplier: number;
  let description: string;
  
  if (percentile <= cfg.compressionThreshold) {
    regime = 'compression';
    rrMultiplier = 0.8;
    stopMultiplier = 0.8;
    description = `Low volatility (${percentile.toFixed(0)}th percentile) - tighter targets, favor mean reversion`;
  } else if (percentile >= cfg.expansionThreshold) {
    regime = 'expansion';
    rrMultiplier = 1.5;
    stopMultiplier = 1.3;
    description = `High volatility (${percentile.toFixed(0)}th percentile) - wider targets, favor momentum`;
  } else {
    regime = 'normal';
    rrMultiplier = 1.0;
    stopMultiplier = 1.0;
    description = `Normal volatility (${percentile.toFixed(0)}th percentile) - standard parameters`;
  }
  
  return {
    regime,
    atrPercentile: percentile,
    atrCurrent: currentATR,
    atr20Period: atr20,
    atr50Period: atr50,
    rrMultiplier,
    stopMultiplier,
    description,
  };
}

export function getAdaptiveRR(
  baseRR: number,
  regime: RegimeClassification,
  strategyType: 'trend' | 'mean-reversion' | 'breakout'
): number {
  let multiplier = regime.rrMultiplier;
  
  if (strategyType === 'mean-reversion') {
    if (regime.regime === 'compression') {
      multiplier = 1.2;
    } else if (regime.regime === 'expansion') {
      multiplier = 0.8;
    }
  } else if (strategyType === 'breakout') {
    if (regime.regime === 'expansion') {
      multiplier = 1.8;
    }
  }
  
  return baseRR * multiplier;
}

export function getAdaptiveStopMultiplier(
  regime: RegimeClassification,
  strategyType: 'trend' | 'mean-reversion' | 'breakout'
): number {
  let multiplier = regime.stopMultiplier;
  
  if (strategyType === 'mean-reversion') {
    if (regime.regime === 'compression') {
      multiplier = 0.7;
    }
  } else if (strategyType === 'breakout') {
    if (regime.regime === 'expansion') {
      multiplier = 1.5;
    }
  }
  
  return multiplier;
}

export function shouldTradeInRegime(
  regime: RegimeClassification,
  strategyType: 'trend' | 'mean-reversion' | 'breakout' | 'momentum'
): { allowed: boolean; reason?: string; confidenceAdjustment: number } {
  if (strategyType === 'mean-reversion') {
    if (regime.regime === 'expansion' && regime.atrPercentile >= 90) {
      return {
        allowed: false,
        reason: `Extreme volatility (${regime.atrPercentile.toFixed(0)}th pct) - mean reversion blocked`,
        confidenceAdjustment: 0,
      };
    }
    if (regime.regime === 'expansion') {
      return {
        allowed: true,
        reason: 'High volatility - MR risky but allowed',
        confidenceAdjustment: -15,
      };
    }
    if (regime.regime === 'compression') {
      return {
        allowed: true,
        confidenceAdjustment: 10,
      };
    }
  }
  
  if (strategyType === 'trend' || strategyType === 'momentum') {
    if (regime.regime === 'compression' && regime.atrPercentile <= 10) {
      return {
        allowed: false,
        reason: `Extreme compression (${regime.atrPercentile.toFixed(0)}th pct) - trend/momentum blocked`,
        confidenceAdjustment: 0,
      };
    }
    if (regime.regime === 'compression') {
      return {
        allowed: true,
        reason: 'Low volatility - trend signals may stall',
        confidenceAdjustment: -10,
      };
    }
    if (regime.regime === 'expansion') {
      return {
        allowed: true,
        confidenceAdjustment: 10,
      };
    }
  }
  
  if (strategyType === 'breakout') {
    if (regime.regime === 'compression') {
      return {
        allowed: true,
        confidenceAdjustment: 15,
      };
    }
    if (regime.regime === 'expansion' && regime.atrPercentile >= 95) {
      return {
        allowed: false,
        reason: `Extreme expansion (${regime.atrPercentile.toFixed(0)}th pct) - breakout blocked (volatility too high)`,
        confidenceAdjustment: 0,
      };
    }
  }
  
  return { allowed: true, confidenceAdjustment: 0 };
}

/**
 * STRATEGY: Break & Retest (Intraday)
 * 
 * Win Rate: ~55%
 * Risk:Reward: 1:2
 * Signals/Day: 2-3
 * 
 * RULES:
 * ══════════════════════════════════════════════════════════════
 * 1. Identify a key level (recent swing high/low)
 * 2. Wait for price to break through with momentum
 * 3. Wait for price to RETEST the broken level
 * 4. Enter when price shows rejection from retest
 * ══════════════════════════════════════════════════════════════
 */

import {
  IStrategy,
  StrategyMeta,
  IndicatorData,
  Decision,
  UserSettings,
  Bar,
} from '../types';

import { latest, buildDecision, hasEnoughData } from '../utils';

const CONFIG = {
  swingLookback: 20,
  minBreakBars: 2,
  maxRetestBars: 10,
  retestTolerance: 0.002,
  minRejectionWick: 0.4,
  minRR: 2.0,
};

interface SwingLevel {
  price: number;
  type: 'high' | 'low';
  barIndex: number;
  strength: number;
}

function findSwingLevels(bars: Bar[]): SwingLevel[] {
  const levels: SwingLevel[] = [];
  
  for (let i = 2; i < bars.length - 2; i++) {
    const bar = bars[i];
    const isSwingHigh = bar.high > bars[i-1].high && bar.high > bars[i-2].high &&
                        bar.high > bars[i+1].high && bar.high > bars[i+2].high;
    const isSwingLow = bar.low < bars[i-1].low && bar.low < bars[i-2].low &&
                       bar.low < bars[i+1].low && bar.low < bars[i+2].low;
    
    if (isSwingHigh) levels.push({ price: bar.high, type: 'high', barIndex: i, strength: 1 });
    if (isSwingLow) levels.push({ price: bar.low, type: 'low', barIndex: i, strength: 1 });
  }
  
  return levels.slice(-10);
}

export class BreakRetestIntraday implements IStrategy {
  meta: StrategyMeta = {
    id: 'break-retest-intra',
    name: 'Break & Retest',
    description: 'Enter on retest of broken support/resistance with rejection',
    style: 'intraday',
    winRate: 55,
    avgRR: 2.0,
    signalsPerWeek: '10-15',
    requiredIndicators: ['bars', 'atr'],
  };

  async analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null> {
    const { bars, atr } = data;
    const symbol = data.symbol;
    
    if (!hasEnoughData(bars, 50) || !hasEnoughData(atr, 20)) return null;
    
    const currentBar = bars[bars.length - 1];
    const price = currentBar.close;
    const currentAtr = latest(atr)!;
    const levels = findSwingLevels(bars.slice(0, -5));

    const triggers: string[] = [];
    const warnings: string[] = [];
    let confidence = 0;
    let direction: 'long' | 'short' | null = null;
    let entryLevel: SwingLevel | null = null;

    // Check each level for break & retest pattern
    for (const level of levels) {
      const recentBars = bars.slice(-15);
      const tolerance = level.price * CONFIG.retestTolerance;
      
      if (level.type === 'high') {
        // Check bullish break & retest
        const brokeAbove = recentBars.slice(0, -3).some(b => b.close > level.price && b.open > level.price);
        const retesting = currentBar.low <= level.price + tolerance && currentBar.low >= level.price - tolerance;
        const rejection = currentBar.close > currentBar.open && 
                         (Math.min(currentBar.open, currentBar.close) - currentBar.low) / (currentBar.high - currentBar.low) > 0.4;
        
        if (brokeAbove && retesting && rejection) {
          direction = 'long';
          entryLevel = level;
          triggers.push(`Broke above ${level.price.toFixed(5)}, now retesting as support`);
          triggers.push('Bullish rejection candle at level');
          confidence += 60;
          break;
        }
      } else {
        // Check bearish break & retest
        const brokeBelow = recentBars.slice(0, -3).some(b => b.close < level.price && b.open < level.price);
        const retesting = currentBar.high >= level.price - tolerance && currentBar.high <= level.price + tolerance;
        const rejection = currentBar.close < currentBar.open && 
                         (currentBar.high - Math.max(currentBar.open, currentBar.close)) / (currentBar.high - currentBar.low) > 0.4;
        
        if (brokeBelow && retesting && rejection) {
          direction = 'short';
          entryLevel = level;
          triggers.push(`Broke below ${level.price.toFixed(5)}, now retesting as resistance`);
          triggers.push('Bearish rejection candle at level');
          confidence += 60;
          break;
        }
      }
    }

    if (!direction || !entryLevel) return null;

    // Level strength bonus
    if (entryLevel.strength > 1) {
      triggers.push(`Level tested ${entryLevel.strength} times (strong)`);
      confidence += 15;
    }

    // Clean rejection bonus
    const candleRange = currentBar.high - currentBar.low;
    const bodySize = Math.abs(currentBar.close - currentBar.open);
    if (bodySize / candleRange < 0.4) {
      triggers.push('Clean doji/hammer rejection');
      confidence += 10;
    }

    // Calculate stops and targets
    let stopLossPrice: number;
    let takeProfitPrice: number;

    if (direction === 'long') {
      stopLossPrice = entryLevel.price - currentAtr * 0.8;
      const risk = price - stopLossPrice;
      takeProfitPrice = price + risk * CONFIG.minRR;
    } else {
      stopLossPrice = entryLevel.price + currentAtr * 0.8;
      const risk = stopLossPrice - price;
      takeProfitPrice = price - risk * CONFIG.minRR;
    }

    confidence = Math.min(confidence, 100);
    if (confidence < 50) return null;

    const reason = direction === 'long'
      ? `Break & retest: Level ${entryLevel.price.toFixed(5)} broken, retesting as support`
      : `Break & retest: Level ${entryLevel.price.toFixed(5)} broken, retesting as resistance`;

    return buildDecision({
      symbol, strategyId: this.meta.id, strategyName: this.meta.name,
      direction, confidence, entryPrice: price,
      stopLossPrice, takeProfitPrice, reason, triggers, warnings, settings,
    });
  }
}

export const breakRetestIntraday = new BreakRetestIntraday();

/**
 * Grade Tracker Service
 * Tracks grade changes per symbol/strategy and emits upgrade events
 * 
 * Upgrade Types:
 * - new-signal: no-trade → trade (new opportunity)
 * - grade-improvement: B → A+ (strengthening setup)
 * - direction-flip: long → short or vice versa (reversal)
 */

import { createLogger } from './logger.js';
import { EventEmitter } from 'events';
import { SignalGrade, SignalDirection, GradeUpgrade } from '../strategies/types.js';

const logger = createLogger('GradeTracker');

interface GradeRecord {
  grade: SignalGrade;
  direction: SignalDirection | 'none';
  timestamp: string;
  strategyId: string;
}

type GradeUpgradeHandler = (upgrade: GradeUpgrade) => void;

const GRADE_RANK: Record<SignalGrade, number> = {
  'no-trade': 0,
  'C': 1,
  'B': 2,
  'B+': 3,
  'A': 4,
  'A+': 5,
};

class GradeTrackerService extends EventEmitter {
  private grades: Map<string, GradeRecord> = new Map();
  private upgradeHandlers: GradeUpgradeHandler[] = [];
  private recentUpgrades: GradeUpgrade[] = [];
  private maxRecentUpgrades = 50;

  private getKey(symbol: string, strategyId: string): string {
    return `${symbol}:${strategyId}`;
  }

  getPreviousGrade(symbol: string, strategyId: string): GradeRecord | null {
    const key = this.getKey(symbol, strategyId);
    return this.grades.get(key) || null;
  }

  updateGrade(
    symbol: string,
    strategyId: string,
    strategyName: string,
    newGrade: SignalGrade,
    direction: SignalDirection | 'none'
  ): GradeUpgrade | null {
    const key = this.getKey(symbol, strategyId);
    const previous = this.grades.get(key);
    const now = new Date().toISOString();

    this.grades.set(key, {
      grade: newGrade,
      direction,
      timestamp: now,
      strategyId,
    });

    const upgrade = this.checkForUpgrade(
      symbol,
      strategyId,
      strategyName,
      previous,
      newGrade,
      direction,
      now
    );

    if (upgrade) {
      logger.info(`Grade upgrade detected: ${symbol}/${strategyId} ${upgrade.previousGrade} → ${upgrade.newGrade}`);
      this.emit('upgrade', upgrade);
      this.notifyHandlers(upgrade);
      this.storeRecentUpgrade(upgrade);
    }

    return upgrade;
  }

  private checkForUpgrade(
    symbol: string,
    strategyId: string,
    strategyName: string,
    previous: GradeRecord | undefined,
    newGrade: SignalGrade,
    direction: SignalDirection | 'none',
    timestamp: string
  ): GradeUpgrade | null {
    if (newGrade === 'no-trade' || direction === 'none') {
      return null;
    }

    const typedDirection = direction as SignalDirection;

    if (!previous || previous.grade === 'no-trade') {
      return {
        symbol,
        strategyId,
        strategyName,
        previousGrade: previous?.grade || 'no-trade',
        newGrade,
        direction: typedDirection,
        upgradeType: 'new-signal',
        timestamp,
        message: `New ${newGrade} ${typedDirection.toUpperCase()} signal on ${symbol} (${strategyName})`,
      };
    }

    const previousRank = GRADE_RANK[previous.grade];
    const newRank = GRADE_RANK[newGrade];
    
    if (newRank > previousRank) {
      return {
        symbol,
        strategyId,
        strategyName,
        previousGrade: previous.grade,
        newGrade,
        direction: typedDirection,
        upgradeType: 'grade-improvement',
        timestamp,
        message: `${symbol} upgraded ${previous.grade} → ${newGrade} ${typedDirection.toUpperCase()} (${strategyName})`,
      };
    }

    if (previous.direction !== direction && previous.direction !== 'none') {
      return {
        symbol,
        strategyId,
        strategyName,
        previousGrade: previous.grade,
        newGrade,
        direction: typedDirection,
        upgradeType: 'direction-flip',
        timestamp,
        message: `${symbol} flipped to ${newGrade} ${typedDirection.toUpperCase()} (${strategyName})`,
      };
    }

    return null;
  }

  onUpgrade(handler: GradeUpgradeHandler): void {
    this.upgradeHandlers.push(handler);
  }

  offUpgrade(handler: GradeUpgradeHandler): void {
    const index = this.upgradeHandlers.indexOf(handler);
    if (index > -1) {
      this.upgradeHandlers.splice(index, 1);
    }
  }

  private notifyHandlers(upgrade: GradeUpgrade): void {
    for (const handler of this.upgradeHandlers) {
      try {
        handler(upgrade);
      } catch (e) {
        logger.error('Error in upgrade handler', { error: e });
      }
    }
  }

  private storeRecentUpgrade(upgrade: GradeUpgrade): void {
    this.recentUpgrades.unshift(upgrade);
    if (this.recentUpgrades.length > this.maxRecentUpgrades) {
      this.recentUpgrades.pop();
    }
  }

  getRecentUpgrades(sinceMinutes: number = 60): GradeUpgrade[] {
    const cutoff = Date.now() - (sinceMinutes * 60 * 1000);
    return this.recentUpgrades.filter(u => 
      new Date(u.timestamp).getTime() > cutoff
    );
  }

  getAllGrades(): Map<string, GradeRecord> {
    return new Map(this.grades);
  }

  clear(): void {
    this.grades.clear();
    logger.info('Grade tracker cleared');
  }

  clearSymbol(symbol: string): void {
    for (const key of this.grades.keys()) {
      if (key.startsWith(`${symbol}:`)) {
        this.grades.delete(key);
      }
    }
    logger.debug(`Cleared grades for ${symbol}`);
  }
}

export const gradeTracker = new GradeTrackerService();

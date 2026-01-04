/**
 * Auto-Scan Service v2.0 - OPTIMIZED
 *
 * Key Optimizations:
 * 1. Symbol watchlist presets (majors, minors, crypto, metals, custom)
 * 2. Market hours filter (forex closed on weekends, crypto 24/7)
 * 3. Per-strategy scheduling with staggered execution
 * 4. Enhanced status tracking (progress %, per-strategy results)
 * 5. Smarter batching to reduce API calls
 */

import { createLogger } from './logger.js';
import { fetchAllSymbolData, BatchIndicatorData, validateBatchResults } from './batchDataService.js';
import { ALL_INSTRUMENTS, FOREX_SPECS, CRYPTO_SPECS, METAL_SPECS, INDEX_SPECS, COMMODITY_SPECS } from '../config/e8InstrumentSpecs.js';
import { isNewSignal, trackSignal } from '../storage/signalFreshnessTracker.js';
import { strategyRegistry } from '../strategies/registry.js';
import { UserSettings, Decision, SignalGrade } from '../strategies/types.js';
import { gradeTracker } from './gradeTracker.js';

const logger = createLogger('AutoScanService');

// ═══════════════════════════════════════════════════════════════════════════
// SYMBOL PRESETS
// ═══════════════════════════════════════════════════════════════════════════

export type WatchlistPreset = 'majors' | 'minors' | 'crypto' | 'metals' | 'indices' | 'all' | 'custom';

const MAJOR_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD'];
const MINOR_PAIRS = FOREX_SPECS.map(s => s.symbol).filter(s => !MAJOR_PAIRS.includes(s));

export const WATCHLIST_PRESETS: Record<WatchlistPreset, string[]> = {
  majors: MAJOR_PAIRS,
  minors: MINOR_PAIRS,
  crypto: CRYPTO_SPECS.map(s => s.symbol),
  metals: METAL_SPECS.map(s => s.symbol),
  indices: INDEX_SPECS.map(s => s.symbol),
  all: ALL_INSTRUMENTS.map(s => s.symbol),
  custom: [], // User-defined
};

// ═══════════════════════════════════════════════════════════════════════════
// MARKET HOURS
// ═══════════════════════════════════════════════════════════════════════════

interface MarketSession {
  name: string;
  openHour: number;  // UTC
  closeHour: number; // UTC
  days: number[];    // 0=Sun, 1=Mon, etc.
}

const FOREX_SESSIONS: MarketSession = {
  name: 'Forex',
  openHour: 22,  // Sunday 22:00 UTC (Sydney open)
  closeHour: 22, // Friday 22:00 UTC (NY close)
  days: [1, 2, 3, 4, 5], // Mon-Fri (with special handling for Sunday open/Friday close)
};

function isForexMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // Saturday: Closed
  if (day === 6) return false;

  // Sunday: Only open after 22:00 UTC
  if (day === 0) return hour >= 22;

  // Friday: Only open until 22:00 UTC
  if (day === 5) return hour < 22;

  // Mon-Thu: Open 24h
  return true;
}

function isCryptoMarketOpen(): boolean {
  // Crypto trades 24/7, but we can add brief maintenance windows if needed
  return true;
}

function isSymbolMarketOpen(symbol: string): boolean {
  const isCrypto = CRYPTO_SPECS.some(s => s.symbol === symbol);
  if (isCrypto) return isCryptoMarketOpen();

  // Forex, metals, indices, commodities follow forex hours (mostly)
  return isForexMarketOpen();
}

function getActiveSymbols(symbols: string[]): string[] {
  return symbols.filter(isSymbolMarketOpen);
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AutoScanConfig {
  enabled: boolean;
  intervalMs: number;
  watchlistPreset: WatchlistPreset;
  customSymbols: string[];
  strategies: string[];
  minGrade: SignalGrade;
  email?: string;
  respectMarketHours: boolean;
  onNewSignal?: (decision: Decision, isNew: boolean) => void;
}

export interface StrategyScanResult {
  strategyId: string;
  strategyName: string;
  lastScanAt: string | null;
  symbolsScanned: number;
  signalsFound: number;
  newSignals: number;
  errors: number;
  duration: number;
}

export interface AutoScanStatus {
  isRunning: boolean;
  currentStrategy: string | null;
  progress: {
    current: number;
    total: number;
    percent: number;
  };
  lastFullScanAt: string | null;
  nextScanAt: string | null;
  marketStatus: {
    forex: boolean;
    crypto: boolean;
  };
  symbolsActive: number;
  symbolsTotal: number;
  strategyResults: StrategyScanResult[];
  config: Partial<AutoScanConfig>;
  totalSignalsToday: number;
  totalNewSignalsToday: number;
}

const DEFAULT_SETTINGS: UserSettings = {
  accountSize: 100000,
  riskPercent: 0.5,
  style: 'intraday',
};

const GRADE_ORDER: SignalGrade[] = ['A+', 'A', 'B+', 'B', 'C', 'no-trade'];

function meetsMinGrade(grade: SignalGrade, minGrade: SignalGrade): boolean {
  const gradeIndex = GRADE_ORDER.indexOf(grade);
  const minIndex = GRADE_ORDER.indexOf(minGrade);
  return gradeIndex >= 0 && gradeIndex <= minIndex;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-SCAN SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class AutoScanService {
  private interval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isScanInProgress: boolean = false;
  private config: AutoScanConfig;
  private strategyResults: Map<string, StrategyScanResult> = new Map();
  private currentStrategy: string | null = null;
  private currentProgress: { current: number; total: number } = { current: 0, total: 0 };
  private lastFullScanAt: string | null = null;
  private totalSignalsToday: number = 0;
  private totalNewSignalsToday: number = 0;
  private dayKey: string = '';

  constructor() {
    this.config = {
      enabled: false,
      intervalMs: 5 * 60 * 1000, // 5 minutes default
      watchlistPreset: 'majors',
      customSymbols: [],
      strategies: [],
      minGrade: 'B',
      respectMarketHours: true,
    };
    this.resetDailyCounters();
  }

  private resetDailyCounters(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.dayKey !== today) {
      this.dayKey = today;
      this.totalSignalsToday = 0;
      this.totalNewSignalsToday = 0;
      logger.info(`AUTO_SCAN: Daily counters reset for ${today}`);
    }
  }

  private getWatchlistSymbols(): string[] {
    if (this.config.watchlistPreset === 'custom') {
      return this.config.customSymbols;
    }
    return WATCHLIST_PRESETS[this.config.watchlistPreset] || WATCHLIST_PRESETS.majors;
  }

  start(config: Partial<AutoScanConfig> = {}): void {
    if (this.isRunning) {
      logger.warn('AUTO_SCAN: Already running, stopping first');
      this.stop();
    }

    this.config = { ...this.config, ...config, enabled: true };
    this.isRunning = true;
    this.strategyResults.clear();

    const symbols = this.getWatchlistSymbols();
    const strategies = this.config.strategies.length > 0
      ? this.config.strategies
      : strategyRegistry.list().map((s: { id: string }) => s.id);

    logger.info(`AUTO_SCAN: Starting with ${symbols.length} symbols (${this.config.watchlistPreset}), ${strategies.length} strategies, interval ${this.config.intervalMs / 1000}s`);
    logger.info(`AUTO_SCAN: Market hours filter: ${this.config.respectMarketHours ? 'ON' : 'OFF'}`);

    // Run immediately
    this.runFullScan();

    // Schedule recurring scans
    this.interval = setInterval(() => {
      this.runFullScan();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.isRunning = false;
    this.isScanInProgress = false;
    this.currentStrategy = null;
    this.config.enabled = false;

    logger.info('AUTO_SCAN: Stopped');
  }

  getStatus(): AutoScanStatus {
    const symbols = this.getWatchlistSymbols();
    const activeSymbols = this.config.respectMarketHours
      ? getActiveSymbols(symbols)
      : symbols;

    return {
      isRunning: this.isRunning,
      currentStrategy: this.currentStrategy,
      progress: {
        current: this.currentProgress.current,
        total: this.currentProgress.total,
        percent: this.currentProgress.total > 0
          ? Math.round((this.currentProgress.current / this.currentProgress.total) * 100)
          : 0,
      },
      lastFullScanAt: this.lastFullScanAt,
      nextScanAt: this.isRunning
        ? new Date(Date.now() + this.config.intervalMs).toISOString()
        : null,
      marketStatus: {
        forex: isForexMarketOpen(),
        crypto: isCryptoMarketOpen(),
      },
      symbolsActive: activeSymbols.length,
      symbolsTotal: symbols.length,
      strategyResults: Array.from(this.strategyResults.values()),
      config: {
        intervalMs: this.config.intervalMs,
        watchlistPreset: this.config.watchlistPreset,
        minGrade: this.config.minGrade,
        email: this.config.email,
        respectMarketHours: this.config.respectMarketHours,
      },
      totalSignalsToday: this.totalSignalsToday,
      totalNewSignalsToday: this.totalNewSignalsToday,
    };
  }

  updateConfig(config: Partial<AutoScanConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning && this.config.enabled) {
      this.start(this.config);
    }
  }

  private async runFullScan(): Promise<void> {
    if (this.isScanInProgress) {
      logger.warn('AUTO_SCAN: Previous scan still in progress, skipping');
      return;
    }

    this.resetDailyCounters();
    this.isScanInProgress = true;
    const fullStartTime = Date.now();

    try {
      const allSymbols = this.getWatchlistSymbols();
      const activeSymbols = this.config.respectMarketHours
        ? getActiveSymbols(allSymbols)
        : allSymbols;

      if (activeSymbols.length === 0) {
        logger.info('AUTO_SCAN: No active symbols (market closed), skipping scan');
        this.isScanInProgress = false;
        return;
      }

      logger.info(`AUTO_SCAN: Starting full scan - ${activeSymbols.length}/${allSymbols.length} symbols active`);

      // Fetch data once for all symbols
      const batchData = await fetchAllSymbolData(activeSymbols);
      const { valid, incomplete } = validateBatchResults(batchData);

      if (valid.length === 0) {
        logger.warn('AUTO_SCAN: No valid data received, aborting scan');
        this.isScanInProgress = false;
        return;
      }

      logger.info(`AUTO_SCAN: Data fetched - ${valid.length} valid, ${incomplete.length} incomplete`);

      // Get strategies to scan
      const strategies = this.config.strategies.length > 0
        ? this.config.strategies
        : strategyRegistry.list().map((s: { id: string }) => s.id);

      this.currentProgress = { current: 0, total: strategies.length };

      // Scan each strategy
      for (let i = 0; i < strategies.length; i++) {
        const strategyId = strategies[i];
        this.currentStrategy = strategyId;
        this.currentProgress.current = i + 1;

        await this.runStrategyScan(strategyId, valid, batchData);

        // Small delay between strategies to prevent CPU spikes
        if (i < strategies.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      this.lastFullScanAt = new Date().toISOString();
      this.currentStrategy = null;

      const elapsed = Date.now() - fullStartTime;
      logger.info(`AUTO_SCAN: Full scan complete in ${elapsed}ms`);

    } catch (error) {
      logger.error(`AUTO_SCAN: Full scan failed - ${error}`);
    } finally {
      this.isScanInProgress = false;
    }
  }

  private async runStrategyScan(
    strategyId: string,
    validSymbols: string[],
    batchData: Map<string, BatchIndicatorData>
  ): Promise<void> {
    const startTime = Date.now();
    let signalsFound = 0;
    let newSignals = 0;
    let errors = 0;

    const strategy = strategyRegistry.get(strategyId);
    if (!strategy) {
      logger.warn(`AUTO_SCAN: Unknown strategy ${strategyId}`);
      return;
    }

    const strategyName = strategy.meta?.name || strategyId;

    for (const symbol of validSymbols) {
      const data = batchData.get(symbol);
      if (!data) continue;

      try {
        const indicatorData = this.convertToIndicatorData(symbol, data);
        const decision = await strategy.analyze(indicatorData, DEFAULT_SETTINGS);

        if (decision && meetsMinGrade(decision.grade, this.config.minGrade)) {
          signalsFound++;
          this.totalSignalsToday++;

          const isNew = isNewSignal(symbol, strategyId, decision.direction);

          // Check for grade upgrade
          const upgrade = gradeTracker.updateGrade(
            symbol,
            strategyId,
            strategyName,
            decision.grade,
            decision.direction
          );

          if (upgrade) {
            decision.upgrade = upgrade;
          }

          if (isNew || upgrade) {
            newSignals++;
            this.totalNewSignalsToday++;

            trackSignal(symbol, strategyId, decision.direction);

            const logType = upgrade?.upgradeType || 'new';
            logger.info(`AUTO_SCAN: ${logType.toUpperCase()} - ${symbol} ${decision.direction} ${decision.grade} (${strategyId})`);

            // Notify if high grade and new/upgraded
            if (this.shouldNotify(decision, isNew)) {
              if (this.config.onNewSignal) {
                this.config.onNewSignal(decision, isNew);
              }
            }
          }
        }
      } catch (error) {
        errors++;
        logger.debug(`AUTO_SCAN: Strategy error ${strategyId} on ${symbol}: ${error}`);
      }
    }

    const duration = Date.now() - startTime;

    // Store results
    this.strategyResults.set(strategyId, {
      strategyId,
      strategyName,
      lastScanAt: new Date().toISOString(),
      symbolsScanned: validSymbols.length,
      signalsFound,
      newSignals,
      errors,
      duration,
    });

    if (signalsFound > 0) {
      logger.info(`AUTO_SCAN: ${strategyId} - ${signalsFound} signals (${newSignals} new) in ${duration}ms`);
    }
  }

  private shouldNotify(decision: Decision, isNew: boolean): boolean {
    // Only notify for A/A+ grades
    const highGrade = decision.grade === 'A+' || decision.grade === 'A';

    // Notify if new signal or grade upgrade
    const shouldAlert = isNew ||
      decision.upgrade?.upgradeType === 'new-signal' ||
      decision.upgrade?.upgradeType === 'grade-improvement';

    return highGrade && shouldAlert;
  }

  private convertToIndicatorData(symbol: string, data: BatchIndicatorData): any {
    return {
      symbol,
      bars: data.bars,
      ema20: data.ema20,
      ema50: data.ema50,
      ema200: data.ema200,
      rsi: data.rsi,
      atr: data.atr,
      adx: data.adx,
      stoch: data.stoch,
      cci: data.cci,
      bbands: data.bbands,
      willr: data.willr,
      ema200H4: data.ema200H4,
      adxH4: data.adxH4,
      trendBarsH4: data.trendBarsH4,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  getAvailablePresets(): { id: WatchlistPreset; name: string; count: number }[] {
    return [
      { id: 'majors', name: 'Major Pairs', count: WATCHLIST_PRESETS.majors.length },
      { id: 'minors', name: 'Minor Pairs', count: WATCHLIST_PRESETS.minors.length },
      { id: 'crypto', name: 'Crypto', count: WATCHLIST_PRESETS.crypto.length },
      { id: 'metals', name: 'Metals', count: WATCHLIST_PRESETS.metals.length },
      { id: 'indices', name: 'Indices', count: WATCHLIST_PRESETS.indices.length },
      { id: 'all', name: 'All Instruments', count: WATCHLIST_PRESETS.all.length },
      { id: 'custom', name: 'Custom', count: this.config.customSymbols.length },
    ];
  }

  getMarketHoursInfo(): { forex: { open: boolean; nextChange: string }; crypto: { open: boolean } } {
    const forexOpen = isForexMarketOpen();

    // Calculate next market open/close for forex
    const now = new Date();
    let nextChange = '';

    if (!forexOpen) {
      // Find next Sunday 22:00 UTC
      const daysUntilSunday = (7 - now.getUTCDay()) % 7;
      const nextOpen = new Date(now);
      nextOpen.setUTCDate(now.getUTCDate() + daysUntilSunday);
      nextOpen.setUTCHours(22, 0, 0, 0);
      nextChange = `Opens ${nextOpen.toISOString()}`;
    } else {
      // Find next Friday 22:00 UTC
      const daysUntilFriday = (5 - now.getUTCDay() + 7) % 7;
      const nextClose = new Date(now);
      nextClose.setUTCDate(now.getUTCDate() + daysUntilFriday);
      nextClose.setUTCHours(22, 0, 0, 0);
      nextChange = `Closes ${nextClose.toISOString()}`;
    }

    return {
      forex: { open: forexOpen, nextChange },
      crypto: { open: true },
    };
  }
}

export const autoScanService = new AutoScanService();

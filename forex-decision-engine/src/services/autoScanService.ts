/**
 * Auto-Scan Service v3.1 - RATE LIMIT OPTIMIZED
 *
 * Key Changes from v3.0:
 * - Sequential symbol processing (concurrency=1) with 3s delay between symbols
 * - First strategy scan: ~840 API calls (40 symbols × 21 calls each)
 * - Subsequent strategies: 0 additional calls (hit indicator bundle cache)
 * - Stays well under 610 calls/min Twelve Data limit
 * - Excludes indices from 'all' preset (requires upgraded Twelve Data plan)
 * - Real-time API call counter for rate limit monitoring
 *
 * Features:
 * 1. Symbol watchlist presets (majors, minors, crypto, metals, custom)
 * 2. Market hours filter (forex closed on weekends, crypto 24/7)
 * 3. Per-strategy scheduling with staggered execution
 * 4. Enhanced status tracking (progress %, per-strategy results)
 * 5. SSE events: scan:progress, scan:complete
 * 6. Shared rate limit pause when circuit breaker opens
 *
 * Persists config to data/autoScanConfig.json for auto-start on server reboot
 */

import { createLogger } from './logger.js';
import { analyzeWithStrategy } from '../engine/strategyAnalyzer.js';
import { ALL_INSTRUMENTS, FOREX_SPECS, CRYPTO_SPECS, METAL_SPECS, INDEX_SPECS, COMMODITY_SPECS } from '../config/e8InstrumentSpecs.js';
import { isNewSignal, trackSignal } from '../storage/signalFreshnessTracker.js';
import { signalStore } from '../storage/signalStore.js';
import { strategyRegistry } from '../strategies/registry.js';
import { gradeTracker } from './gradeTracker.js';
import { processAutoScanDecision, invalidateOnConditionChange } from './detectionService.js';
import { broadcastDetectionError, broadcastScanProgress, broadcastScanComplete } from './sseBroadcaster.js';
import { promisePool } from '../utils/promisePool.js';
import { UserSettings, Decision, SignalGrade } from '../strategies/types.js';
import { twelveDataCircuit, CircuitOpenError } from './circuitBreaker.js';
import { twelveData } from './twelveDataClient.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('AutoScanService');
const CONFIG_FILE = path.join(process.cwd(), 'data', 'autoScanConfig.json');

// Rate limit pause state - shared across all concurrent workers
let rateLimitPausePromise: Promise<void> | null = null;

/**
 * Global rate limit pause handler
 * Ensures only one wait occurs even with concurrent workers
 * Re-checks circuit state after waiting and re-arms if still open
 */
async function waitForRateLimitReset(): Promise<void> {
  // If we're already paused, just wait for the existing pause to complete
  if (rateLimitPausePromise) {
    await rateLimitPausePromise;
    // After shared wait, re-check if circuit is still open
    if (twelveDataCircuit.getState() === 'OPEN') {
      return waitForRateLimitReset(); // Re-arm if still open
    }
    return;
  }

  const circuitState = twelveDataCircuit.getState();
  if (circuitState !== 'OPEN') {
    return;
  }

  const waitTime = twelveDataCircuit.getTimeUntilRetry();
  if (waitTime <= 0) {
    // Circuit should transition to HALF_OPEN on next request
    return;
  }

  // Set up a single shared pause - first worker to detect sets this up
  logger.warn(`AUTO_SCAN: Rate limit hit - ALL workers pausing for ${Math.ceil(waitTime / 1000)}s`);
  
  rateLimitPausePromise = new Promise<void>(resolve => {
    setTimeout(() => {
      rateLimitPausePromise = null;
      // Check if circuit is ready after waiting
      const newState = twelveDataCircuit.getState();
      if (newState === 'OPEN') {
        logger.warn(`AUTO_SCAN: Circuit still OPEN after wait - will re-pause on next check`);
      } else {
        logger.info(`AUTO_SCAN: Rate limit wait complete - circuit ${newState}, resuming scan`);
      }
      resolve();
    }, waitTime + 2000); // Add 2s buffer for safety
  });

  await rateLimitPausePromise;
  
  // After wait, verify circuit state and re-arm if needed
  if (twelveDataCircuit.getState() === 'OPEN') {
    return waitForRateLimitReset();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WATCHLIST PRESETS
// ═══════════════════════════════════════════════════════════════════════════

export type WatchlistPreset = 'majors' | 'majors-gold' | 'minors' | 'crypto' | 'metals' | 'indices' | 'commodities' | 'all' | 'custom';

const MAJOR_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD'];
const MINOR_PAIRS = FOREX_SPECS.map(s => s.symbol).filter(s => !MAJOR_PAIRS.includes(s));

// Exclude indices AND disabled instruments from 'all' preset
// - Indices require higher Twelve Data plan for real-time data
// - Disabled instruments (WTI, BRENT) have stale/unreliable data
const ALL_ACTIVE_TRADABLE = ALL_INSTRUMENTS.filter(s => s.type !== 'index' && !s.disabled).map(s => s.symbol);

export const WATCHLIST_PRESETS: Record<WatchlistPreset, { symbols: string[]; description: string }> = {
  'majors': { symbols: MAJOR_PAIRS, description: '7 major forex pairs' },
  'majors-gold': { symbols: [...MAJOR_PAIRS, 'XAUUSD'], description: '7 majors + gold' },
  'minors': { symbols: MINOR_PAIRS, description: '21 minor forex pairs' },
  'crypto': { symbols: CRYPTO_SPECS.map(s => s.symbol), description: '8 cryptocurrencies (24/7)' },
  'metals': { symbols: METAL_SPECS.map(s => s.symbol), description: 'Gold & silver' },
  'indices': { symbols: INDEX_SPECS.filter(s => !s.disabled).map(s => s.symbol), description: 'Major indices (requires upgraded plan)' },
  'commodities': { symbols: COMMODITY_SPECS.filter(s => !s.disabled).map(s => s.symbol), description: 'Oil & energy (active only)' },
  'all': { symbols: ALL_ACTIVE_TRADABLE, description: `All ${ALL_ACTIVE_TRADABLE.length} active instruments` },
  'custom': { symbols: [], description: 'Custom selection' },
};

// ═══════════════════════════════════════════════════════════════════════════
// MARKET HOURS
// ═══════════════════════════════════════════════════════════════════════════

function isForexMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // Saturday: Closed
  if (day === 6) return false;

  // Sunday: Only open after 22:00 UTC (Sydney open)
  if (day === 0) return hour >= 22;

  // Friday: Only open until 22:00 UTC (NY close)
  if (day === 5) return hour < 22;

  // Mon-Thu: Open 24h
  return true;
}

function isCryptoMarketOpen(): boolean {
  // Crypto trades 24/7
  return true;
}

function getMarketDayInfo(): { dayName: string; isWeekend: boolean; reason: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[day];
  
  if (day === 6) {
    return { dayName, isWeekend: true, reason: `${dayName} (UTC) - Market closed` };
  }
  if (day === 0) {
    if (hour < 22) {
      return { dayName, isWeekend: true, reason: `${dayName} (UTC) - Opens at 22:00 UTC` };
    }
    return { dayName, isWeekend: false, reason: '' };
  }
  if (day === 5 && hour >= 22) {
    return { dayName, isWeekend: false, reason: `${dayName} (UTC) - Market closed` };
  }
  return { dayName, isWeekend: false, reason: '' };
}

function getSymbolMarketStatus(symbol: string): { open: boolean; reason?: string } {
  const isCrypto = CRYPTO_SPECS.some(s => s.symbol === symbol);
  if (isCrypto) {
    return { open: isCryptoMarketOpen() };
  }
  
  const forexOpen = isForexMarketOpen();
  if (!forexOpen) {
    const now = new Date();
    const day = now.getUTCDay();
    return { 
      open: false, 
      reason: day === 6 ? 'Weekend - Saturday' : day === 0 ? 'Weekend - Sunday (opens 22:00 UTC)' : 'Friday - Market closed'
    };
  }
  return { open: true };
}

function getActiveSymbols(symbols: string[], respectMarketHours: boolean): { active: string[]; skipped: string[] } {
  if (!respectMarketHours) {
    return { active: symbols, skipped: [] };
  }
  
  const active: string[] = [];
  const skipped: string[] = [];
  
  for (const symbol of symbols) {
    const status = getSymbolMarketStatus(symbol);
    if (status.open) {
      active.push(symbol);
    } else {
      skipped.push(symbol);
    }
  }
  
  return { active, skipped };
}

interface PersistedConfig {
  enabled: boolean;
  intervalMs: number;
  symbols: string[];
  strategies: StrategyScheduleConfig[];
  minGrade: SignalGrade;
  email?: string;
  watchlistPreset?: WatchlistPreset;
  customSymbols?: string[];
  respectMarketHours?: boolean;
}

export interface StrategyScheduleConfig {
  strategyId: string;
  intervalMs: number;
}

export interface AutoScanConfig {
  enabled: boolean;
  intervalMs: number;
  symbols: string[];
  strategies: StrategyScheduleConfig[];
  minGrade: SignalGrade;
  email?: string;
  watchlistPreset: WatchlistPreset;
  customSymbols: string[];
  respectMarketHours: boolean;
  onNewSignal?: (decision: Decision, isNew: boolean) => void;
}

export interface AutoScanStatus {
  isRunning: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
  strategyRuns: StrategyRunStatus[];
  lastScanResults: {
    symbolsScanned: number;
    signalsFound: number;
    newSignals: number;
    errors: number;
    skippedMarketClosed: number;
  } | null;
  config: Partial<AutoScanConfig>;
  marketStatus: {
    forex: boolean;
    crypto: boolean;
    forexReason?: string;
    currentDay?: string;
  };
  currentScan: {
    strategyId: string | null;
    progress: number;
    total: number;
    percent: number;
  } | null;
}

let accountSettings = {
  accountPreset: 'e8-10k',
  accountSize: 10000,
  riskPercent: 0.5,
};

const DEFAULT_SETTINGS: UserSettings = {
  accountSize: accountSettings.accountSize,
  riskPercent: accountSettings.riskPercent,
  style: 'intraday',
};

const GRADE_ORDER: SignalGrade[] = ['A+', 'A', 'B+', 'B', 'C', 'no-trade'];

interface StrategyRunStatus {
  strategyId: string;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResults: {
    symbolsScanned: number;
    signalsFound: number;
    newSignals: number;
    errors: number;
    durationMs: number;
  } | null;
}

function meetsMinGrade(grade: SignalGrade, minGrade: SignalGrade): boolean {
  const gradeIndex = GRADE_ORDER.indexOf(grade);
  const minIndex = GRADE_ORDER.indexOf(minGrade);
  return gradeIndex >= 0 && gradeIndex <= minIndex;
}

class AutoScanService {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  // H-01 FIX: Track which strategies are currently mid-scan to prevent overlapping execution
  private scanningStrategies: Set<string> = new Set();
  private config: AutoScanConfig;
  private status: AutoScanStatus;
  private startedAt: string | null = null;
  private strategyStatus: Map<string, StrategyRunStatus> = new Map();
  private alertCallback: ((decision: Decision, isNew: boolean) => void) | null = null;
  
  constructor() {
    this.config = {
      enabled: false,
      intervalMs: 10 * 60 * 1000, // 10 minutes - balanced for 610 API calls/min limit
      symbols: WATCHLIST_PRESETS['majors-gold'].symbols,
      strategies: this.buildDefaultSchedules(10 * 60 * 1000),
      minGrade: 'B',
      watchlistPreset: 'majors-gold',
      customSymbols: [],
      respectMarketHours: true,
    };
    
    this.status = {
      isRunning: false,
      lastScanAt: null,
      nextScanAt: null,
      strategyRuns: [],
      lastScanResults: null,
      config: {},
      marketStatus: {
        forex: isForexMarketOpen(),
        crypto: true,
        forexReason: isForexMarketOpen() ? undefined : getMarketDayInfo().reason,
        currentDay: getMarketDayInfo().dayName,
      },
      currentScan: null,
    };
  }
  
  setAlertCallback(callback: (decision: Decision, isNew: boolean) => void): void {
    this.alertCallback = callback;
    logger.info('AUTO_SCAN: Alert callback registered');
  }
  
  hasAlertCallback(): boolean {
    return this.alertCallback !== null;
  }
  
  start(config: Partial<AutoScanConfig> = {}): { success: boolean; error?: string } {
    if (this.isRunning) {
      logger.warn('AUTO_SCAN: Already running, stopping first');
      this.stop();
    }
    
    const email = config.email ?? this.config.email;
    if (!email || !email.includes('@')) {
      logger.warn('AUTO_SCAN: Cannot start without valid email for alerts');
      return { success: false, error: 'Valid email address required for alerts' };
    }
    
    if (!this.alertCallback) {
      logger.error('AUTO_SCAN: Cannot start - alert callback not registered. Call setAlertCallback() first.');
      return { success: false, error: 'Alert system not initialized - please restart the server' };
    }
    
    // Handle watchlist preset
    let symbols = config.symbols ?? this.config.symbols;
    if (config.watchlistPreset) {
      if (config.watchlistPreset === 'custom' && config.customSymbols) {
        symbols = config.customSymbols;
      } else if (config.watchlistPreset !== 'custom') {
        symbols = WATCHLIST_PRESETS[config.watchlistPreset]?.symbols || symbols;
      }
    }
    
    this.config = { 
      ...this.config, 
      ...config, 
      strategies: this.normalizeStrategies(config.strategies),
      intervalMs: config.intervalMs ?? this.config.intervalMs,
      symbols,
      minGrade: config.minGrade ?? this.config.minGrade,
      watchlistPreset: config.watchlistPreset ?? this.config.watchlistPreset,
      customSymbols: config.customSymbols ?? this.config.customSymbols,
      respectMarketHours: config.respectMarketHours ?? this.config.respectMarketHours,
      enabled: true 
    };
    this.isRunning = true;
    this.startedAt = new Date().toISOString();
    this.strategyStatus.clear();
    
    this.status = {
      ...this.status,
      isRunning: true,
      strategyRuns: this.getStrategyRuns(),
      config: {
        intervalMs: this.config.intervalMs,
        minGrade: this.config.minGrade,
        email: this.config.email,
        symbols: this.config.symbols,
        strategies: this.config.strategies,
        watchlistPreset: this.config.watchlistPreset,
        customSymbols: this.config.customSymbols,
        respectMarketHours: this.config.respectMarketHours,
      },
    };
    
    logger.info(`AUTO_SCAN: Starting with ${this.config.symbols.length} symbols, strategy schedules ${this.config.strategies.length}, alerts to ${this.config.email}`);
    
    this.scheduleStrategyRuns();
    this.updateNextScanTime();
    this.saveConfig();
    
    return { success: true };
  }
  
  stop(): void {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    for (const [key, run] of this.strategyStatus.entries()) {
      this.strategyStatus.set(key, { ...run, nextRunAt: null });
    }
    
    this.isRunning = false;
    this.config.enabled = false;
    
    this.status = {
      ...this.status,
      isRunning: false,
      nextScanAt: null,
      strategyRuns: this.getStrategyRuns(),
    };
    
    logger.info('AUTO_SCAN: Stopped');
    this.saveConfig();
  }
  
  getStatus(): AutoScanStatus {
    // Update market status on every call
    const dayInfo = getMarketDayInfo();
    this.status.marketStatus = {
      forex: isForexMarketOpen(),
      crypto: true,
      forexReason: isForexMarketOpen() ? undefined : dayInfo.reason,
      currentDay: dayInfo.dayName,
    };
    return { ...this.status };
  }
  
  getWatchlistPresets(): Record<WatchlistPreset, { symbols: string[]; description: string }> {
    return WATCHLIST_PRESETS;
  }
  
  getSymbolsForPreset(preset: WatchlistPreset): string[] {
    if (preset === 'custom') {
      return this.config.customSymbols;
    }
    return WATCHLIST_PRESETS[preset]?.symbols || [];
  }
  
  setWatchlistPreset(preset: WatchlistPreset, customSymbols?: string[]): void {
    this.config.watchlistPreset = preset;
    if (preset === 'custom' && customSymbols) {
      this.config.customSymbols = customSymbols;
      this.config.symbols = customSymbols;
    } else {
      this.config.symbols = WATCHLIST_PRESETS[preset]?.symbols || [];
    }
    logger.info(`AUTO_SCAN: Watchlist changed to ${preset} (${this.config.symbols.length} symbols)`);
  }
  
  updateConfig(config: Partial<AutoScanConfig>): { success: boolean; error?: string } {
    const wasRunning = this.isRunning;
    
    if (wasRunning) {
      this.stop();
    }
    
    this.config = { 
      ...this.config, 
      ...config,
      strategies: this.normalizeStrategies(config.strategies),
      intervalMs: config.intervalMs ?? this.config.intervalMs,
      symbols: config.symbols ?? this.config.symbols,
      minGrade: config.minGrade ?? this.config.minGrade,
    };
    
    if (wasRunning && this.config.enabled) {
      const result = this.start(this.config);
      if (!result.success) {
        logger.warn(`AUTO_SCAN: Failed to restart after config update: ${result.error}`);
        return result;
      }
    }
    
    return { success: true };
  }
  
  private updateNextScanTime(): void {
    if (!this.isRunning) return;
    const nextTimes = this.getStrategyRuns()
      .map(r => r.nextRunAt)
      .filter((v): v is string => !!v)
      .map(v => new Date(v).getTime());
    
    if (nextTimes.length > 0) {
      const next = Math.min(...nextTimes);
      this.status.nextScanAt = new Date(next).toISOString();
    } else {
      this.status.nextScanAt = null;
    }
  }

  private getStrategyRuns(): StrategyRunStatus[] {
    return Array.from(this.strategyStatus.values()).sort((a, b) => a.strategyId.localeCompare(b.strategyId));
  }

  private buildDefaultSchedules(intervalMs: number): StrategyScheduleConfig[] {
    return strategyRegistry.list().map((s: { id: string }) => ({
      strategyId: s.id,
      intervalMs,
    }));
  }

  private normalizeStrategies(strategies?: StrategyScheduleConfig[] | string[]): StrategyScheduleConfig[] {
    const provided = Array.isArray(strategies) && strategies.length > 0
      ? strategies
      : this.config?.strategies || this.buildDefaultSchedules(this.config.intervalMs);
    
    const normalized: StrategyScheduleConfig[] = [];
    const seen = new Set<string>();
    const defaultInterval = this.config.intervalMs || 10 * 60 * 1000;

    for (const item of provided) {
      if (typeof item === 'string') {
        if (!strategyRegistry.get(item)) continue;
        if (seen.has(item)) continue;
        seen.add(item);
        normalized.push({ strategyId: item, intervalMs: defaultInterval });
        continue;
      }

      if (!item.strategyId) continue;
      if (!strategyRegistry.get(item.strategyId)) continue;
      if (seen.has(item.strategyId)) continue;
      seen.add(item.strategyId);

      normalized.push({
        strategyId: item.strategyId,
        intervalMs: item.intervalMs || defaultInterval,
      });
    }

    return normalized.length > 0 ? normalized : this.buildDefaultSchedules(defaultInterval);
  }

  private scheduleStrategyRuns(): void {
    const schedules = this.normalizeStrategies(this.config.strategies);
    const staggerMs = Math.min(15000, Math.floor((this.config.intervalMs || 1000) / Math.max(1, schedules.length)));

    schedules.forEach((schedule, index) => {
      const initialDelay = staggerMs * index;
      this.scheduleNextRun(schedule, initialDelay);
    });

    this.status.strategyRuns = this.getStrategyRuns();
  }

  private scheduleNextRun(schedule: StrategyScheduleConfig, delayMs: number): void {
    const now = Date.now();
    const nextRunAt = new Date(now + delayMs).toISOString();

    this.strategyStatus.set(schedule.strategyId, {
      strategyId: schedule.strategyId,
      intervalMs: schedule.intervalMs,
      lastRunAt: this.strategyStatus.get(schedule.strategyId)?.lastRunAt || null,
      nextRunAt,
      lastResults: this.strategyStatus.get(schedule.strategyId)?.lastResults || null,
    });

    const timer = setTimeout(async () => {
      this.timers.delete(schedule.strategyId);
      await this.runScan(schedule);
      this.scheduleNextRun(schedule, schedule.intervalMs);
    }, delayMs);

    this.timers.set(schedule.strategyId, timer);
    this.status.strategyRuns = this.getStrategyRuns();
  }
  
  private async runScan(schedule: StrategyScheduleConfig): Promise<void> {
    // H-01 FIX: Prevent overlapping scans for the same strategy
    if (this.scanningStrategies.has(schedule.strategyId)) {
      logger.warn(`AUTO_SCAN: Strategy ${schedule.strategyId} still scanning from previous cycle, skipping`);
      return;
    }
    this.scanningStrategies.add(schedule.strategyId);

    const startTime = Date.now();

    // Update market status
    const dayInfo = getMarketDayInfo();
    this.status.marketStatus = {
      forex: isForexMarketOpen(),
      crypto: true,
      forexReason: isForexMarketOpen() ? undefined : dayInfo.reason,
      currentDay: dayInfo.dayName,
    };
    
    // Filter symbols by market hours
    const { active: symbolsToScan, skipped } = getActiveSymbols(
      this.config.symbols, 
      this.config.respectMarketHours
    );
    
    if (symbolsToScan.length === 0) {
      logger.info(`AUTO_SCAN: All ${this.config.symbols.length} symbols skipped (market closed)`);
      this.status.lastScanResults = {
        symbolsScanned: 0,
        signalsFound: 0,
        newSignals: 0,
        errors: 0,
        skippedMarketClosed: skipped.length,
      };
      // H-01 FIX: Clear scanning lock on early return
      this.scanningStrategies.delete(schedule.strategyId);
      return;
    }
    
    logger.info(`AUTO_SCAN: Starting ${schedule.strategyId} scan of ${symbolsToScan.length} symbols (${skipped.length} skipped - market closed)`);
    
    // Update current scan progress
    this.status.currentScan = {
      strategyId: schedule.strategyId,
      progress: 0,
      total: symbolsToScan.length,
      percent: 0,
    };
    
    let symbolsScanned = 0;
    let signalsFound = 0;
    let newSignals = 0;
    let errors = 0;

    // RATE LIMIT FIX: Sequential symbol processing (concurrency=1)
    // - Each symbol requires 21 API calls when cache is cold
    // - 40 symbols × 21 calls = 840 calls for first strategy scan
    // - Subsequent strategies hit bundle cache = 0 additional calls
    // - With delayBetweenStarts=3000ms, we spread 21 calls over ~3s = ~420 calls/min
    // - This stays well under the 610 calls/min Twelve Data limit
    const CONCURRENCY = 1;
    const DELAY_BETWEEN_SYMBOLS_MS = 3000; // 3 second gap between symbols

    // Process symbols sequentially with delay to stay under rate limit
    const poolResult = await promisePool({
      items: symbolsToScan,
      concurrency: CONCURRENCY,
      delayBetweenStarts: DELAY_BETWEEN_SYMBOLS_MS,
      handler: async (symbol: string, index: number) => {
        try {
          // Check if we need to wait for rate limit reset (global shared pause)
          await waitForRateLimitReset();
          
          // Use dynamic account settings for position sizing
          const dynamicSettings: UserSettings = {
            accountSize: accountSettings.accountSize,
            riskPercent: accountSettings.riskPercent,
            style: 'intraday',
          };
          
          // Use individual API calls via analyzeWithStrategy
          const result = await analyzeWithStrategy(
            symbol,
            schedule.strategyId,
            dynamicSettings,
            { skipCache: false, skipCooldown: false, skipVolatility: false }
          );

          return { symbol, result, error: null };
        } catch (error) {
          // If circuit opened during request, wait for reset and retry once
          if (error instanceof CircuitOpenError) {
            await waitForRateLimitReset();
            
            // Retry once after the shared wait completes
            try {
              const dynamicSettings: UserSettings = {
                accountSize: accountSettings.accountSize,
                riskPercent: accountSettings.riskPercent,
                style: 'intraday',
              };
              const result = await analyzeWithStrategy(
                symbol,
                schedule.strategyId,
                dynamicSettings,
                { skipCache: false, skipCooldown: false, skipVolatility: false }
              );
              logger.debug(`AUTO_SCAN: ${symbol} succeeded after rate limit retry`);
              return { symbol, result, error: null };
            } catch (retryError) {
              return { symbol, result: null, error: retryError instanceof Error ? retryError : new Error(String(retryError)) };
            }
          }
          return { symbol, result: null, error: error instanceof Error ? error : new Error(String(error)) };
        }
      },
      onProgress: (completed: number, total: number) => {
        const percent = Math.round((completed / total) * 100);
        const elapsed = Date.now() - startTime;

        // Update internal status
        this.status.currentScan = {
          strategyId: schedule.strategyId,
          progress: completed,
          total,
          percent,
        };

        // Broadcast SSE progress event
        broadcastScanProgress({
          strategyId: schedule.strategyId,
          progress: completed,
          total,
          percent,
          elapsedMs: elapsed,
        });
      },
    });

    // Process results from the parallel execution
    for (const item of poolResult.results) {
      if (!item) continue;
      const { symbol, result, error: itemError } = item;

      if (itemError || !result) {
        errors++;
        const msg = itemError?.message || 'Unknown error';
        logger.debug(`AUTO_SCAN: Error analyzing ${symbol} with ${schedule.strategyId}: ${msg}`);
        continue;
      }

      symbolsScanned++;

      // Count analyzer errors (non-empty errors array)
      if (result.errors.length > 0) {
        errors += result.errors.length;
        logger.debug(`AUTO_SCAN: ${symbol} had ${result.errors.length} errors: ${result.errors.join(', ')}`);
      }

      // Safely access decision (may be null if analysis failed)
      const decision = result.decision;

      if (decision && decision.grade && meetsMinGrade(decision.grade, this.config.minGrade)) {
        signalsFound++;

        const upgrade = gradeTracker.updateGrade(
          symbol,
          schedule.strategyId,
          decision.strategyName || schedule.strategyId,
          decision.grade,
          decision.direction
        );

        if (upgrade) {
          decision.upgrade = upgrade;
        }

        const isNew = isNewSignal(symbol, schedule.strategyId, decision.direction);

        if (isNew) {
          newSignals++;
          trackSignal(symbol, schedule.strategyId, decision.direction);

          // Invalidate opposite direction detections
          await invalidateOnConditionChange(
            schedule.strategyId,
            symbol,
            decision.direction as 'long' | 'short'
          );
        }

        // Persist detection for cooldown tracking
        try {
          // Ensure decision has required fields for detection
          const enrichedDecision = {
            ...decision,
            strategyId: decision.strategyId || schedule.strategyId,
            strategyName: decision.strategyName || schedule.strategyId,
            timestamp: decision.timestamp || new Date().toISOString(),
          };
          await processAutoScanDecision(enrichedDecision);
          
          // Archive signal to history for future reference
          try {
            await signalStore.saveSignal(enrichedDecision);
            logger.debug(`AUTO_SCAN: Archived signal for ${symbol} ${decision.grade} to signal history`);
          } catch (saveError) {
            const saveErrorMsg = saveError instanceof Error ? saveError.message : 'Unknown error';
            logger.warn(`AUTO_SCAN: Failed to archive signal for ${symbol}: ${saveErrorMsg}`);
          }
        } catch (detectionError) {
          const errorMsg = detectionError instanceof Error ? detectionError.message : 'Unknown error';
          logger.warn(`AUTO_SCAN: Failed to persist detection for ${symbol}: ${errorMsg}`);
          broadcastDetectionError(symbol, errorMsg);
        }

        if (this.shouldNotify(decision, isNew)) {
          if (this.alertCallback) {
            this.alertCallback(decision, isNew);
          } else {
            logger.warn(`AUTO_SCAN: Qualifying ${decision.grade} signal found but NO ALERT CALLBACK configured - email will not be sent!`);
          }
        }

        if (isNew) {
          logger.info(`AUTO_SCAN: NEW SIGNAL - ${symbol} ${decision.direction} ${decision.grade} (${schedule.strategyId})`);
        }
      }
    }

    // Add pool-level errors
    errors += poolResult.errors.length;
    
    const elapsed = Date.now() - startTime;

    const lastRunAt = new Date().toISOString();
    this.status.lastScanAt = lastRunAt;
    this.status.currentScan = null;
    this.status.lastScanResults = {
      symbolsScanned,
      signalsFound,
      newSignals,
      errors,
      skippedMarketClosed: skipped.length,
    };
    
    this.strategyStatus.set(schedule.strategyId, {
      strategyId: schedule.strategyId,
      intervalMs: schedule.intervalMs,
      lastRunAt,
      nextRunAt: new Date(Date.now() + schedule.intervalMs).toISOString(),
      lastResults: {
        symbolsScanned,
        signalsFound,
        newSignals,
        errors,
        durationMs: elapsed,
      },
    });

    this.status.strategyRuns = this.getStrategyRuns();
    this.updateNextScanTime();

    // Broadcast scan complete event via SSE
    broadcastScanComplete(schedule.strategyId, elapsed, {
      symbolsScanned,
      signalsFound,
      newSignals,
      errors,
    });

    // Log API call stats for rate limit monitoring
    const apiStats = twelveData.getApiStats();
    logger.info(`AUTO_SCAN: ${schedule.strategyId} complete in ${elapsed}ms - ${symbolsScanned} symbols, ${signalsFound} signals (${newSignals} new), ${errors} errors | API: ${apiStats.callsLastMinute}/${apiStats.limit} (${apiStats.percentUsed}%)`);

    // H-01 FIX: Clear scanning lock when scan completes
    this.scanningStrategies.delete(schedule.strategyId);
  }

  private shouldNotify(decision: Decision, isNew: boolean): boolean {
    const highGrade = decision.grade === 'A+' || decision.grade === 'A';
    const upgradeTypes = decision.upgrade?.upgradeType === 'new-signal' || decision.upgrade?.upgradeType === 'grade-improvement';
    return highGrade && (isNew || upgradeTypes);
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const persistedConfig: PersistedConfig = {
        enabled: this.config.enabled,
        intervalMs: this.config.intervalMs,
        symbols: this.config.symbols,
        strategies: this.config.strategies,
        minGrade: this.config.minGrade,
        email: this.config.email,
        watchlistPreset: this.config.watchlistPreset,
        customSymbols: this.config.customSymbols,
        respectMarketHours: this.config.respectMarketHours,
      };
      
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(persistedConfig, null, 2), 'utf-8');
      logger.debug(`AUTO_SCAN: Config saved to ${CONFIG_FILE}`);
    } catch (error) {
      logger.error('AUTO_SCAN: Failed to save config', { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  private loadConfig(): PersistedConfig | null {
    try {
      if (!fs.existsSync(CONFIG_FILE)) {
        logger.debug('AUTO_SCAN: No saved config found');
        return null;
      }
      
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(content) as PersistedConfig;
      
      const registeredStrategies = strategyRegistry.list().map(s => s.id);
      const savedStrategyIds = config.strategies.map(s => s.strategyId);
      let migrated = false;
      
      for (const stratId of registeredStrategies) {
        if (!savedStrategyIds.includes(stratId)) {
          logger.info(`AUTO_SCAN: Auto-migrating new strategy to config: ${stratId}`);
          config.strategies.push({
            strategyId: stratId,
            intervalMs: config.intervalMs
          });
          migrated = true;
        }
      }
      
      if (migrated) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        logger.info('AUTO_SCAN: Config migrated with new strategies');
      }
      
      logger.info('AUTO_SCAN: Loaded saved config', { enabled: config.enabled, strategies: config.strategies.length });
      return config;
    } catch (error) {
      logger.error('AUTO_SCAN: Failed to load config', { error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    }
  }

  autoStartIfEnabled(): void {
    if (!this.alertCallback) {
      logger.error('AUTO_SCAN: Cannot auto-start - alert callback not registered. Call setAlertCallback() first.');
      return;
    }
    
    const savedConfig = this.loadConfig();
    if (savedConfig && savedConfig.enabled) {
      if (!savedConfig.email || !savedConfig.email.includes('@')) {
        logger.warn('AUTO_SCAN: Cannot auto-start - saved config missing valid email');
        return;
      }
      logger.info('AUTO_SCAN: Auto-starting from saved config');
      const result = this.start(savedConfig);
      if (!result.success) {
        logger.warn(`AUTO_SCAN: Auto-start failed: ${result.error}`);
      }
    } else {
      logger.debug('AUTO_SCAN: No enabled config to auto-start');
    }
  }
  
  updateAccountSettings(settings: { accountPreset?: string; accountSize?: number; riskPercent?: number }): void {
    if (settings.accountPreset) accountSettings.accountPreset = settings.accountPreset;
    if (settings.accountSize) accountSettings.accountSize = settings.accountSize;
    if (settings.riskPercent) accountSettings.riskPercent = settings.riskPercent;
    
    logger.info(`AUTO_SCAN: Account settings updated - $${accountSettings.accountSize}, ${accountSettings.riskPercent}% risk`);
  }
  
  getAccountSettings(): typeof accountSettings {
    return { ...accountSettings };
  }
}

export const autoScanService = new AutoScanService();

/**
 * Auto-Scan Service
 * Background scanner that runs every 5 minutes using batch API
 * Detects NEW signals and triggers alerts
 * Persists config to data/autoScanConfig.json for auto-start on server reboot
 */

import { createLogger } from './logger.js';
import { fetchAllSymbolData, BatchIndicatorData, validateBatchResults } from './batchDataService.js';
import { ALL_INSTRUMENTS } from '../config/e8InstrumentSpecs.js';
import { isNewSignal, trackSignal } from '../storage/signalFreshnessTracker.js';
import { strategyRegistry } from '../strategies/registry.js';
import { gradeTracker } from './gradeTracker.js';
import { UserSettings, Decision, SignalGrade } from '../strategies/types.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('AutoScanService');
const CONFIG_FILE = path.join(process.cwd(), 'data', 'autoScanConfig.json');

interface PersistedConfig {
  enabled: boolean;
  intervalMs: number;
  symbols: string[];
  strategies: StrategyScheduleConfig[];
  minGrade: SignalGrade;
  email?: string;
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
  } | null;
  config: Partial<AutoScanConfig>;
}

const DEFAULT_SETTINGS: UserSettings = {
  accountSize: 100000,
  riskPercent: 0.5,
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
  private config: AutoScanConfig;
  private status: AutoScanStatus;
  private startedAt: string | null = null;
  private strategyStatus: Map<string, StrategyRunStatus> = new Map();
  
  constructor() {
    this.config = {
      enabled: false,
      intervalMs: 5 * 60 * 1000,
      symbols: ALL_INSTRUMENTS.map(i => i.symbol),
      strategies: this.buildDefaultSchedules(5 * 60 * 1000),
      minGrade: 'B',
    };
    
    this.status = {
      isRunning: false,
      lastScanAt: null,
      nextScanAt: null,
      strategyRuns: [],
      lastScanResults: null,
      config: {},
    };
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
    
    this.config = { 
      ...this.config, 
      ...config, 
      strategies: this.normalizeStrategies(config.strategies),
      intervalMs: config.intervalMs ?? this.config.intervalMs,
      symbols: config.symbols ?? this.config.symbols,
      minGrade: config.minGrade ?? this.config.minGrade,
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
    return { ...this.status };
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
    const defaultInterval = this.config.intervalMs || 5 * 60 * 1000;

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
    const startTime = Date.now();
    logger.info(`AUTO_SCAN: Starting ${schedule.strategyId} scan of ${this.config.symbols.length} symbols`);
    
    let symbolsScanned = 0;
    let signalsFound = 0;
    let newSignals = 0;
    let errors = 0;
    
    try {
      const batchData = await fetchAllSymbolData(this.config.symbols);
      const { valid, incomplete } = validateBatchResults(batchData);
      
      symbolsScanned = valid.length;
      errors = incomplete.length;
      
      for (const symbol of valid) {
        const data = batchData.get(symbol);
        if (!data) continue;
        
        try {
          const strategy = strategyRegistry.get(schedule.strategyId);
          if (!strategy) continue;
          
          const indicatorData = this.convertToIndicatorData(symbol, data);
          const decision = await strategy.analyze(indicatorData, DEFAULT_SETTINGS);
          
          if (decision && meetsMinGrade(decision.grade, this.config.minGrade)) {
            signalsFound++;
            
            const upgrade = gradeTracker.updateGrade(
              symbol,
              schedule.strategyId,
              decision.strategyName,
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
            }

            if (this.config.onNewSignal && this.shouldNotify(decision, isNew)) {
              this.config.onNewSignal(decision, isNew);
            }
            
            if (isNew) {
              logger.info(`AUTO_SCAN: NEW SIGNAL - ${symbol} ${decision.direction} ${decision.grade} (${schedule.strategyId})`);
            }
          }
        } catch (strategyError) {
          errors++;
          logger.debug(`AUTO_SCAN: Strategy error ${schedule.strategyId} on ${symbol}: ${strategyError}`);
        }
      }
    } catch (error) {
      logger.error(`AUTO_SCAN: Scan failed for ${schedule.strategyId} - ${error}`);
      errors++;
    }
    
    const elapsed = Date.now() - startTime;

    const lastRunAt = new Date().toISOString();
    this.status.lastScanAt = lastRunAt;
    this.status.lastScanResults = {
      symbolsScanned,
      signalsFound,
      newSignals,
      errors,
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
    
    logger.info(`AUTO_SCAN: ${schedule.strategyId} complete in ${elapsed}ms - ${symbolsScanned} symbols, ${signalsFound} signals (${newSignals} new), ${errors} errors`);
  }

  private shouldNotify(decision: Decision, isNew: boolean): boolean {
    const highGrade = decision.grade === 'A+' || decision.grade === 'A';
    const upgradeTypes = decision.upgrade?.upgradeType === 'new-signal' || decision.upgrade?.upgradeType === 'grade-improvement';
    return highGrade && (isNew || upgradeTypes);
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
      logger.info('AUTO_SCAN: Loaded saved config', { enabled: config.enabled, strategies: config.strategies.length });
      return config;
    } catch (error) {
      logger.error('AUTO_SCAN: Failed to load config', { error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    }
  }

  autoStartIfEnabled(): void {
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
}

export const autoScanService = new AutoScanService();

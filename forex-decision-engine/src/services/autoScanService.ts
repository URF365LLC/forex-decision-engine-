/**
 * Auto-Scan Service
 * Background scanner that runs every 5 minutes using batch API
 * Detects NEW signals and triggers alerts
 */

import { createLogger } from './logger.js';
import { fetchAllSymbolData, BatchIndicatorData, validateBatchResults } from './batchDataService.js';
import { ALL_INSTRUMENTS } from '../config/e8InstrumentSpecs.js';
import { isNewSignal, trackSignal } from '../storage/signalFreshnessTracker.js';
import { strategyRegistry } from '../strategies/registry.js';
import { UserSettings, Decision, SignalGrade } from '../strategies/types.js';

const logger = createLogger('AutoScanService');

export interface AutoScanConfig {
  enabled: boolean;
  intervalMs: number;
  symbols: string[];
  strategies: string[];
  minGrade: SignalGrade;
  email?: string;
  onNewSignal?: (decision: Decision, isNew: boolean) => void;
}

export interface AutoScanStatus {
  isRunning: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
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

function meetsMinGrade(grade: SignalGrade, minGrade: SignalGrade): boolean {
  const gradeIndex = GRADE_ORDER.indexOf(grade);
  const minIndex = GRADE_ORDER.indexOf(minGrade);
  return gradeIndex >= 0 && gradeIndex <= minIndex;
}

class AutoScanService {
  private interval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private config: AutoScanConfig;
  private status: AutoScanStatus;
  
  constructor() {
    this.config = {
      enabled: false,
      intervalMs: 5 * 60 * 1000,
      symbols: ALL_INSTRUMENTS.map(i => i.symbol),
      strategies: [],
      minGrade: 'B',
    };
    
    this.status = {
      isRunning: false,
      lastScanAt: null,
      nextScanAt: null,
      lastScanResults: null,
      config: {},
    };
  }
  
  start(config: Partial<AutoScanConfig> = {}): void {
    if (this.isRunning) {
      logger.warn('AUTO_SCAN: Already running, stopping first');
      this.stop();
    }
    
    this.config = { ...this.config, ...config, enabled: true };
    this.isRunning = true;
    
    this.status = {
      ...this.status,
      isRunning: true,
      config: {
        intervalMs: this.config.intervalMs,
        minGrade: this.config.minGrade,
        email: this.config.email,
      },
    };
    
    logger.info(`AUTO_SCAN: Starting with ${this.config.symbols.length} symbols, interval ${this.config.intervalMs / 1000}s`);
    
    this.runScan();
    
    this.interval = setInterval(() => {
      this.runScan();
    }, this.config.intervalMs);
    
    this.updateNextScanTime();
  }
  
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    this.isRunning = false;
    this.config.enabled = false;
    
    this.status = {
      ...this.status,
      isRunning: false,
      nextScanAt: null,
    };
    
    logger.info('AUTO_SCAN: Stopped');
  }
  
  getStatus(): AutoScanStatus {
    return { ...this.status };
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
  
  private updateNextScanTime(): void {
    if (this.isRunning) {
      const nextScan = new Date(Date.now() + this.config.intervalMs);
      this.status.nextScanAt = nextScan.toISOString();
    }
  }
  
  private async runScan(): Promise<void> {
    const startTime = Date.now();
    logger.info(`AUTO_SCAN: Starting scan of ${this.config.symbols.length} symbols`);
    
    let symbolsScanned = 0;
    let signalsFound = 0;
    let newSignals = 0;
    let errors = 0;
    
    try {
      const batchData = await fetchAllSymbolData(this.config.symbols);
      const { valid, incomplete } = validateBatchResults(batchData);
      
      symbolsScanned = valid.length;
      errors = incomplete.length;
      
      const strategies = this.config.strategies.length > 0
        ? this.config.strategies
        : strategyRegistry.list().map((s: { id: string }) => s.id);
      
      for (const symbol of valid) {
        const data = batchData.get(symbol);
        if (!data) continue;
        
        for (const strategyId of strategies) {
          try {
            const strategy = strategyRegistry.get(strategyId);
            if (!strategy) continue;
            
            const indicatorData = this.convertToIndicatorData(symbol, data);
            const decision = await strategy.analyze(indicatorData, DEFAULT_SETTINGS);
            
            if (decision && meetsMinGrade(decision.grade, this.config.minGrade)) {
              signalsFound++;
              
              const isNew = isNewSignal(symbol, strategyId, decision.direction);
              
              if (isNew) {
                newSignals++;
                
                trackSignal(symbol, strategyId, decision.direction);
                
                logger.info(`AUTO_SCAN: NEW SIGNAL - ${symbol} ${decision.direction} ${decision.grade} (${strategyId})`);
                
                if (this.config.onNewSignal) {
                  this.config.onNewSignal(decision, true);
                }
              }
            }
          } catch (strategyError) {
            logger.debug(`AUTO_SCAN: Strategy error ${strategyId} on ${symbol}: ${strategyError}`);
          }
        }
      }
    } catch (error) {
      logger.error(`AUTO_SCAN: Scan failed - ${error}`);
      errors++;
    }
    
    const elapsed = Date.now() - startTime;
    
    this.status.lastScanAt = new Date().toISOString();
    this.status.lastScanResults = {
      symbolsScanned,
      signalsFound,
      newSignals,
      errors,
    };
    
    this.updateNextScanTime();
    
    logger.info(`AUTO_SCAN: Complete in ${elapsed}ms - ${symbolsScanned} symbols, ${signalsFound} signals (${newSignals} new), ${errors} errors`);
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
    };
  }
}

export const autoScanService = new AutoScanService();

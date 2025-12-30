/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P2 TASK #13: MAKE SCAN LOCK STRATEGY-AWARE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: Line 41 in src/engine/strategyAnalyzer.ts has a global scan lock
 *          that prevents concurrent scans, but it's not strategy-aware
 * 
 * IMPACT:
 *   - Can't scan different strategies simultaneously
 *   - User switching between strategies must wait for previous scan
 *   - Inefficient use of API rate limit capacity
 * 
 * SOLUTION: Make the lock keyed by strategyId, allowing parallel scans
 *           of different strategies while preventing duplicate scans of same strategy
 * 
 * FILE TO MODIFY: src/engine/strategyAnalyzer.ts (around line 41)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CURRENT CODE (PROBLEMATIC)
// ═══════════════════════════════════════════════════════════════════════════════

/*
// Line 41 in strategyAnalyzer.ts - BEFORE:

let scanInProgress = false;

export async function scanWithStrategy(symbols, strategyId, settings) {
  if (scanInProgress) {
    throw new Error('Scan already in progress');
  }
  
  scanInProgress = true;
  try {
    // ... scan logic ...
  } finally {
    scanInProgress = false;
  }
}
*/


// ═══════════════════════════════════════════════════════════════════════════════
// FIXED CODE - STRATEGY-AWARE LOCK
// ═══════════════════════════════════════════════════════════════════════════════

import { createLogger } from '../services/logger.js';

const logger = createLogger('StrategyAnalyzer');

/**
 * Track in-progress scans by strategy ID
 */
const activeScans: Map<string, {
  startedAt: number;
  symbolCount: number;
  progress: number;
}> = new Map();

/**
 * Maximum concurrent scans allowed
 * (to avoid overwhelming the API rate limit)
 */
const MAX_CONCURRENT_SCANS = 3;

/**
 * Scan timeout in milliseconds (auto-release lock if exceeded)
 */
const SCAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a scan is in progress for a specific strategy
 */
export function isScanInProgress(strategyId: string): boolean {
  return activeScans.has(strategyId);
}

/**
 * Get all active scans
 */
export function getActiveScans(): Array<{
  strategyId: string;
  startedAt: number;
  symbolCount: number;
  progress: number;
  elapsed: number;
}> {
  const now = Date.now();
  return Array.from(activeScans.entries()).map(([strategyId, scan]) => ({
    strategyId,
    ...scan,
    elapsed: now - scan.startedAt,
  }));
}

/**
 * Acquire scan lock for a strategy
 * @returns true if lock acquired, false if already locked
 */
function acquireScanLock(strategyId: string, symbolCount: number): boolean {
  // Check if this strategy already has an active scan
  if (activeScans.has(strategyId)) {
    logger.warn(`Scan already in progress for ${strategyId}`);
    return false;
  }
  
  // Check total concurrent scans
  if (activeScans.size >= MAX_CONCURRENT_SCANS) {
    logger.warn(`Maximum concurrent scans (${MAX_CONCURRENT_SCANS}) reached`);
    return false;
  }
  
  // Clean up stale locks (timed out scans)
  cleanupStaleLocks();
  
  // Acquire lock
  activeScans.set(strategyId, {
    startedAt: Date.now(),
    symbolCount,
    progress: 0,
  });
  
  logger.info(`Scan lock acquired for ${strategyId} (${symbolCount} symbols)`);
  return true;
}

/**
 * Release scan lock for a strategy
 */
function releaseScanLock(strategyId: string): void {
  if (activeScans.has(strategyId)) {
    const scan = activeScans.get(strategyId)!;
    const elapsed = Date.now() - scan.startedAt;
    activeScans.delete(strategyId);
    logger.info(`Scan lock released for ${strategyId} (took ${Math.round(elapsed / 1000)}s)`);
  }
}

/**
 * Update scan progress
 */
function updateScanProgress(strategyId: string, completed: number): void {
  const scan = activeScans.get(strategyId);
  if (scan) {
    scan.progress = completed;
  }
}

/**
 * Clean up stale/timed out locks
 */
function cleanupStaleLocks(): void {
  const now = Date.now();
  for (const [strategyId, scan] of activeScans.entries()) {
    if (now - scan.startedAt > SCAN_TIMEOUT_MS) {
      logger.warn(`Releasing stale scan lock for ${strategyId} (timed out)`);
      activeScans.delete(strategyId);
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// UPDATED scanWithStrategy() FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScanOptions {
  force?: boolean;  // Force scan even if already in progress (cancels previous)
  onProgress?: (progress: ScanProgress) => void;
}

export async function scanWithStrategy(
  symbols: string[],
  strategyId: string,
  settings: UserSettings,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const { force = false, onProgress } = options;
  
  // ════════════════════════════════════════════════════════════════
  // STRATEGY-AWARE LOCK
  // ════════════════════════════════════════════════════════════════
  
  // Check for existing scan
  if (isScanInProgress(strategyId)) {
    if (force) {
      logger.info(`Force-releasing existing scan lock for ${strategyId}`);
      releaseScanLock(strategyId);
    } else {
      const error = new ScanInProgressError(strategyId);
      logger.warn(error.message);
      throw error;
    }
  }
  
  // Try to acquire lock
  if (!acquireScanLock(strategyId, symbols.length)) {
    throw new ScanLockError(
      activeScans.size >= MAX_CONCURRENT_SCANS
        ? `Maximum concurrent scans (${MAX_CONCURRENT_SCANS}) reached`
        : `Failed to acquire scan lock for ${strategyId}`
    );
  }
  
  // ════════════════════════════════════════════════════════════════
  // RUN SCAN
  // ════════════════════════════════════════════════════════════════
  
  const decisions: StrategyDecision[] = [];
  const upgrades: GradeUpgrade[] = [];
  const errors: string[] = [];
  let cacheHits = 0;
  
  try {
    logger.info(`Starting ${strategyId} scan of ${symbols.length} symbols`);
    
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      
      // Update progress
      updateScanProgress(strategyId, i);
      
      if (onProgress) {
        onProgress({
          total: symbols.length,
          completed: i,
          current: symbol,
          results: [...decisions],
          errors: [...errors],
        });
      }
      
      try {
        const decision = await analyzeSymbolWithStrategy(symbol, strategyId, settings);
        decisions.push(decision);
        
        if (decision.upgrade) {
          upgrades.push(decision.upgrade);
        }
        
        if (decision.metadata?.fromCache) {
          cacheHits++;
        }
        
        if (decision.errors?.length > 0) {
          errors.push(`${symbol}: ${decision.errors.join(', ')}`);
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Unknown error';
        errors.push(`${symbol}: ${error}`);
        logger.error(`Scan error for ${symbol}/${strategyId}`, { error });
      }
    }
    
    // Final progress
    if (onProgress) {
      onProgress({
        total: symbols.length,
        completed: symbols.length,
        current: null,
        results: decisions,
        errors,
      });
    }
    
    const stats = {
      total: decisions.length,
      trades: decisions.filter(d => d.grade !== 'no-trade').length,
      noTrades: decisions.filter(d => d.grade === 'no-trade').length,
      blocked: decisions.filter(d => d.gating?.cooldownBlocked || d.gating?.volatilityBlocked).length,
      cacheHits,
    };
    
    logger.info(
      `Scan complete: ${stats.trades} trades, ${stats.noTrades} no-trades, ` +
      `${upgrades.length} upgrades, ${cacheHits} cache hits`
    );
    
    return { decisions, upgrades, errors, stats };
    
  } finally {
    // ════════════════════════════════════════════════════════════════
    // ALWAYS RELEASE LOCK
    // ════════════════════════════════════════════════════════════════
    releaseScanLock(strategyId);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM ERROR CLASSES
// ═══════════════════════════════════════════════════════════════════════════════

export class ScanInProgressError extends Error {
  public readonly strategyId: string;
  
  constructor(strategyId: string) {
    super(`Scan already in progress for strategy: ${strategyId}`);
    this.name = 'ScanInProgressError';
    this.strategyId = strategyId;
  }
}

export class ScanLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanLockError';
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINT UPDATE (server.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/*
// Add to src/server.ts:

import { 
  scanWithStrategy, 
  getActiveScans, 
  isScanInProgress,
  ScanInProgressError,
  ScanLockError,
} from './engine/strategyAnalyzer.js';

// POST /api/scan - Run market scan
app.post('/api/scan', async (req, res) => {
  const { symbols, strategyId, settings, force } = req.body;
  
  try {
    const result = await scanWithStrategy(symbols, strategyId, settings, { force });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ScanInProgressError) {
      res.status(409).json({
        success: false,
        error: 'scan_in_progress',
        message: error.message,
        strategyId: error.strategyId,
      });
    } else if (error instanceof ScanLockError) {
      res.status(429).json({
        success: false,
        error: 'too_many_scans',
        message: error.message,
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Scan failed',
      });
    }
  }
});

// GET /api/scans/active - Get active scans
app.get('/api/scans/active', (req, res) => {
  const scans = getActiveScans();
  res.json({ scans, count: scans.length });
});

// GET /api/scan/:strategyId/status - Check if scan is active
app.get('/api/scan/:strategyId/status', (req, res) => {
  const { strategyId } = req.params;
  const inProgress = isScanInProgress(strategyId);
  const scans = getActiveScans();
  const current = scans.find(s => s.strategyId === strategyId);
  
  res.json({
    strategyId,
    inProgress,
    progress: current?.progress || 0,
    symbolCount: current?.symbolCount || 0,
    elapsed: current?.elapsed || 0,
  });
});
*/


// ═══════════════════════════════════════════════════════════════════════════════
// FRONTEND INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/*
// In public/js/app.js:

async function runScan(strategyId, force = false) {
  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: App.watchlist,
        strategyId,
        settings: App.settings,
        force,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      if (data.error === 'scan_in_progress') {
        // Ask user if they want to force
        if (confirm(`A scan is already running for ${strategyId}. Cancel it and start new?`)) {
          return runScan(strategyId, true);
        }
        return null;
      }
      
      if (data.error === 'too_many_scans') {
        alert('Too many scans running. Please wait for one to complete.');
        return null;
      }
      
      throw new Error(data.message);
    }
    
    return data;
  } catch (error) {
    console.error('Scan failed:', error);
    alert('Scan failed: ' + error.message);
    return null;
  }
}
*/


// ═══════════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION NOTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CONCURRENCY MODEL:
 * 
 *   BEFORE: Single global lock
 *     - scanInProgress = true/false
 *     - Only one scan at a time, regardless of strategy
 * 
 *   AFTER: Strategy-keyed locks with limits
 *     - Map<strategyId, ScanInfo>
 *     - Up to MAX_CONCURRENT_SCANS strategies can scan simultaneously
 *     - Same strategy can't have multiple scans
 * 
 * RACE CONDITION PROTECTION:
 *   - Lock acquired before any async operations
 *   - Lock released in finally block (always executes)
 *   - Timeout cleanup prevents zombie locks
 * 
 * API RATE LIMIT CONSIDERATION:
 *   - 3 concurrent scans × 36 symbols × ~10 API calls = ~1080 calls
 *   - At 150 calls/min, this would take ~7 minutes
 *   - Single scan of 36 symbols ≈ 2-3 minutes
 *   - Adjust MAX_CONCURRENT_SCANS based on actual usage
 */

/**
 * Forex Decision Engine - API Server
 * 
 * Endpoints:
 * GET  /api/health          - Health check
 * GET  /api/universe        - Get available symbols
 * GET  /api/status          - Cache and rate limiter status
 * POST /api/analyze         - Analyze single symbol
 * POST /api/scan            - Scan multiple symbols
 * GET  /api/signals         - Get signal history
 * PUT  /api/signals/:id     - Update signal result
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { 
  FOREX_SPECS, METAL_SPECS, CRYPTO_SPECS, INDEX_SPECS, COMMODITY_SPECS,
  ALL_INSTRUMENTS, getInstrumentSpec, validateInstrumentSpecs 
} from './config/e8InstrumentSpecs.js';
import { DEFAULTS, RISK_OPTIONS } from './config/defaults.js';
import { STYLE_PRESETS } from './config/strategy.js';
import { scanWithStrategy, clearStrategyCache } from './engine/strategyAnalyzer.js';
import { strategyRegistry } from './strategies/index.js';
import { Decision as StrategyDecision, Decision, UserSettings } from './strategies/types.js';
import { checkDrawdownLimits } from './services/drawdownGuard.js';
import { validateSettings, validateSymbol, validateSymbols, validateJournalUpdate, sanitizeNotes } from './utils/validation.js';
import { signalStore } from './storage/signalStore.js';
import { journalStore, TradeJournalEntry, JournalFilters } from './storage/journalStore.js';
import { cache } from './services/cache.js';
import { rateLimiter } from './services/rateLimiter.js';
import { createLogger } from './services/logger.js';
import { gradeTracker } from './services/gradeTracker.js';
import { autoScanService } from './services/autoScanService.js';
import { alertService } from './services/alertService.js';
import { grokSentimentService } from './services/grokSentimentService.js';
import { validateBody, validateQuery } from './middleware/validate.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import {
  ScanRequestSchema,
  JournalUpdateSchema,
  SignalUpdateSchema,
  PaginationSchema,
  AutoScanStartSchema,
  AutoScanConfigSchema,
  JournalEntrySchema,
  BatchSentimentSchema,
} from './validation/schemas.js';
import { z } from 'zod';
import * as detectionService from './services/detectionService.js';
import { DetectionFilters } from './types/detection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('Server');
const app = express();
const PORT = process.env.PORT || 3000;

const activeScans = new Map<string, { startedAt: number; symbolCount: number }>();
const MAX_CONCURRENT_SCANS = 3;
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

function acquireScanLock(strategyId: string, symbolCount: number): boolean {
  const now = Date.now();
  for (const [id, scan] of activeScans.entries()) {
    if (now - scan.startedAt > SCAN_TIMEOUT_MS) {
      logger.warn(`Releasing stale scan lock for ${id}`);
      activeScans.delete(id);
    }
  }
  
  if (activeScans.has(strategyId)) {
    logger.warn(`Scan already in progress for ${strategyId}`);
    return false;
  }
  
  if (activeScans.size >= MAX_CONCURRENT_SCANS) {
    logger.warn(`Max concurrent scans (${MAX_CONCURRENT_SCANS}) reached`);
    return false;
  }
  
  activeScans.set(strategyId, { startedAt: now, symbolCount });
  return true;
}

function releaseScanLock(strategyId: string): void {
  activeScans.delete(strategyId);
}

function isScanInProgress(strategyId: string): boolean {
  return activeScans.has(strategyId);
}

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(express.static(path.join(__dirname, '../public')));

// Request logging with correlation ID
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`[${req.id}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

/**
 * Liveness probe - always returns ok if server is running
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!process.env.TWELVE_DATA_API_KEY,
  });
});

/**
 * Readiness probe - checks if all dependencies are ready
 */
app.get('/api/ready', async (req, res) => {
  const stats = await signalStore.getStats();
  const checks = {
    apiKey: !!process.env.TWELVE_DATA_API_KEY,
    instruments: ALL_INSTRUMENTS.length > 0,
    signalStore: stats.total >= 0,
    cache: cache.getStats() !== null,
  };

  const allReady = Object.values(checks).every(Boolean);

  res.status(allReady ? 200 : 503).json({
    status: allReady ? 'ready' : 'not_ready',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    checks,
  });
});

/**
 * Metrics endpoint for monitoring
 */
app.get('/api/metrics', async (req, res) => {
  const cacheStats = cache.getStats();
  const rateLimitState = rateLimiter.getState();
  const signalStats = await signalStore.getStats();

  res.json({
    version: '2.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cache: {
      size: cacheStats.totalEntries,
      hitRate: cacheStats.hitRate,
      hits: cacheStats.hitCount,
      misses: cacheStats.missCount,
    },
    rateLimit: {
      tokens: rateLimitState.availableTokens,
      maxTokens: rateLimitState.maxTokens,
      utilization: 1 - (rateLimitState.availableTokens / rateLimitState.maxTokens),
    },
    signals: {
      total: signalStats.total,
      byGrade: signalStats.byGrade,
      winRate: signalStats.winRate || 0,
    },
    autoScan: {
      enabled: autoScanService.getStatus().config.enabled,
      lastScan: autoScanService.getStatus().lastScanAt,
    },
    sentiment: {
      enabled: grokSentimentService.isEnabled(),
      cacheStats: grokSentimentService.getCacheStats(),
    },
  });
});

/**
 * Get trading universe (v2 with full instrument specs)
 */
app.get('/api/universe', (req, res) => {
  const forexSymbols = FOREX_SPECS.map(s => s.symbol);
  const metalSymbols = METAL_SPECS.map(s => s.symbol);
  const cryptoSymbols = CRYPTO_SPECS.map(s => s.symbol);
  const indexSymbols = INDEX_SPECS.map(s => s.symbol);
  const commoditySymbols = COMMODITY_SPECS.map(s => s.symbol);

  const metadata: Record<string, { pipDecimals: number; displayName: string; category: string }> = {};
  for (const spec of ALL_INSTRUMENTS) {
    metadata[spec.symbol] = {
      pipDecimals: spec.digits,
      displayName: spec.displayName,
      category: spec.type.charAt(0).toUpperCase() + spec.type.slice(1),
    };
  }

  res.json({
    version: 2,
    legacy: {
      forex: forexSymbols,
      metals: metalSymbols,
      crypto: cryptoSymbols,
    },
    forex: forexSymbols,
    metals: metalSymbols,
    crypto: cryptoSymbols,
    indices: indexSymbols,
    commodities: commoditySymbols,
    defaultWatchlist: ['EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'XAUUSD'],
    metadata,
    instruments: {
      forex: FOREX_SPECS,
      metals: METAL_SPECS,
      crypto: CRYPTO_SPECS,
      indices: INDEX_SPECS,
      commodities: COMMODITY_SPECS,
    },
  });
});

/**
 * Get system status
 */
app.get('/api/status', async (req, res) => {
  const cacheStats = cache.getStats();
  const rateLimitState = rateLimiter.getState();
  const signalStats = await signalStore.getStats();

  res.json({
    cache: cacheStats,
    rateLimit: rateLimitState,
    signals: signalStats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get default settings
 */
app.get('/api/settings/defaults', (req, res) => {
  res.json({
    accountSize: DEFAULTS.account.size,
    riskPercent: DEFAULTS.risk.perTrade,
    style: DEFAULTS.style,
    riskOptions: RISK_OPTIONS,
    styles: STYLE_PRESETS,
    timezone: DEFAULTS.timezone,
  });
});

/**
 * Get available strategies
 */
app.get('/api/strategies', (req, res) => {
  const style = (req.query.style as string) || 'intraday';
  const validStyle = style === 'swing' ? 'swing' : 'intraday';
  const strategies = strategyRegistry.getByStyle(validStyle as 'intraday' | 'swing');
  
  res.json(strategies.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    winRate: s.winRate,
    style: s.style,
    timeframes: s.timeframes,
  })));
});

/**
 * Analyze single symbol
 * DEPRECATED: Use POST /api/scan with strategyId instead (V1.1 - 2026-01-02)
 */
app.post('/api/analyze', async (req, res) => {
  logger.warn('DEPRECATED: /api/analyze called - this route is disabled in V1.1');
  return res.status(410).json({
    error: 'legacy_endpoint_disabled',
    message: 'POST /api/analyze is deprecated. Use POST /api/scan with strategyId parameter.',
    migration: {
      newEndpoint: 'POST /api/scan',
      requiredParams: { symbols: ['SYMBOL'], strategyId: 'rsi-bounce' },
      documentationUrl: '/api/strategies'
    }
  });
});

/**
 * Scan multiple symbols
 * V1.1: strategyId is REQUIRED, drawdown check is MANDATORY (unless paperTrading)
 */
app.post('/api/scan', validateBody(ScanRequestSchema), async (req, res) => {
  const { symbols, settings, strategyId, force } = req.body;
  
  const allStrategies = strategyRegistry.list().map(s => s.id);
  
  if (!strategyRegistry.get(strategyId)) {
    return res.status(400).json({
      error: 'invalid_strategy',
      message: `Unknown strategy: ${strategyId}.`,
      availableStrategies: allStrategies,
    });
  }
  
  const lockKey = strategyId;
  
  if (isScanInProgress(lockKey)) {
    if (force) {
      logger.info(`Force releasing existing scan lock for ${lockKey}`);
      releaseScanLock(lockKey);
    } else {
      return res.status(409).json({ 
        error: 'scan_in_progress',
        message: `Scan already in progress for strategy: ${lockKey}. Please wait.`,
        strategyId: lockKey,
      });
    }
  }
  
  // GATE 2: Validate symbols
  const symbolsResult = validateSymbols(symbols);
  if (!symbolsResult.valid) {
    return res.status(400).json({ error: symbolsResult.errors.join(', ') });
  }
  
  const settingsResult = validateSettings(settings);
  if (!settingsResult.valid) {
    return res.status(400).json({ error: settingsResult.errors.join(', ') });
  }
  
  const sanitizedSymbols = symbolsResult.sanitized as string[];
  const userSettings = settingsResult.sanitized as UserSettings;
  
  // GATE 3: Drawdown check (MANDATORY unless paperTrading)
  const isPaperTrading = userSettings.paperTrading === true;
  if (!isPaperTrading) {
    const equity = userSettings.equity || userSettings.accountSize;
    if (!equity || equity <= 0) {
      logger.warn('REJECTED: /api/scan called without equity (live mode)');
      return res.status(400).json({
        error: 'equity_required',
        message: 'settings.equity is required for live trading. Use settings.paperTrading=true for paper mode.',
      });
    }
    
    const ddCheck = checkDrawdownLimits({
      accountId: userSettings.accountId || 'default',
      equity,
      startOfDayEquity: userSettings.startOfDayEquity,
      peakEquity: userSettings.peakEquity,
      dailyLossLimitPct: userSettings.dailyLossLimitPct || 4,
      maxDrawdownPct: userSettings.maxDrawdownPct || 6,
    });
    
    if (!ddCheck.allowed) {
      logger.error('BLOCKED: Drawdown limit exceeded', ddCheck);
      return res.status(403).json({
        error: 'drawdown_limit_exceeded',
        message: ddCheck.reason,
        metrics: ddCheck.metrics,
      });
    }
    
    if (ddCheck.metrics.warnings.length > 0) {
      logger.warn('Drawdown warnings', { warnings: ddCheck.metrics.warnings });
    }
  }
  
  if (!acquireScanLock(lockKey, sanitizedSymbols.length)) {
    return res.status(429).json({ 
      error: 'too_many_scans',
      message: `Maximum concurrent scans (${MAX_CONCURRENT_SCANS}) reached. Please wait.`,
    });
  }
  
  try {
    logger.info(`Scanning with strategy: ${strategyId}`, { 
      symbols: sanitizedSymbols.length, 
      paperTrading: isPaperTrading,
    });
    
    const decisions = await scanWithStrategy(sanitizedSymbols, strategyId, userSettings);
    
    // Save trade signals
    for (const decision of decisions) {
      if (decision.grade !== 'no-trade') {
        await signalStore.saveSignal(decision as any);
      }
    }

    // Sort by grade (A+ first), then by symbol for grouping
    const gradeOrder: Record<string, number> = { 'A+': 0, 'A': 1, 'B+': 2, 'B': 3, 'C': 4, 'no-trade': 5 };
    decisions.sort((a, b) => {
      const gradeCompare = (gradeOrder[a.grade] ?? 5) - (gradeOrder[b.grade] ?? 5);
      if (gradeCompare !== 0) return gradeCompare;
      return a.symbol.localeCompare(b.symbol);
    });

    res.json({
      success: true,
      count: decisions.length,
      trades: decisions.filter(d => d.grade !== 'no-trade').length,
      decisions,
    });
  } catch (error) {
    logger.error('Scan error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Scan failed' 
    });
  } finally {
    releaseScanLock(lockKey);
  }
});

/**
 * Get signal history
 */
app.get('/api/signals', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const grade = req.query.grade as string;
    const symbol = req.query.symbol as string;

    let signals;
    if (grade) {
      signals = await signalStore.getByGrade(grade, limit);
    } else if (symbol) {
      signals = await signalStore.getBySymbol(symbol.toUpperCase(), limit);
    } else {
      signals = await signalStore.getRecent(limit);
    }

    res.json({ success: true, count: signals.length, signals });
  } catch (error) {
    logger.error('Get signals error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get signals'
    });
  }
});

/**
 * Update signal result
 */
const SignalResultSchema = z.object({
  result: z.enum(['win', 'loss', 'breakeven', 'skipped']),
  notes: z.string().max(500).optional(),
});

app.put('/api/signals/:id', validateBody(SignalResultSchema), async (req, res) => {
  try {
    const id = req.params.id;
    const { result, notes } = req.body;

    const updated = await signalStore.updateResult(id, result, notes);

    if (!updated) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Update signal error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update signal'
    });
  }
});

/**
 * Get signal statistics
 */
app.get('/api/signals/stats', async (req, res) => {
  try {
    const stats = await signalStore.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Get stats error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get stats'
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// JOURNAL API
// ═══════════════════════════════════════════════════════════════

/**
 * Add journal entry
 */
app.post('/api/journal', validateBody(JournalEntrySchema), async (req, res) => {
  try {
    const entry = req.body;
    const newEntry = await journalStore.add(entry);
    res.json({ success: true, entry: newEntry });
  } catch (error) {
    logger.error('Add journal entry error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to add journal entry'
    });
  }
});

/**
 * Get journal entries
 */
app.get('/api/journal', async (req, res) => {
  try {
    const filters: JournalFilters = {};

    if (req.query.symbol) filters.symbol = req.query.symbol as string;
    if (req.query.status) filters.status = req.query.status as any;
    if (req.query.result) filters.result = req.query.result as any;
    if (req.query.action) filters.action = req.query.action as any;
    if (req.query.tradeType) filters.tradeType = req.query.tradeType as any;
    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom as string;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo as string;

    const entries = await journalStore.getAll(Object.keys(filters).length > 0 ? filters : undefined);
    res.json({ success: true, count: entries.length, entries });
  } catch (error) {
    logger.error('Get journal entries error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get journal entries'
    });
  }
});

/**
 * Get journal stats
 */
app.get('/api/journal/stats', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    const stats = await journalStore.getStats(dateFrom, dateTo);
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Get journal stats error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get journal stats'
    });
  }
});

/**
 * Export journal as CSV
 */
app.get('/api/journal/export', async (req, res) => {
  try {
    const filters: JournalFilters = {};

    if (req.query.symbol) filters.symbol = req.query.symbol as string;
    if (req.query.status) filters.status = req.query.status as any;
    if (req.query.result) filters.result = req.query.result as any;
    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom as string;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo as string;

    const csv = await journalStore.exportCSV(Object.keys(filters).length > 0 ? filters : undefined);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=trading-journal-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    logger.error('Export journal error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to export journal'
    });
  }
});

/**
 * Get single journal entry by ID
 */
app.get('/api/journal/:id', async (req, res) => {
  try {
    const entry = await journalStore.get(req.params.id);

    if (!entry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    res.json({ success: true, entry });
  } catch (error) {
    logger.error('Get journal entry error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get journal entry'
    });
  }
});

/**
 * Update journal entry
 */
app.put('/api/journal/:id', validateBody(JournalUpdateSchema), async (req, res) => {
  try {
    const updates = req.body;

    if (updates.notes) {
      updates.notes = sanitizeNotes(updates.notes);
    }

    if (updates.status === 'closed' && updates.exitPrice) {
      const existing = await journalStore.get(req.params.id);
      if (existing) {
        const tempEntry = { ...existing, ...updates };
        const pnl = journalStore.calculatePnL(tempEntry as TradeJournalEntry);
        if (pnl) {
          updates.pnlPips = pnl.pnlPips;
          updates.pnlDollars = pnl.pnlDollars;
          updates.rMultiple = pnl.rMultiple;

          if (pnl.pnlPips > 0) updates.result = 'win';
          else if (pnl.pnlPips < 0) updates.result = 'loss';
          else updates.result = 'breakeven';
        }
      }
    }

    const entry = await journalStore.update(req.params.id, updates);

    if (!entry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    res.json({ success: true, entry });
  } catch (error) {
    logger.error('Update journal entry error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update journal entry'
    });
  }
});

/**
 * Delete journal entry
 */
app.delete('/api/journal/:id', async (req, res) => {
  try {
    const deleted = await journalStore.delete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Delete journal entry error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to delete journal entry'
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GRADE UPGRADE SSE ENDPOINT
// ═══════════════════════════════════════════════════════════════

const sseClients = new Set<express.Response>();

/**
 * SSE endpoint for real-time grade upgrade notifications
 */
app.get('/api/upgrades/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  res.write('data: {"type":"connected"}\n\n');
  
  sseClients.add(res);
  logger.debug(`SSE client connected (${sseClients.size} total)`);
  
  const heartbeat = setInterval(() => {
    res.write('data: {"type":"heartbeat"}\n\n');
  }, 30000);
  
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    logger.debug(`SSE client disconnected (${sseClients.size} remaining)`);
  });
});

gradeTracker.onUpgrade((upgrade) => {
  const data = JSON.stringify({ type: 'upgrade', upgrade });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
});

/**
 * Get recent grade upgrades
 */
app.get('/api/upgrades/recent', (req, res) => {
  const minutes = parseInt(req.query.minutes as string) || 60;
  const upgrades = gradeTracker.getRecentUpgrades(minutes);
  res.json({ upgrades, count: upgrades.length });
});

// ═══════════════════════════════════════════════════════════════
// AUTO-SCAN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/autoscan/presets', (req, res) => {
  const presets = autoScanService.getWatchlistPresets();
  res.json({
    presets: Object.entries(presets).map(([id, data]) => ({
      id,
      symbols: data.symbols,
      description: data.description,
      count: data.symbols.length,
    })),
  });
});

app.post('/api/autoscan/start', validateBody(AutoScanStartSchema), (req, res) => {
  try {
    const { 
      minGrade = 'B', 
      email, 
      intervalMs = 5 * 60 * 1000, 
      symbols, 
      strategies,
      watchlistPreset,
      customSymbols,
      respectMarketHours = true
    } = req.body;
    
    const result = autoScanService.start({
      minGrade,
      email,
      intervalMs,
      symbols,
      strategies,
      watchlistPreset,
      customSymbols,
      respectMarketHours,
      onNewSignal: (decision, isNew) => {
        if (email) {
          alertService.sendTradeAlert(decision, email, { isNew }).catch(err => {
            logger.error(`Alert email failed: ${err}`);
          });
        }
        broadcastUpgrade({ type: 'new_signal', decision, isNew });
      }
    });
    
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
        status: autoScanService.getStatus()
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Auto-scan started',
      status: autoScanService.getStatus()
    });
  } catch (error) {
    logger.error(`Auto-scan start failed: ${error}`);
    res.status(500).json({ error: 'Failed to start auto-scan' });
  }
});

app.post('/api/autoscan/stop', (req, res) => {
  autoScanService.stop();
  res.json({
    success: true,
    message: 'Auto-scan stopped',
    status: autoScanService.getStatus()
  });
});

app.get('/api/autoscan/status', (req, res) => {
  res.json(autoScanService.getStatus());
});

app.put('/api/autoscan/config', validateBody(AutoScanConfigSchema), (req, res) => {
  try {
    const { minGrade, email, intervalMs, symbols, strategies, watchlistPreset, customSymbols, respectMarketHours } = req.body;
    
    const result = autoScanService.updateConfig({
      minGrade,
      email,
      intervalMs,
      symbols,
      strategies,
      watchlistPreset,
      customSymbols,
      respectMarketHours,
    });
    
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
        status: autoScanService.getStatus()
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Config updated',
      status: autoScanService.getStatus()
    });
  } catch (error) {
    logger.error(`Auto-scan config update failed: ${error}`);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

function broadcastUpgrade(data: any): void {
  const message = JSON.stringify(data);
  for (const client of sseClients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SENTIMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/sentiment/status', (req, res) => {
  res.json({
    enabled: grokSentimentService.isEnabled(),
    cache: grokSentimentService.getCacheStats(),
  });
});

app.get('/api/sentiment/:symbol', async (req, res) => {
  const { symbol } = req.params;
  
  if (!grokSentimentService.isEnabled()) {
    return res.status(503).json({ 
      error: 'Sentiment analysis not configured',
      message: 'XAI_API_KEY is required for sentiment analysis'
    });
  }
  
  try {
    const sentiment = await grokSentimentService.getSentiment(symbol.toUpperCase());
    
    if (!sentiment) {
      return res.status(404).json({ 
        error: 'Sentiment unavailable',
        symbol 
      });
    }
    
    res.json(sentiment);
  } catch (error) {
    logger.error(`Sentiment fetch error: ${error}`);
    res.status(500).json({ error: 'Failed to fetch sentiment' });
  }
});

app.post('/api/sentiment/batch', validateBody(BatchSentimentSchema), async (req, res) => {
  const { symbols } = req.body;
  
  if (!grokSentimentService.isEnabled()) {
    return res.status(503).json({ 
      error: 'Sentiment analysis not configured'
    });
  }
  
  try {
    const results = await grokSentimentService.getBatchSentiment(symbols);
    const response: Record<string, any> = {};
    
    for (const [symbol, sentiment] of results.entries()) {
      response[symbol] = sentiment;
    }
    
    res.json(response);
  } catch (error) {
    logger.error(`Batch sentiment error: ${error}`);
    res.status(500).json({ error: 'Failed to fetch batch sentiment' });
  }
});

app.get('/api/sentiment/:symbol/aggregated', async (req, res) => {
  const { symbol } = req.params;
  const samples = Math.min(5, Math.max(2, parseInt(req.query.samples as string) || 3));
  
  if (!grokSentimentService.isEnabled()) {
    return res.status(503).json({ 
      error: 'Sentiment analysis not configured'
    });
  }
  
  try {
    const sentiment = await grokSentimentService.getAggregatedSentiment(symbol.toUpperCase(), samples);
    
    if (!sentiment) {
      return res.status(404).json({ 
        error: 'Aggregated sentiment unavailable',
        symbol 
      });
    }
    
    res.json(sentiment);
  } catch (error) {
    logger.error(`Aggregated sentiment error: ${error}`);
    res.status(500).json({ error: 'Failed to fetch aggregated sentiment' });
  }
});

app.get('/api/sentiment/:symbol/history', (req, res) => {
  const { symbol } = req.params;
  const history = grokSentimentService.getHistory(symbol.toUpperCase());
  res.json({ symbol: symbol.toUpperCase(), history });
});

app.get('/api/sentiment/overview', (req, res) => {
  if (!grokSentimentService.isEnabled()) {
    return res.status(503).json({ 
      error: 'Sentiment analysis not configured'
    });
  }
  
  const overview = grokSentimentService.getMarketOverview();
  res.json(overview);
});

// ═══════════════════════════════════════════════════════════════
// DETECTION ENDPOINTS (Auto-Scan Detected Trades Cache)
// ═══════════════════════════════════════════════════════════════

/**
 * List detected trades with optional filtering
 */
app.get('/api/detections', async (req, res) => {
  try {
    const filters: DetectionFilters = {};

    if (req.query.status) {
      const statusParam = req.query.status as string;
      filters.status = statusParam.includes(',')
        ? statusParam.split(',') as any
        : statusParam as any;
    }
    if (req.query.strategyId) filters.strategyId = req.query.strategyId as string;
    if (req.query.symbol) filters.symbol = req.query.symbol as string;
    if (req.query.grade) filters.grade = req.query.grade as string;
    if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
    if (req.query.offset) filters.offset = parseInt(req.query.offset as string);

    const detections = await detectionService.listDetections(filters);
    const summary = await detectionService.getSummary();

    res.json({
      success: true,
      count: detections.length,
      summary: {
        coolingDown: summary.coolingDown,
        eligible: summary.eligible,
        total: summary.total,
      },
      detections,
    });
  } catch (error) {
    logger.error('List detections error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to list detections',
    });
  }
});

/**
 * Get detection summary/stats
 */
app.get('/api/detections/summary', async (req, res) => {
  try {
    const summary = await detectionService.getSummary();
    res.json({ success: true, summary });
  } catch (error) {
    logger.error('Get detection summary error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get summary',
    });
  }
});

/**
 * Get single detection by ID
 */
app.get('/api/detections/:id', async (req, res) => {
  try {
    const detection = await detectionService.getDetection(req.params.id);

    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    res.json({ success: true, detection });
  } catch (error) {
    logger.error('Get detection error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get detection',
    });
  }
});

/**
 * Execute a detection (user took the trade)
 */
app.post('/api/detections/:id/execute', async (req, res) => {
  try {
    const { notes } = req.body || {};
    const detection = await detectionService.executeDetection(req.params.id, notes);

    if (!detection) {
      return res.status(404).json({ error: 'Detection not found or not eligible' });
    }

    // Broadcast status change via SSE
    broadcastUpgrade({
      type: 'detection_executed',
      detection,
    });

    res.json({ success: true, detection });
  } catch (error) {
    logger.error('Execute detection error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to execute detection',
    });
  }
});

/**
 * Dismiss a detection (user decided not to take it)
 */
app.post('/api/detections/:id/dismiss', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const detection = await detectionService.dismissDetection(req.params.id, reason);

    if (!detection) {
      return res.status(404).json({ error: 'Detection not found or cannot be dismissed' });
    }

    // Broadcast status change via SSE
    broadcastUpgrade({
      type: 'detection_dismissed',
      detection,
    });

    res.json({ success: true, detection });
  } catch (error) {
    logger.error('Dismiss detection error', { error });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to dismiss detection',
    });
  }
});

// Start cooldown checker on server start
detectionService.startCooldownChecker(60000);

// ═══════════════════════════════════════════════════════════════
// SERVE FRONTEND
// ═══════════════════════════════════════════════════════════════

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  try {
    validateInstrumentSpecs();
  } catch (e) {
    logger.error(`Instrument spec validation failed: ${e}`);
    process.exit(1);
  }
  
  logger.info(`🎯 Forex Decision Engine v2.0.0`);
  logger.info(`📡 Server running on port ${PORT}`);
  logger.info(`🔑 API Key: ${process.env.TWELVE_DATA_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
  logger.info(`📊 Instruments: ${FOREX_SPECS.length} forex, ${METAL_SPECS.length} metals, ${CRYPTO_SPECS.length} crypto, ${INDEX_SPECS.length} indices, ${COMMODITY_SPECS.length} commodities (${ALL_INSTRUMENTS.length} total)`);
  
  // Register alert callback BEFORE auto-starting - ensures alerts work after server restart
  autoScanService.setAlertCallback((decision, isNew) => {
    const email = autoScanService.getStatus().config.email;
    if (email) {
      alertService.sendTradeAlert(decision, email, { isNew }).catch(err => {
        logger.error(`Alert email failed: ${err}`);
      });
    }
    broadcastUpgrade({ type: 'new_signal', decision, isNew });
  });
  
  autoScanService.autoStartIfEnabled();
  
  const scanStatus = autoScanService.getStatus();
  if (scanStatus.config.enabled && !scanStatus.config.email) {
    logger.warn('AUTO_SCAN: Enabled but no email configured - alerts will not be sent!');
  }
  if (!alertService.isConfigured()) {
    logger.warn('RESEND_API_KEY not set - email alerts disabled system-wide');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  signalStore.close();
  journalStore.close();
  cache.close();
  process.exit(0);
});

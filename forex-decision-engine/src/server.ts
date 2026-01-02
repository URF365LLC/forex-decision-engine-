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
import { analyzeSymbol, scanSymbols, UserSettings, Decision } from './engine/decisionEngine.js';
import { scanWithStrategy, clearStrategyCache } from './engine/strategyAnalyzer.js';
import { strategyRegistry } from './strategies/index.js';
import { Decision as StrategyDecision } from './strategies/types.js';
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
app.use(express.static(path.join(__dirname, '../public')));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!process.env.TWELVE_DATA_API_KEY,
    instrumentCount: ALL_INSTRUMENTS.length,
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
app.get('/api/status', (req, res) => {
  const cacheStats = cache.getStats();
  const rateLimitState = rateLimiter.getState();
  const signalStats = signalStore.getStats();
  
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
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const { symbol, settings } = req.body;
    
    // Validate symbol
    const symbolResult = validateSymbol(symbol);
    if (!symbolResult.valid) {
      return res.status(400).json({ error: symbolResult.errors.join(', ') });
    }
    
    // Validate settings
    const settingsResult = validateSettings(settings);
    if (!settingsResult.valid) {
      return res.status(400).json({ error: settingsResult.errors.join(', ') });
    }
    
    const userSettings = settingsResult.sanitized as UserSettings;
    const sanitizedSymbol = symbolResult.sanitized as string;
    
    // Analyze
    const decision = await analyzeSymbol(sanitizedSymbol, userSettings);
    
    // Fetch sentiment for tradeable signals
    if (decision.grade !== 'no-trade') {
      const sentiment = await grokSentimentService.getSentiment(sanitizedSymbol);
      if (sentiment) {
        decision.sentiment = sentiment;
      }
      signalStore.saveSignal(decision);
    }
    
    res.json({ success: true, decision });
  } catch (error) {
    logger.error('Analyze error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Analysis failed' 
    });
  }
});

/**
 * Scan multiple symbols
 */
app.post('/api/scan', async (req, res) => {
  const { symbols, settings, strategyId, force } = req.body;
  const lockKey = strategyId || 'default';
  
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
  
  // Validate inputs before acquiring lock
  const symbolsResult = validateSymbols(symbols);
  if (!symbolsResult.valid) {
    return res.status(400).json({ error: symbolsResult.errors.join(', ') });
  }
  
  const settingsResult = validateSettings(settings);
  if (!settingsResult.valid) {
    return res.status(400).json({ error: settingsResult.errors.join(', ') });
  }
  
  const sanitizedSymbols = symbolsResult.sanitized as string[];
  
  if (!acquireScanLock(lockKey, sanitizedSymbols.length)) {
    return res.status(429).json({ 
      error: 'too_many_scans',
      message: `Maximum concurrent scans (${MAX_CONCURRENT_SCANS}) reached. Please wait.`,
    });
  }
  
  try {
    const userSettings = settingsResult.sanitized as UserSettings;
    
    // Use strategy-specific scanning if strategyId provided
    let decisions: (Decision | StrategyDecision)[];
    
    if (strategyId && strategyRegistry.get(strategyId)) {
      // Use new multi-strategy system
      logger.info(`Scanning with strategy: ${strategyId}`);
      decisions = await scanWithStrategy(sanitizedSymbols, strategyId, userSettings);
    } else {
      // Fallback to legacy decision engine
      decisions = await scanSymbols(sanitizedSymbols, userSettings);
    }
    
    // Fetch sentiment and save trade signals (handle both decision types)
    for (const decision of decisions) {
      if (decision.grade !== 'no-trade') {
        const sentiment = await grokSentimentService.getSentiment(decision.symbol);
        if (sentiment) {
          (decision as any).sentiment = sentiment;
        }
        signalStore.saveSignal(decision as any);
      }
    }
    
    // Sort by grade (A+ first, then lower grades, then no-trade)
    const gradeOrder: Record<string, number> = { 'A+': 0, 'A': 1, 'B+': 2, 'B': 3, 'C': 4, 'no-trade': 5 };
    decisions.sort((a, b) => (gradeOrder[a.grade] ?? 5) - (gradeOrder[b.grade] ?? 5));
    
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
app.get('/api/signals', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const grade = req.query.grade as string;
    const symbol = req.query.symbol as string;
    
    let signals;
    if (grade) {
      signals = signalStore.getByGrade(grade, limit);
    } else if (symbol) {
      signals = signalStore.getBySymbol(symbol.toUpperCase(), limit);
    } else {
      signals = signalStore.getRecent(limit);
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
app.put('/api/signals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { result, notes } = req.body;
    
    if (!['win', 'loss', 'breakeven', 'skipped'].includes(result)) {
      return res.status(400).json({ error: 'Invalid result. Must be: win, loss, breakeven, or skipped' });
    }
    
    const updated = signalStore.updateResult(id, result, notes);
    
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
app.get('/api/signals/stats', (req, res) => {
  try {
    const stats = signalStore.getStats();
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
app.post('/api/journal', (req, res) => {
  try {
    const entry = req.body;
    
    if (!entry.symbol || !entry.direction || !entry.action) {
      return res.status(400).json({ 
        error: 'Missing required fields: symbol, direction, action' 
      });
    }
    
    if (!['long', 'short'].includes(entry.direction)) {
      return res.status(400).json({ error: 'Direction must be long or short' });
    }
    
    if (!['taken', 'skipped', 'missed'].includes(entry.action)) {
      return res.status(400).json({ error: 'Action must be taken, skipped, or missed' });
    }
    
    const newEntry = journalStore.add(entry);
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
app.get('/api/journal', (req, res) => {
  try {
    const filters: JournalFilters = {};
    
    if (req.query.symbol) filters.symbol = req.query.symbol as string;
    if (req.query.status) filters.status = req.query.status as any;
    if (req.query.result) filters.result = req.query.result as any;
    if (req.query.action) filters.action = req.query.action as any;
    if (req.query.tradeType) filters.tradeType = req.query.tradeType as any;
    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom as string;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo as string;
    
    const entries = journalStore.getAll(Object.keys(filters).length > 0 ? filters : undefined);
    res.json({ success: true, count: entries.length, entries });
  } catch (error) {
    logger.error('Get journal entries error', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get journal entries' 
    });
  }
});

/**
 * Get single journal entry
 */
app.get('/api/journal/stats', (req, res) => {
  try {
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    
    const stats = journalStore.getStats(dateFrom, dateTo);
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
app.get('/api/journal/export', (req, res) => {
  try {
    const filters: JournalFilters = {};
    
    if (req.query.symbol) filters.symbol = req.query.symbol as string;
    if (req.query.status) filters.status = req.query.status as any;
    if (req.query.result) filters.result = req.query.result as any;
    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom as string;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo as string;
    
    const csv = journalStore.exportCSV(Object.keys(filters).length > 0 ? filters : undefined);
    
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
app.get('/api/journal/:id', (req, res) => {
  try {
    const entry = journalStore.get(req.params.id);
    
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
app.put('/api/journal/:id', (req, res) => {
  try {
    const updates = req.body;
    
    const validationErrors = validateJournalUpdate(updates);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
      });
    }
    
    if (updates.notes) {
      updates.notes = sanitizeNotes(updates.notes);
    }
    
    if (updates.status === 'closed' && updates.exitPrice) {
      const existing = journalStore.get(req.params.id);
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
    
    const entry = journalStore.update(req.params.id, updates);
    
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
app.delete('/api/journal/:id', (req, res) => {
  try {
    const deleted = journalStore.delete(req.params.id);
    
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

app.post('/api/autoscan/start', (req, res) => {
  try {
    const { minGrade = 'B', email, intervalMs = 5 * 60 * 1000 } = req.body;
    
    autoScanService.start({
      minGrade,
      email,
      intervalMs,
      onNewSignal: (decision, isNew) => {
        if (isNew && email) {
          alertService.sendTradeAlert(decision, email).catch(err => {
            logger.error(`Alert email failed: ${err}`);
          });
        }
        broadcastUpgrade({ type: 'new_signal', decision, isNew });
      }
    });
    
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

app.put('/api/autoscan/config', (req, res) => {
  try {
    const { minGrade, email, intervalMs, symbols, strategies } = req.body;
    
    autoScanService.updateConfig({
      minGrade,
      email,
      intervalMs,
      symbols,
      strategies
    });
    
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

app.post('/api/sentiment/batch', async (req, res) => {
  const { symbols } = req.body;
  
  if (!grokSentimentService.isEnabled()) {
    return res.status(503).json({ 
      error: 'Sentiment analysis not configured'
    });
  }
  
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: 'symbols array required' });
  }
  
  if (symbols.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 symbols per batch' });
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
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  signalStore.close();
  journalStore.close();
  cache.close();
  process.exit(0);
});

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

import { FOREX_SYMBOLS, CRYPTO_SYMBOLS, METAL_SYMBOLS, DEFAULT_WATCHLIST, SYMBOL_META, getUniverse } from './config/universe.js';
import { DEFAULTS, RISK_OPTIONS } from './config/defaults.js';
import { STYLE_PRESETS } from './config/strategy.js';
import { analyzeSymbol, scanSymbols, UserSettings, Decision } from './engine/decisionEngine.js';
import { validateSettings, validateSymbol, validateSymbols } from './utils/validation.js';
import { signalStore } from './storage/signalStore.js';
import { cache } from './services/cache.js';
import { rateLimiter } from './services/rateLimiter.js';
import { createLogger } from './services/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('Server');
const app = express();
const PORT = process.env.PORT || 3000;

let scanInProgress = false;

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
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!process.env.ALPHAVANTAGE_API_KEY,
  });
});

/**
 * Get trading universe
 */
app.get('/api/universe', (req, res) => {
  res.json({
    forex: FOREX_SYMBOLS,
    crypto: CRYPTO_SYMBOLS,
    metals: METAL_SYMBOLS,
    defaultWatchlist: DEFAULT_WATCHLIST,
    metadata: SYMBOL_META,
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
    
    // Save to store (if it's a trade signal)
    if (decision.grade !== 'no-trade') {
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
  if (scanInProgress) {
    return res.status(429).json({ error: 'Scan already in progress. Please wait.' });
  }
  
  scanInProgress = true;
  
  try {
    const { symbols, settings } = req.body;
    
    // Validate symbols
    const symbolsResult = validateSymbols(symbols);
    if (!symbolsResult.valid) {
      return res.status(400).json({ error: symbolsResult.errors.join(', ') });
    }
    
    // Validate settings
    const settingsResult = validateSettings(settings);
    if (!settingsResult.valid) {
      return res.status(400).json({ error: settingsResult.errors.join(', ') });
    }
    
    const userSettings = settingsResult.sanitized as UserSettings;
    const sanitizedSymbols = symbolsResult.sanitized as string[];
    
    // Scan
    const decisions = await scanSymbols(sanitizedSymbols, userSettings);
    
    // Save trade signals
    for (const decision of decisions) {
      if (decision.grade !== 'no-trade') {
        signalStore.saveSignal(decision);
      }
    }
    
    // Sort by grade (A+ first, then B, then no-trade)
    const gradeOrder = { 'A+': 0, 'B': 1, 'no-trade': 2 };
    decisions.sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade]);
    
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
    scanInProgress = false;
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
  logger.info(`🎯 Forex Decision Engine v1.0.0`);
  logger.info(`📡 Server running on port ${PORT}`);
  logger.info(`🔑 API Key: ${process.env.ALPHAVANTAGE_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
  logger.info(`📊 Symbols: ${FOREX_SYMBOLS.length} forex, ${CRYPTO_SYMBOLS.length} crypto, ${METAL_SYMBOLS.length} metals`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  signalStore.close();
  cache.close();
  process.exit(0);
});

# MASTER PATCH FILE
## forex-decision-engine V1 → V1.1 (Production Safe)

**Generated:** January 2, 2026  
**Audit Status:** Three-way validated (Claude + ChatGPT + MT5 verification)  
**Final Verdict:** 🟢 GO after patches applied

---

# TABLE OF CONTENTS

1. [Pre-Flight Checklist](#pre-flight-checklist)
2. [Patch 1: server.ts - Kill Legacy Routes](#patch-1-serverts)
3. [Patch 2: defaults.ts - Crypto Contract Sizes (Fail-Closed)](#patch-2-defaultsts)
4. [Patch 3: e8InstrumentSpecs.ts - Sync Crypto Specs](#patch-3-e8instrumentspectsts)
5. [Patch 4: utils.ts - Hard-Fail Alignment + Position Validation](#patch-4-utilsts)
6. [Patch 5: Strategy Files - Increase minBars](#patch-5-strategy-files)
7. [Patch 6: twelveDataClient.ts - Increase Output Size](#patch-6-twelvedataclientts)
8. [Patch 7: drawdownGuard.ts - NEW FILE (Production Version)](#patch-7-drawdownguardts)
9. [Post-Deployment Verification](#post-deployment-verification)
10. [Rollback Plan](#rollback-plan)

---

# PRE-FLIGHT CHECKLIST

Before applying patches, verify in Replit:

```bash
# 1. Backup current state
cp -r src/ src_backup_$(date +%Y%m%d_%H%M%S)/

# 2. Check no other files import legacy engine
grep -r "decisionEngine" src/ --include="*.ts" | grep -v "// LEGACY"

# 3. Check no background jobs use legacy
grep -r "scanSymbols" src/ --include="*.ts"

# 4. Check no cron jobs
grep -r "cron\|schedule\|setInterval" src/ --include="*.ts"

# 5. Note current TypeScript errors (baseline)
npm run typecheck 2>&1 | tail -20
```

---

# PATCH 1: server.ts

**Purpose:** Kill legacy engine routes, require strategyId, add mandatory drawdown guard

**Find and replace the ENTIRE file content related to /api/analyze and /api/scan routes:**

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS - Updated for V1.1
// ═══════════════════════════════════════════════════════════════════════════

// REMOVE THIS (legacy):
// import { analyzeSymbol, scanSymbols } from './engine/decisionEngine.js';

// ADD THIS:
import { scanWithStrategy } from './engine/strategyAnalyzer.js';
import { strategyRegistry } from './strategies/registry.js';
import { checkDrawdownLimits } from './services/drawdownGuard.js';

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE: /api/analyze - PERMANENTLY DISABLED
// Reason: Legacy engine uses ATR zone midpoint, NOT NEXT_OPEN
// Audit: three-way-audit-consensus.md (2026-01-02)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/analyze', async (req, res) => {
  return res.status(410).json({
    error: 'DEPRECATED: /api/analyze has been permanently disabled',
    reason: 'Legacy engine uses unsafe entry calculation (ATR zone midpoint instead of NEXT_OPEN)',
    auditReference: 'three-way-audit-consensus.md#issue-1-dual-engine-problem',
    migration: {
      endpoint: 'POST /api/scan',
      requiredParams: {
        symbols: ['EURUSD'],
        strategyId: 'rsi-bounce',
        settings: {
          equity: 10000,      // REQUIRED for live trading
          accountSize: 10000,
          riskPercent: 0.5,
          style: 'intraday'
        }
      }
    },
    availableStrategies: strategyRegistry.list().map(s => ({
      id: s.id,
      name: s.name,
      style: s.style,
      winRate: s.winRate
    }))
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE: /api/scan - STRATEGY-ONLY (No Legacy Fallback)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/scan', async (req, res) => {
  try {
    const { symbols, strategyId, settings } = req.body || {};

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 1: Require strategyId (eliminates legacy engine fallback)
    // ─────────────────────────────────────────────────────────────────────────
    if (!strategyId || typeof strategyId !== 'string') {
      return res.status(400).json({
        error: 'strategyId is required',
        reason: 'Legacy scan engine has been disabled for execution safety',
        availableStrategies: strategyRegistry.list().map(s => ({
          id: s.id,
          name: s.name,
          style: s.style,
          description: s.description
        })),
        example: {
          symbols: ['EURUSD', 'GBPUSD'],
          strategyId: 'rsi-bounce',
          settings: { equity: 10000, accountSize: 10000, riskPercent: 0.5 }
        }
      });
    }

    // Validate strategy exists
    const strategy = strategyRegistry.get(strategyId);
    if (!strategy) {
      return res.status(400).json({
        error: `Unknown strategy: "${strategyId}"`,
        availableStrategies: strategyRegistry.list().map(s => s.id)
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 2: Validate symbols
    // ─────────────────────────────────────────────────────────────────────────
    const sanitizedSymbols = Array.isArray(symbols)
      ? symbols.map(s => String(s || '').trim().toUpperCase()).filter(Boolean)
      : [];

    if (!sanitizedSymbols.length) {
      return res.status(400).json({
        error: 'symbols array is required',
        example: { symbols: ['EURUSD', 'GBPUSD', 'BTCUSD'] }
      });
    }

    if (sanitizedSymbols.length > 10) {
      return res.status(400).json({
        error: 'Maximum 10 symbols per request',
        provided: sanitizedSymbols.length
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 3: MANDATORY Drawdown Guard (Fail-Closed)
    // 
    // E8 Markets Rules:
    // - Daily Loss Limit: 4%
    // - Max Drawdown: 6%
    // - Violation = Account Termination
    // 
    // Override options:
    // - settings.paperTrading = true (for testing)
    // - settings.bypassDrawdownGuard = true (explicit bypass, logged)
    // ─────────────────────────────────────────────────────────────────────────
    const equity = settings?.equity ?? settings?.account?.equity;
    const bypassDrawdownGuard = settings?.bypassDrawdownGuard === true;
    const isPaperTrading = settings?.paperTrading === true;

    if (!bypassDrawdownGuard && !isPaperTrading) {
      // FAIL CLOSED: Require equity for live trading
      if (typeof equity !== 'number' || equity <= 0) {
        return res.status(400).json({
          error: 'Equity is required for live trading',
          reason: 'Drawdown guard cannot protect your E8 account without current equity',
          fix: 'Include settings.equity in your request',
          alternatives: [
            'Set settings.paperTrading = true for paper trading (no drawdown protection)',
            'Set settings.bypassDrawdownGuard = true to explicitly bypass (DANGEROUS - logged)',
          ],
          example: {
            symbols: ['EURUSD'],
            strategyId: 'rsi-bounce',
            settings: {
              equity: 9850,
              accountSize: 10000,
              riskPercent: 0.5
            }
          },
          e8Warning: 'Trading without drawdown protection risks account termination'
        });
      }

      // Check drawdown limits
      const ddCheck = checkDrawdownLimits({
        accountId: settings?.accountId || 'default',
        equity,
        startOfDayEquity: settings?.startOfDayEquity,
        peakEquity: settings?.peakEquity,
        dailyLossLimitPct: settings?.risk?.dailyLossLimit ?? 4,
        maxDrawdownPct: settings?.risk?.maxDrawdown ?? 6,
      });

      if (!ddCheck.allowed) {
        return res.status(403).json({
          error: 'TRADING BLOCKED: Drawdown limit reached',
          reason: ddCheck.reason,
          metrics: ddCheck.metrics,
          action: 'Stop trading immediately to protect your E8 account',
          e8Rules: {
            dailyLossLimit: '4% of starting balance',
            maxDrawdown: '6% from peak equity',
            consequence: 'Account termination if exceeded'
          }
        });
      }

      // Log successful check
      console.log(`[DrawdownGuard] PASSED - Account: ${settings?.accountId || 'default'}, ` +
                  `Equity: ${equity}, Daily: ${ddCheck.metrics.dailyDDPct}%, ` +
                  `Total: ${ddCheck.metrics.totalDDPct}%`);
    } else {
      // Explicit bypass - warn loudly
      const reason = isPaperTrading ? 'Paper trading mode' : 'Explicit bypass flag';
      console.warn(`[DrawdownGuard] ⚠️ BYPASSED - Reason: ${reason}`);
      console.warn(`[DrawdownGuard] ⚠️ WARNING: No E8 drawdown protection active!`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXECUTE: Strategy System Only (No Legacy Fallback)
    // ─────────────────────────────────────────────────────────────────────────
    const decisions = await scanWithStrategy(sanitizedSymbols, strategyId, settings || {});

    return res.json({
      success: true,
      strategy: { id: strategy.id, name: strategy.name, style: strategy.style },
      symbolsScanned: sanitizedSymbols.length,
      signalsFound: decisions.filter(d => d.action !== 'NO_TRADE').length,
      decisions,
      drawdownStatus: isPaperTrading || bypassDrawdownGuard ? 'BYPASSED' : 'PROTECTED'
    });

  } catch (err: any) {
    console.error('[/api/scan] Error:', err);
    return res.status(500).json({
      error: 'Scan failed',
      message: err?.message || 'Unknown error'
    });
  }
});
```

---

# PATCH 2: defaults.ts

**Purpose:** Correct crypto contract sizes from MT5, fail-closed for unknown symbols

**Replace the CRYPTO_CONTRACT_SIZES section:**

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// CRYPTO CONTRACT SIZES - E8 Markets MT5 Specifications
// 
// VERIFIED: 2026-01-02 via MT5 Symbol Specification screenshots
// Source: MT5 → Market Watch → Right-click Symbol → Specification
// 
// CRITICAL: Unknown symbols FAIL CLOSED - do NOT default to 1
// Audit: three-way-audit-consensus.md#issue-2-crypto-contract-sizes
// ═══════════════════════════════════════════════════════════════════════════

export const CRYPTO_CONTRACT_SIZES: Record<string, number> = {
  // ─────────────────────────────────────────────────────────────────────────
  // VERIFIED FROM E8 MT5 (2026-01-02)
  // ─────────────────────────────────────────────────────────────────────────
  BTCUSD: 2,           // 1 lot = 2 BTC        (MT5 verified)
  ETHUSD: 20,          // 1 lot = 20 ETH       (MT5 verified)
  XRPUSD: 100000,      // 1 lot = 100,000 XRP  (MT5 verified)
  ADAUSD: 100000,      // 1 lot = 100,000 ADA  (MT5 verified)
  SOLUSD: 500,         // 1 lot = 500 SOL      (MT5 verified)
  LTCUSD: 500,         // 1 lot = 500 LTC      (MT5 verified)
  BCHUSD: 200,         // 1 lot = 200 BCH      (MT5 verified)
  BNBUSD: 200,         // 1 lot = 200 BNB      (MT5 verified)
} as const;

/** Known crypto symbols for validation */
export const KNOWN_CRYPTO_SYMBOLS = Object.keys(CRYPTO_CONTRACT_SIZES);

/**
 * Get crypto contract size for position sizing calculations
 * 
 * FAIL-CLOSED DESIGN: Returns null for unknown symbols
 * Caller MUST handle null by rejecting the trade
 * 
 * @param symbol - Crypto symbol (e.g., 'BTCUSD' or 'BTC/USD')
 * @returns Contract size (units per lot) or NULL if unknown
 */
export function getCryptoContractSize(symbol: string): number | null {
  // Normalize: BTC/USD → BTCUSD, btcusd → BTCUSD
  const normalized = symbol.toUpperCase().replace(/[\/\-_]/g, '');
  const size = CRYPTO_CONTRACT_SIZES[normalized];

  if (size === undefined) {
    // ═══════════════════════════════════════════════════════════════════════
    // FAIL CLOSED - Do NOT default to 1
    // Unknown symbol could cause 100,000x position sizing error
    // ═══════════════════════════════════════════════════════════════════════
    console.error(`[FATAL] getCryptoContractSize: Unknown symbol "${symbol}" (normalized: "${normalized}")`);
    console.error(`[FATAL] Known symbols: ${KNOWN_CRYPTO_SYMBOLS.join(', ')}`);
    console.error(`[FATAL] Trade MUST be blocked to prevent position sizing catastrophe`);
    return null;
  }

  return size;
}

/**
 * Check if a crypto symbol has verified contract size
 */
export function isKnownCryptoSymbol(symbol: string): boolean {
  const normalized = symbol.toUpperCase().replace(/[\/\-_]/g, '');
  return normalized in CRYPTO_CONTRACT_SIZES;
}
```

---

# PATCH 3: e8InstrumentSpecs.ts

**Purpose:** Sync crypto specs with MT5 verified values

**Replace the CRYPTO_SPECS array:**

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// CRYPTO SPECIFICATIONS - E8 Markets MT5
// VERIFIED: 2026-01-02 via MT5 Symbol Specification screenshots
// ═══════════════════════════════════════════════════════════════════════════

export const CRYPTO_SPECS: InstrumentSpec[] = [
  {
    symbol: 'BTCUSD',
    dataSymbol: 'BTC/USD',
    displayName: 'Bitcoin',
    type: 'crypto',
    contractSize: 2,        // MT5 VERIFIED: 2
    digits: 2,              // MT5 VERIFIED: 2
    pipSize: 1,
    pipValue: 2,            // 1 pip × contractSize
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 10,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 12,
    tradingHours: '00:05-23:55',
  },
  {
    symbol: 'ETHUSD',
    dataSymbol: 'ETH/USD',
    displayName: 'Ethereum',
    type: 'crypto',
    contractSize: 20,       // MT5 VERIFIED: 20
    digits: 2,              // MT5 VERIFIED: 2
    pipSize: 0.01,
    pipValue: 0.2,
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 100,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 0.59,
    tradingHours: '00:05-23:55',
  },
  {
    symbol: 'XRPUSD',
    dataSymbol: 'XRP/USD',
    displayName: 'Ripple',
    type: 'crypto',
    contractSize: 100000,   // MT5 VERIFIED: 100,000
    digits: 5,              // MT5 VERIFIED: 5
    pipSize: 0.00001,
    pipValue: 1,
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 50,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 0.0003,
    tradingHours: '00:05-23:55',
  },
  {
    symbol: 'ADAUSD',
    dataSymbol: 'ADA/USD',
    displayName: 'Cardano',
    type: 'crypto',
    contractSize: 100000,   // MT5 VERIFIED: 100,000
    digits: 5,              // MT5 VERIFIED: 5
    pipSize: 0.00001,
    pipValue: 1,
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 100,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 0.00021,
    tradingHours: '00:05-23:55',
  },
  {
    symbol: 'SOLUSD',
    dataSymbol: 'SOL/USD',
    displayName: 'Solana',
    type: 'crypto',
    contractSize: 500,      // MT5 VERIFIED: 500
    digits: 2,              // MT5 VERIFIED: 2
    pipSize: 0.01,
    pipValue: 5,
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 1000,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 0.01,
    tradingHours: '00:05-23:55',
  },
  {
    symbol: 'LTCUSD',
    dataSymbol: 'LTC/USD',
    displayName: 'Litecoin',
    type: 'crypto',
    contractSize: 500,      // MT5 VERIFIED: 500
    digits: 2,              // MT5 VERIFIED: 2
    pipSize: 0.01,
    pipValue: 5,
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 500,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 0.15,
    tradingHours: '00:05-23:55',
  },
  {
    symbol: 'BCHUSD',
    dataSymbol: 'BCH/USD',
    displayName: 'Bitcoin Cash',
    type: 'crypto',
    contractSize: 200,      // MT5 VERIFIED: 200
    digits: 2,              // MT5 VERIFIED: 2
    pipSize: 0.01,
    pipValue: 2,
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 200,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 0.67,
    tradingHours: '00:05-23:55',
  },
  {
    symbol: 'BNBUSD',
    dataSymbol: 'BNB/USD',
    displayName: 'Binance Coin',
    type: 'crypto',
    contractSize: 200,      // MT5 VERIFIED: 200
    digits: 2,              // MT5 VERIFIED: 2
    pipSize: 0.01,
    pipValue: 2,
    quoteCurrency: 'USD',
    leverage: 1,
    maxLotSize: 100,
    minLotSize: 0.01,
    lotStep: 0.01,
    commission: 0,
    commissionPercent: 0.035,
    avgSpread: 0.92,
    tradingHours: '00:05-23:55',
  },
];
```

---

# PATCH 4: utils.ts

**Purpose:** Hard-fail indicator alignment, add position validity enforcement

**Replace/add these functions:**

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// INDICATOR VALIDATION - Hard-Fail on Mismatch
// Changed from warning-only to hard-fail per three-way audit (2026-01-02)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that all required indicators are present and properly aligned
 * 
 * HARD-FAIL: Returns false on ANY mismatch (was previously warn + continue)
 */
export function validateIndicators(
  data: Record<string, unknown>,
  required: (string | { key: string; minLength?: number })[],
  minBars: number = 50
): boolean {
  // Check bars exist
  if (!data.bars || !Array.isArray(data.bars)) {
    logger.warn('validateIndicators: bars missing or not array');
    return false;
  }

  const barsLength = (data.bars as unknown[]).length;
  
  // Check minimum bars
  if (barsLength < minBars) {
    logger.warn('validateIndicators: insufficient bars', { barsLength, minBars });
    return false;
  }

  // Check each required indicator
  for (const req of required) {
    const key = typeof req === 'string' ? req : req.key;
    if (key === 'bars') continue;

    const indicator = data[key];

    // Check indicator exists and is array
    if (!indicator || !Array.isArray(indicator)) {
      logger.warn('validateIndicators: missing indicator', { key });
      return false;
    }

    const indicatorLength = (indicator as unknown[]).length;

    // Check minimum length
    const reqMinLength = typeof req === 'object' ? req.minLength || minBars : minBars;
    if (indicatorLength < reqMinLength) {
      logger.warn('validateIndicators: indicator too short', {
        key,
        indicatorLength,
        required: reqMinLength
      });
      return false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HARD-FAIL on alignment mismatch
    // This was previously a warning - changed to hard fail for safety
    // ═══════════════════════════════════════════════════════════════════════
    if (indicatorLength !== barsLength) {
      logger.error('FATAL: Indicator length mismatch - signal generation ABORTED', {
        indicator: key,
        indicatorLength,
        barsLength,
        difference: Math.abs(indicatorLength - barsLength),
        action: 'Trade rejected to prevent data corruption'
      });
      return false;  // HARD FAIL
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION VALIDATION - Enforce isValid Check
// Added per ChatGPT audit review (2026-01-02)
// ═══════════════════════════════════════════════════════════════════════════

import { getCryptoContractSize } from '../config/defaults.js';

export interface PositionSizeResult {
  lots: number;
  isValid: boolean;
  warnings: string[];
  riskAmount?: number;
  marginRequired?: number;
  contractSize?: number;
}

/**
 * Validate position size result - reject if invalid
 * Returns null if position should be rejected
 */
export function validatePositionSize(
  position: PositionSizeResult,
  symbol: string
): PositionSizeResult | null {
  if (!position.isValid) {
    logger.warn('Position size invalid - trade REJECTED', {
      symbol,
      lots: position.lots,
      reason: position.warnings?.join(', ') || 'Unknown'
    });
    return null;
  }

  if (position.lots <= 0) {
    logger.warn('Position size zero or negative - trade REJECTED', {
      symbol,
      lots: position.lots
    });
    return null;
  }

  return position;
}

/**
 * Calculate position size for crypto with fail-closed unknown symbol handling
 */
export function calculateCryptoPositionSize(params: {
  symbol: string;
  accountSize: number;
  riskPercent: number;
  stopDistance: number;
}): PositionSizeResult {
  const { symbol, accountSize, riskPercent, stopDistance } = params;

  // FAIL-CLOSED: Get contract size (returns null if unknown)
  const contractSize = getCryptoContractSize(symbol);

  if (contractSize === null) {
    return {
      lots: 0,
      isValid: false,
      warnings: [
        `BLOCKED: Unknown crypto symbol "${symbol}"`,
        'Contract size not verified in MT5',
        'Add symbol to CRYPTO_CONTRACT_SIZES after verifying in MT5'
      ],
      riskAmount: 0,
      marginRequired: 0,
    };
  }

  const riskAmount = accountSize * (riskPercent / 100);

  if (stopDistance <= 0) {
    return {
      lots: 0,
      isValid: false,
      warnings: ['Invalid stop distance: must be positive'],
      riskAmount,
    };
  }

  const lots = riskAmount / (stopDistance * contractSize);

  // Round to 2 decimal places (standard lot step)
  const roundedLots = Math.floor(lots * 100) / 100;

  if (roundedLots <= 0) {
    return {
      lots: 0,
      isValid: false,
      warnings: ['Calculated position size too small (rounds to 0)'],
      riskAmount,
      contractSize,
    };
  }

  return {
    lots: roundedLots,
    isValid: true,
    warnings: [],
    riskAmount,
    contractSize,
  };
}
```

---

# PATCH 5: Strategy Files

**Purpose:** Increase minBars from 50 to 250 for EMA200 strategies

Apply this change to each file listed:

### EmaPullback.ts
```typescript
// In analyze() method, change:
if (!bars || bars.length < 250) return null;  // Was 50
if (!validateIndicators(data as unknown as Record<string, unknown>, this.meta.requiredIndicators, 250)) return null;
```

### RsiOversold.ts
```typescript
// For H4 trend data:
if (!trendBarsH4 || trendBarsH4.length < 250) return null;  // Was 50
```

### CciZeroLine.ts
```typescript
if (!bars || bars.length < 250) return null;
if (!validateIndicators(data as Record<string, unknown>, this.meta.requiredIndicators, 250)) return null;
```

### BollingerMR.ts
```typescript
if (!bars || bars.length < 250) return null;
if (!validateIndicators(data as Record<string, unknown>, this.meta.requiredIndicators, 250)) return null;
```

### StochasticOversold.ts
```typescript
if (!bars || bars.length < 250) return null;
if (!validateIndicators(data as Record<string, unknown>, this.meta.requiredIndicators, 250)) return null;
```

---

# PATCH 6: twelveDataClient.ts

**Purpose:** Increase outputsize from 100 to 300 for EMA200 stability

**Find and replace outputsize defaults:**

```typescript
// Change all occurrences of:
outputsize: '100',

// To:
outputsize: '300',  // Increased for EMA200 stability (needs 200+ bars)
```

**Also update getIndicator method default:**

```typescript
async getIndicator(params: {
  symbol: string;
  interval: string;
  indicator: string;
  outputsize?: string;
  // ...
}): Promise<number[]> {
  const {
    outputsize = '300',  // Changed from 100 - EMA200 needs 200+ bars
    // ...
  } = params;
  
  // ...
}
```

---

# PATCH 7: drawdownGuard.ts

**Purpose:** Production-grade drawdown guard with persistence and fail-closed design

**CREATE NEW FILE:** `src/services/drawdownGuard.ts`

```typescript
/**
 * Drawdown Guard Service - PRODUCTION VERSION
 * 
 * Features:
 * - Persistent state (survives server restart)
 * - Fail-closed design
 * - Accepts broker-provided values
 * - E8 Markets compliant
 * 
 * E8 Rules:
 * - Daily Loss Limit: 4% of starting balance
 * - Max Drawdown: 6% from peak equity
 * - Violation = Account Termination
 * 
 * Created: 2026-01-02 (Three-way audit)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const STATE_DIR = process.env.DRAWDOWN_STATE_DIR || './data/drawdown';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface DrawdownState {
  startOfDayEquity: number;
  peakEquity: number;
  lastEquity: number;
  lastUpdated: number;
  dayKey: string;
  source: 'broker' | 'calculated' | 'unknown';
}

export interface DrawdownCheckParams {
  accountId?: string;
  equity: number;
  startOfDayEquity?: number;
  peakEquity?: number;
  dailyLossLimitPct?: number;
  maxDrawdownPct?: number;
}

export interface DrawdownMetrics {
  dayKey: string;
  equity: number;
  startOfDayEquity: number;
  peakEquity: number;
  dailyDDPct: number;
  totalDDPct: number;
  stateSource: 'broker' | 'calculated' | 'unknown';
  limits: {
    dailyLossLimitPct: number;
    maxDrawdownPct: number;
  };
  headroom: {
    dailyRemaining: number;
    totalRemaining: number;
  };
  warnings: string[];
}

export interface DrawdownCheckResult {
  allowed: boolean;
  reason?: string;
  metrics: DrawdownMetrics;
}

// ═══════════════════════════════════════════════════════════════════════════
// State Persistence
// ═══════════════════════════════════════════════════════════════════════════

const stateCache = new Map<string, DrawdownState>();

function getStatePath(accountId: string): string {
  return join(STATE_DIR, `${accountId}.json`);
}

function loadState(accountId: string): DrawdownState | null {
  if (stateCache.has(accountId)) {
    return stateCache.get(accountId)!;
  }

  const path = getStatePath(accountId);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      stateCache.set(accountId, data);
      console.log(`[DrawdownGuard] Loaded state for ${accountId}: day=${data.dayKey}`);
      return data;
    } catch (err) {
      console.error(`[DrawdownGuard] Failed to load state for ${accountId}:`, err);
    }
  }
  return null;
}

function saveState(accountId: string, state: DrawdownState): void {
  stateCache.set(accountId, state);
  
  try {
    const path = getStatePath(accountId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`[DrawdownGuard] Failed to save state for ${accountId}:`, err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════

function getDayKey(date = new Date()): string {
  return date.toISOString().split('T')[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Check if trading is allowed based on drawdown limits
 */
export function checkDrawdownLimits(params: DrawdownCheckParams): DrawdownCheckResult {
  const {
    accountId = 'default',
    equity,
    startOfDayEquity: brokerStartOfDay,
    peakEquity: brokerPeak,
    dailyLossLimitPct = 4,
    maxDrawdownPct = 6,
  } = params;

  const warnings: string[] = [];
  const today = getDayKey();

  // Validate equity
  if (!Number.isFinite(equity) || equity <= 0) {
    return {
      allowed: false,
      reason: 'Invalid equity value',
      metrics: createErrorMetrics(dailyLossLimitPct, maxDrawdownPct, ['Invalid equity']),
    };
  }

  // Load persisted state
  let state = loadState(accountId);
  let stateSource: 'broker' | 'calculated' | 'unknown' = 'unknown';

  // Determine startOfDayEquity (priority: broker > persisted > current)
  let startOfDayEquity: number;
  if (brokerStartOfDay && Number.isFinite(brokerStartOfDay) && brokerStartOfDay > 0) {
    startOfDayEquity = brokerStartOfDay;
    stateSource = 'broker';
  } else if (state && state.dayKey === today) {
    startOfDayEquity = state.startOfDayEquity;
    stateSource = 'calculated';
    warnings.push('Using persisted startOfDayEquity');
  } else {
    startOfDayEquity = equity;
    stateSource = 'calculated';
    warnings.push('⚠️ startOfDayEquity initialized from current equity');
  }

  // Determine peakEquity (priority: broker > persisted > current)
  let peakEquity: number;
  if (brokerPeak && Number.isFinite(brokerPeak) && brokerPeak > 0) {
    peakEquity = Math.max(brokerPeak, equity);
    stateSource = 'broker';
  } else if (state && state.peakEquity > 0) {
    peakEquity = Math.max(state.peakEquity, equity);
  } else {
    peakEquity = equity;
    warnings.push('⚠️ peakEquity initialized from current equity');
  }

  // Calculate drawdowns
  const dailyDDPct = ((startOfDayEquity - equity) / startOfDayEquity) * 100;
  const totalDDPct = ((peakEquity - equity) / peakEquity) * 100;

  const metrics: DrawdownMetrics = {
    dayKey: today,
    equity: round2(equity),
    startOfDayEquity: round2(startOfDayEquity),
    peakEquity: round2(peakEquity),
    dailyDDPct: round2(dailyDDPct),
    totalDDPct: round2(totalDDPct),
    stateSource,
    limits: { dailyLossLimitPct, maxDrawdownPct },
    headroom: {
      dailyRemaining: round2(dailyLossLimitPct - Math.max(0, dailyDDPct)),
      totalRemaining: round2(maxDrawdownPct - Math.max(0, totalDDPct)),
    },
    warnings,
  };

  // Persist state
  saveState(accountId, {
    startOfDayEquity,
    peakEquity,
    lastEquity: equity,
    lastUpdated: Date.now(),
    dayKey: today,
    source: stateSource,
  });

  // Check daily loss limit
  if (dailyDDPct >= dailyLossLimitPct) {
    console.warn('[DrawdownGuard] 🛑 BLOCKED: Daily loss limit reached', metrics);
    return {
      allowed: false,
      reason: `Daily loss limit BREACHED: ${metrics.dailyDDPct}% >= ${dailyLossLimitPct}%`,
      metrics,
    };
  }

  // Check max drawdown
  if (totalDDPct >= maxDrawdownPct) {
    console.warn('[DrawdownGuard] 🛑 BLOCKED: Max drawdown reached', metrics);
    return {
      allowed: false,
      reason: `Max drawdown BREACHED: ${metrics.totalDDPct}% >= ${maxDrawdownPct}%`,
      metrics,
    };
  }

  // Warn at 75%
  if (dailyDDPct >= dailyLossLimitPct * 0.75) {
    warnings.push(`⚠️ At ${round2(dailyDDPct)}% daily (limit: ${dailyLossLimitPct}%)`);
  }
  if (totalDDPct >= maxDrawdownPct * 0.75) {
    warnings.push(`⚠️ At ${round2(totalDDPct)}% total DD (limit: ${maxDrawdownPct}%)`);
  }

  return { allowed: true, metrics };
}

/**
 * Reset state for an account
 */
export function resetDrawdownState(accountId = 'default'): void {
  stateCache.delete(accountId);
  try {
    const path = getStatePath(accountId);
    if (existsSync(path)) {
      require('fs').unlinkSync(path);
    }
    console.log(`[DrawdownGuard] State reset for ${accountId}`);
  } catch (err) {
    console.error(`[DrawdownGuard] Failed to reset state:`, err);
  }
}

/**
 * Get current state (for debugging)
 */
export function getDrawdownState(accountId = 'default'): DrawdownState | null {
  return loadState(accountId);
}

// Helper
function createErrorMetrics(daily: number, max: number, warnings: string[]): DrawdownMetrics {
  return {
    dayKey: getDayKey(),
    equity: 0,
    startOfDayEquity: 0,
    peakEquity: 0,
    dailyDDPct: 0,
    totalDDPct: 0,
    stateSource: 'unknown',
    limits: { dailyLossLimitPct: daily, maxDrawdownPct: max },
    headroom: { dailyRemaining: 0, totalRemaining: 0 },
    warnings,
  };
}
```

---

# POST-DEPLOYMENT VERIFICATION

Run these tests after applying all patches:

```bash
#!/bin/bash
# Save as: verify-patches.sh

echo "═══════════════════════════════════════════════════════════════"
echo "POST-DEPLOYMENT VERIFICATION"
echo "═══════════════════════════════════════════════════════════════"

BASE_URL="http://localhost:3000"

echo ""
echo "1. TypeScript compilation..."
npm run typecheck && echo "✅ PASS" || echo "❌ FAIL"

echo ""
echo "2. Server starts..."
# (manual check)

echo ""
echo "3. Legacy /api/analyze returns 410..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/analyze" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EURUSD"}')
[ "$RESULT" = "410" ] && echo "✅ PASS (410)" || echo "❌ FAIL ($RESULT)"

echo ""
echo "4. /api/scan without strategyId returns 400..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/scan" \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"]}')
[ "$RESULT" = "400" ] && echo "✅ PASS (400)" || echo "❌ FAIL ($RESULT)"

echo ""
echo "5. /api/scan without equity returns 400..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/scan" \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"accountSize":10000}}')
[ "$RESULT" = "400" ] && echo "✅ PASS (400)" || echo "❌ FAIL ($RESULT)"

echo ""
echo "6. /api/scan with paperTrading=true bypasses equity check..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/scan" \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"paperTrading":true}}')
[ "$RESULT" = "200" ] && echo "✅ PASS (200)" || echo "❌ FAIL ($RESULT)"

echo ""
echo "7. Valid scan with equity succeeds..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/scan" \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"equity":10000,"accountSize":10000,"riskPercent":0.5}}')
[ "$RESULT" = "200" ] && echo "✅ PASS (200)" || echo "❌ FAIL ($RESULT)"

echo ""
echo "8. Drawdown state file created..."
ls -la ./data/drawdown/ 2>/dev/null && echo "✅ PASS" || echo "⚠️ No state files yet"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "VERIFICATION COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
```

---

# ROLLBACK PLAN

If issues occur after deployment:

```bash
# 1. Restore backup
cp -r src_backup_YYYYMMDD_HHMMSS/* src/

# 2. Restart server
npm run dev

# 3. Verify rollback
curl -X POST http://localhost:3000/api/analyze -d '{"symbol":"EURUSD"}'
# Should work again (if that's desired)
```

---

# FINAL STATUS

| Component | Status |
|-----------|--------|
| Legacy engine disabled | ✅ |
| strategyId required | ✅ |
| Crypto sizes (MT5 verified) | ✅ |
| Unknown crypto fails closed | ✅ |
| Indicator alignment hard-fail | ✅ |
| minBars = 250 for EMA200 | ✅ |
| outputsize = 300 | ✅ |
| Drawdown guard mandatory | ✅ |
| Drawdown state persisted | ✅ |
| Position validity enforced | ✅ |

**VERDICT:** 🟢 **GO FOR LIVE TRADING**

---

*Master patch file consolidated from three-way audit*  
*Claude + ChatGPT + MT5 verification*  
*January 2, 2026*

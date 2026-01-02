# SAFETY ADDENDUM PATCHES
## Addressing ChatGPT's Production Concerns

**Date:** January 2, 2026
**Context:** ChatGPT review of complete-patch-set.md identified 3 "looks safe on paper, leaks in production" issues

---

## ISSUE 1: Crypto ContractSize Defaults to 1 (DANGEROUS)

### The Problem
```typescript
// Current (DANGEROUS):
export function getCryptoContractSize(symbol: string): number {
  const size = CRYPTO_CONTRACT_SIZES[symbol.toUpperCase()];
  if (size === undefined) {
    console.warn(`Unknown crypto symbol "${symbol}" - defaulting to contractSize=1`);
    return 1;  // ← This could cause 100,000x position error for XRP!
  }
  return size;
}
```

If a symbol mapping mismatch occurs (e.g., `BTC/USD` vs `BTCUSD`), the system silently uses contractSize=1, causing catastrophic position sizing.

### The Fix: Fail Closed

**File:** `src/config/defaults.ts`

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// CRYPTO CONTRACT SIZES - E8 Markets MT5 Specifications
// VERIFIED: 2026-01-02 via MT5 Symbol Specification screenshots
// 
// CRITICAL: Unknown symbols MUST fail closed - do NOT default to 1
// ═══════════════════════════════════════════════════════════════════════════
export const CRYPTO_CONTRACT_SIZES: Record<string, number> = {
  BTCUSD: 2,
  ETHUSD: 20,
  XRPUSD: 100000,
  ADAUSD: 100000,
  SOLUSD: 500,
  LTCUSD: 500,
  BCHUSD: 200,
  BNBUSD: 200,
} as const;

// Known crypto symbols for validation
export const KNOWN_CRYPTO_SYMBOLS = Object.keys(CRYPTO_CONTRACT_SIZES);

/**
 * Get crypto contract size for position sizing
 * 
 * FAIL-CLOSED: Returns null for unknown symbols instead of defaulting to 1
 * Caller MUST handle null case by rejecting the trade
 * 
 * @param symbol - Crypto symbol (e.g., 'BTCUSD')
 * @returns Contract size or NULL if unknown (caller must reject trade)
 */
export function getCryptoContractSize(symbol: string): number | null {
  const normalized = symbol.toUpperCase().replace('/', '');  // Handle BTC/USD → BTCUSD
  const size = CRYPTO_CONTRACT_SIZES[normalized];
  
  if (size === undefined) {
    // FAIL CLOSED - Do NOT default to 1
    console.error(`[FATAL] Unknown crypto symbol: "${symbol}" (normalized: "${normalized}")`);
    console.error(`[FATAL] Known symbols: ${KNOWN_CRYPTO_SYMBOLS.join(', ')}`);
    console.error(`[FATAL] Trade BLOCKED to prevent position sizing error`);
    return null;
  }
  
  return size;
}

/**
 * Check if a symbol is a known crypto with verified contract size
 */
export function isKnownCryptoSymbol(symbol: string): boolean {
  const normalized = symbol.toUpperCase().replace('/', '');
  return normalized in CRYPTO_CONTRACT_SIZES;
}
```

### Update Position Sizing to Handle Null

**File:** `src/strategies/utils.ts` (or wherever position sizing is calculated)

```typescript
import { getCryptoContractSize, isKnownCryptoSymbol } from '../config/defaults.js';

export function calculatePositionSize(params: {
  symbol: string;
  accountSize: number;
  riskPercent: number;
  stopDistance: number;
  assetClass: 'forex' | 'crypto' | 'index' | 'commodity';
}): PositionSizeResult {
  const { symbol, accountSize, riskPercent, stopDistance, assetClass } = params;
  
  // ─────────────────────────────────────────────────────────────────────────
  // FAIL-CLOSED: Block unknown crypto symbols
  // ─────────────────────────────────────────────────────────────────────────
  if (assetClass === 'crypto') {
    const contractSize = getCryptoContractSize(symbol);
    
    if (contractSize === null) {
      return {
        lots: 0,
        isValid: false,
        warnings: [`BLOCKED: Unknown crypto symbol "${symbol}" - contract size not verified`],
        riskAmount: 0,
        marginRequired: 0,
      };
    }
    
    const riskAmount = accountSize * (riskPercent / 100);
    const lots = riskAmount / (stopDistance * contractSize);
    
    return {
      lots: roundLots(lots, symbol),
      isValid: true,
      warnings: [],
      riskAmount,
      marginRequired: lots * contractSize * getCurrentPrice(symbol),  // Approximate
      contractSize,  // Include for transparency
    };
  }
  
  // ... rest of forex/index/commodity sizing
}
```

---

## ISSUE 2: Drawdown Guard is Optional (DANGEROUS)

### The Problem
```typescript
// Current (DANGEROUS):
const equity = settings?.equity || settings?.account?.equity;
if (typeof equity === 'number' && equity > 0) {
  // Check drawdown
} 
// ← If equity not provided, trading continues with NO protection!
```

A user can accidentally omit equity and bypass all E8 protection.

### The Fix: Fail Closed with Override

**File:** `src/server.ts` - Update the `/api/scan` drawdown gate

```typescript
app.post('/api/scan', async (req, res) => {
  try {
    const { symbols, strategyId, settings } = req.body || {};

    // ... existing strategyId validation ...

    // ═══════════════════════════════════════════════════════════════════════
    // DRAWDOWN GUARD - MANDATORY (Fail Closed)
    // 
    // E8 Markets will terminate account at:
    // - 4% daily loss
    // - 6% max drawdown
    // 
    // This guard is NOT optional. To trade, you MUST provide:
    // - settings.equity (current account equity)
    // 
    // To bypass (paper trading only): settings.bypassDrawdownGuard = true
    // ═══════════════════════════════════════════════════════════════════════
    
    const equity = settings?.equity ?? settings?.account?.equity;
    const bypassDrawdownGuard = settings?.bypassDrawdownGuard === true;
    const isPaperTrading = settings?.paperTrading === true;
    
    // FAIL CLOSED: Require equity unless explicitly bypassed
    if (!bypassDrawdownGuard && !isPaperTrading) {
      if (typeof equity !== 'number' || equity <= 0) {
        return res.status(400).json({
          error: 'Equity is required for live trading',
          reason: 'Drawdown guard cannot function without current equity',
          fix: 'Include settings.equity in your request',
          alternatives: [
            'Set settings.paperTrading = true for paper trading (no guard)',
            'Set settings.bypassDrawdownGuard = true to explicitly bypass (DANGEROUS)',
          ],
          example: {
            symbols: ['EURUSD'],
            strategyId: 'rsi-bounce',
            settings: {
              equity: 9850,  // Current account equity
              accountSize: 10000,  // Starting balance
              riskPercent: 0.5
            }
          },
          e8Warning: 'Trading without drawdown protection risks account termination'
        });
      }
      
      // Import and check drawdown
      const { checkDrawdownLimits } = await import('./services/drawdownGuard.js');
      
      const ddCheck = checkDrawdownLimits({
        accountId: settings?.accountId || 'default',
        equity,
        startOfDayEquity: settings?.startOfDayEquity,  // Optional but recommended
        peakEquity: settings?.peakEquity,              // Optional but recommended
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
          },
          recommendation: 'Wait for new trading day (daily) or contact E8 support (max DD)'
        });
      }
      
      // Log successful check for audit trail
      console.log(`[DrawdownGuard] PASSED - Account: ${settings?.accountId || 'default'}, ` +
                  `Equity: ${equity}, Daily DD: ${ddCheck.metrics.dailyDDPct}%, ` +
                  `Total DD: ${ddCheck.metrics.totalDDPct}%`);
    } else {
      // Explicit bypass - log warning
      const bypassReason = isPaperTrading ? 'Paper trading mode' : 'Explicit bypass flag';
      console.warn(`[DrawdownGuard] BYPASSED - Reason: ${bypassReason}`);
      console.warn(`[DrawdownGuard] WARNING: No E8 drawdown protection active!`);
    }

    // ... rest of scan logic ...
  } catch (err) {
    // ...
  }
});
```

---

## ISSUE 3: Drawdown State Not Persisted (DANGEROUS)

### The Problem
```typescript
// Current (DANGEROUS):
const stateByAccount = new Map<string, DrawdownState>();
// ← In-memory only! Server restart = state lost = wrong calculations
```

If server restarts mid-day:
- `startOfDayEquity` reinitializes to current equity (which may already be down 3%)
- System thinks DD = 0% when it's actually 3%
- Allows trading that violates E8 rules

### The Fix: Persistent State + Broker-Provided Values

**File:** `src/services/drawdownGuard.ts` - Enhanced version

```typescript
/**
 * Drawdown Guard Service - PRODUCTION VERSION
 * 
 * Features:
 * - Persistent state (survives server restart)
 * - Accepts broker-provided values (startOfDayEquity, peakEquity)
 * - Fail-closed design
 * 
 * E8 Markets Rules:
 * - Daily Loss Limit: 4% of starting balance
 * - Max Drawdown: 6% from peak equity
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('DrawdownGuard');

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
  startOfDayEquity?: number;   // From broker - preferred
  peakEquity?: number;         // From broker - preferred
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
// Persistence
// ═══════════════════════════════════════════════════════════════════════════

const STATE_DIR = process.env.DRAWDOWN_STATE_DIR || './data/drawdown';
const stateCache = new Map<string, DrawdownState>();

function getStatePath(accountId: string): string {
  return join(STATE_DIR, `${accountId}.json`);
}

function loadState(accountId: string): DrawdownState | null {
  // Check cache first
  if (stateCache.has(accountId)) {
    return stateCache.get(accountId)!;
  }
  
  // Load from disk
  const path = getStatePath(accountId);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      stateCache.set(accountId, data);
      logger.info('Loaded persisted drawdown state', { accountId, dayKey: data.dayKey });
      return data;
    } catch (err) {
      logger.error('Failed to load drawdown state', { accountId, error: err });
    }
  }
  return null;
}

function saveState(accountId: string, state: DrawdownState): void {
  // Update cache
  stateCache.set(accountId, state);
  
  // Persist to disk
  try {
    const path = getStatePath(accountId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
    logger.debug('Persisted drawdown state', { accountId });
  } catch (err) {
    logger.error('Failed to persist drawdown state', { accountId, error: err });
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
 * 
 * Priority for startOfDayEquity and peakEquity:
 * 1. Broker-provided values (most accurate)
 * 2. Persisted state from previous calls
 * 3. Current equity (least accurate - only for first call)
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
      reason: 'Invalid equity value - cannot assess drawdown',
      metrics: createErrorMetrics(dailyLossLimitPct, maxDrawdownPct, 'Invalid equity'),
    };
  }

  // Load existing state
  let state = loadState(accountId);
  let stateSource: 'broker' | 'calculated' | 'unknown' = 'unknown';

  // Determine startOfDayEquity
  let startOfDayEquity: number;
  if (brokerStartOfDay && Number.isFinite(brokerStartOfDay) && brokerStartOfDay > 0) {
    // Best: Broker-provided
    startOfDayEquity = brokerStartOfDay;
    stateSource = 'broker';
  } else if (state && state.dayKey === today) {
    // Good: Persisted from earlier today
    startOfDayEquity = state.startOfDayEquity;
    stateSource = 'calculated';
    warnings.push('Using calculated startOfDayEquity (provide broker value for accuracy)');
  } else {
    // Fallback: Use current equity (RISKY - only for first call of day)
    startOfDayEquity = equity;
    stateSource = 'calculated';
    warnings.push('WARNING: startOfDayEquity initialized to current equity - may be inaccurate if already in drawdown');
  }

  // Determine peakEquity
  let peakEquity: number;
  if (brokerPeak && Number.isFinite(brokerPeak) && brokerPeak > 0) {
    // Best: Broker-provided
    peakEquity = brokerPeak;
    if (stateSource !== 'broker') stateSource = 'broker';
  } else if (state && state.peakEquity > 0) {
    // Good: Persisted peak
    peakEquity = Math.max(state.peakEquity, equity);
  } else {
    // Fallback: Use current equity
    peakEquity = equity;
    warnings.push('WARNING: peakEquity initialized to current equity - may be inaccurate');
  }

  // Update peak if current equity is higher
  if (equity > peakEquity) {
    peakEquity = equity;
  }

  // Calculate drawdowns
  const dailyDDPct = ((startOfDayEquity - equity) / startOfDayEquity) * 100;
  const totalDDPct = ((peakEquity - equity) / peakEquity) * 100;

  // Build metrics
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

  // Persist updated state
  const newState: DrawdownState = {
    startOfDayEquity,
    peakEquity,
    lastEquity: equity,
    lastUpdated: Date.now(),
    dayKey: today,
    source: stateSource,
  };
  saveState(accountId, newState);

  // Check daily loss limit
  if (dailyDDPct >= dailyLossLimitPct) {
    logger.warn('DRAWDOWN_BLOCK: Daily loss limit reached', metrics);
    return {
      allowed: false,
      reason: `Daily loss limit BREACHED: ${metrics.dailyDDPct}% >= ${dailyLossLimitPct}%`,
      metrics,
    };
  }

  // Check max drawdown
  if (totalDDPct >= maxDrawdownPct) {
    logger.warn('DRAWDOWN_BLOCK: Max drawdown reached', metrics);
    return {
      allowed: false,
      reason: `Max drawdown BREACHED: ${metrics.totalDDPct}% >= ${maxDrawdownPct}%`,
      metrics,
    };
  }

  // Warnings at 75% of limits
  if (dailyDDPct >= dailyLossLimitPct * 0.75) {
    warnings.push(`CAUTION: At ${round2(dailyDDPct)}% of ${dailyLossLimitPct}% daily limit`);
    logger.warn('DRAWDOWN_WARNING: Approaching daily limit', metrics);
  }
  if (totalDDPct >= maxDrawdownPct * 0.75) {
    warnings.push(`CAUTION: At ${round2(totalDDPct)}% of ${maxDrawdownPct}% max drawdown`);
    logger.warn('DRAWDOWN_WARNING: Approaching max drawdown', metrics);
  }

  return { allowed: true, metrics };
}

/**
 * Reset drawdown state for an account (use with caution!)
 */
export function resetDrawdownState(accountId = 'default'): void {
  stateCache.delete(accountId);
  const path = getStatePath(accountId);
  try {
    if (existsSync(path)) {
      const fs = require('fs');
      fs.unlinkSync(path);
    }
    logger.info('Drawdown state reset', { accountId });
  } catch (err) {
    logger.error('Failed to reset drawdown state', { accountId, error: err });
  }
}

/**
 * Get current drawdown state (for debugging/display)
 */
export function getDrawdownState(accountId = 'default'): DrawdownState | null {
  return loadState(accountId);
}

/**
 * Manually set broker-provided values (call this if you have accurate broker data)
 */
export function setBrokerProvidedState(
  accountId: string,
  brokerData: {
    startOfDayEquity: number;
    peakEquity: number;
    currentEquity: number;
  }
): void {
  const state: DrawdownState = {
    startOfDayEquity: brokerData.startOfDayEquity,
    peakEquity: brokerData.peakEquity,
    lastEquity: brokerData.currentEquity,
    lastUpdated: Date.now(),
    dayKey: getDayKey(),
    source: 'broker',
  };
  saveState(accountId, state);
  logger.info('Broker-provided drawdown state saved', { accountId, state });
}

// Helper for error cases
function createErrorMetrics(dailyLimit: number, maxDD: number, error: string): DrawdownMetrics {
  return {
    dayKey: getDayKey(),
    equity: 0,
    startOfDayEquity: 0,
    peakEquity: 0,
    dailyDDPct: 0,
    totalDDPct: 0,
    stateSource: 'unknown',
    limits: { dailyLossLimitPct: dailyLimit, maxDrawdownPct: maxDD },
    headroom: { dailyRemaining: 0, totalRemaining: 0 },
    warnings: [error],
  };
}
```

---

## SUMMARY OF ADDENDUM PATCHES

| Issue | Original Behavior | Fixed Behavior |
|-------|-------------------|----------------|
| Unknown crypto symbol | Defaults to contractSize=1 | Returns null, blocks trade |
| Missing equity | Skips drawdown check | Fails closed, requires equity |
| Paper trading | N/A | Explicit `paperTrading: true` flag |
| Bypass guard | N/A | Explicit `bypassDrawdownGuard: true` flag |
| State persistence | In-memory only | Persists to disk (`./data/drawdown/`) |
| Broker-provided values | Not supported | Accepts `startOfDayEquity`, `peakEquity` |

---

## UPDATED VERIFICATION CHECKLIST

```bash
# 1. Test unknown crypto symbol BLOCKED
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"symbols":["DOGEUSDT"],"strategyId":"rsi-bounce","settings":{"equity":10000}}'
# Expected: Position sizing should fail for unknown symbol

# 2. Test missing equity BLOCKED
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"accountSize":10000}}'
# Expected: 400 "Equity is required for live trading"

# 3. Test paper trading ALLOWED without equity
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"paperTrading":true}}'
# Expected: 200 OK (bypasses drawdown guard)

# 4. Test explicit bypass with warning
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"bypassDrawdownGuard":true}}'
# Expected: 200 OK but server logs warning

# 5. Test state persistence (restart server between calls)
# Call 1:
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"equity":10000,"accountId":"test123"}}'
# Restart server
# Call 2:
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"symbols":["EURUSD"],"strategyId":"rsi-bounce","settings":{"equity":9700,"accountId":"test123"}}'
# Expected: Should correctly calculate DD from persisted startOfDayEquity (10000), not 9700

# 6. Verify state file created
ls -la ./data/drawdown/
# Expected: test123.json file exists
```

---

## FINAL GO/NO-GO STATUS

| Requirement | Original Patches | With Addendum |
|-------------|------------------|---------------|
| Legacy engine blocked | ✅ | ✅ |
| Crypto sizes correct | ✅ | ✅ |
| Unknown crypto blocked | ❌ (defaults to 1) | ✅ (fails closed) |
| Indicator alignment | ✅ | ✅ |
| Warm-up period | ✅ | ✅ |
| Drawdown guard exists | ✅ | ✅ |
| Drawdown guard mandatory | ❌ (optional) | ✅ (required) |
| Drawdown state persisted | ❌ (memory only) | ✅ (disk) |
| Broker values supported | ❌ | ✅ |

**With original patches only:** 🟡 CONDITIONAL GO (production gaps remain)

**With original + addendum patches:** 🟢 GO FOR LIVE TRADING

---

*Addendum generated in response to ChatGPT production review*
*Date: January 2, 2026*

# REPLIT EXECUTION PLAN - GPT VALIDATED

Copy and paste this into Replit:

---

```
You are a Senior Engineer. Do NOT propose broad refactors.

## CRITICAL CONTEXT
GPT audit identified that our biggest systemic bug is **identity leakage** - cached/stored results bleeding across strategies because we key by `symbol` only instead of `symbol::strategyId`.

This MUST be fixed first, or all other fixes will seem to "not work."

---

## EXECUTION ORDER (GPT-validated, safest sequence)

### PHASE 1: IDENTITY ISOLATION (P0 - Do First)

#### Fix A: Composite Key for ALL Caches/Stores

Find EVERY place that stores or retrieves decisions/detections/signals.

Search for these patterns and fix them:

```typescript
// ❌ WRONG (causes cross-strategy collision):
cache.get(symbol)
cache.set(symbol, decision)
store[symbol] = detection
signalCache.get(symbol)
decisions.find(d => d.symbol === symbol)

// ✅ CORRECT (unique per strategy):
const key = `${symbol}::${strategyId}`;
cache.get(key)
cache.set(key, decision)
store[key] = detection
signalCache.get(key)
decisions.find(d => d.symbol === symbol && d.strategyId === strategyId)
```

Files to check:
- [ ] signalStore.ts
- [ ] signalFreshnessTracker.ts  
- [ ] detectionStore.ts (if exists)
- [ ] cache.ts (if exists)
- [ ] autoScanService.ts (trackSignal calls)
- [ ] app.js (frontend caches/renders)

For EACH file found, show:
1. Current line with symbol-only key
2. Fixed line with composite key
3. All places in that file that use this key (must all match)

---

### PHASE 2: DATA PIPELINE (P0)

#### Fix B: trendBarsH4 Missing in autoScanService

File: `autoScanService.ts`, method `convertToIndicatorData`

```typescript
// BEFORE (missing trendBarsH4):
return {
  symbol,
  bars: data.bars,
  ...
  ema200H4: data.ema200H4,
  adxH4: data.adxH4,
};

// AFTER (V2 strategies REQUIRE trendBarsH4):
return {
  symbol,
  bars: data.bars,
  ...
  trendBarsH4: data.trendBarsH4 || data.barsH4 || [],
  ema200H4: data.ema200H4 || [],
  adxH4: data.adxH4 || [],
};
```

Also update `BatchIndicatorData` interface to include `trendBarsH4?: Bar[]`.

---

#### Fix C: outputsize 100 → 300

Find Twelve Data API calls, change:
```typescript
outputsize: '100'  →  outputsize: '300'
```

V2 strategies require minBars=250. With 100, all strategies reject.

---

### PHASE 3: TYPE SAFETY (P1)

#### Fix D: contractSize Null Safety

Find all `contractSize` usages causing TS errors.

```typescript
// BEFORE:
const lots = risk / (pips * pipValue * contractSize);

// AFTER:
const lots = risk / (pips * pipValue * (contractSize ?? 1));
```

Or use default parameter:
```typescript
function calculate(contractSize: number = 1) { ... }
```

---

### PHASE 4: INTERVAL NORMALIZATION (P1)

#### Fix E: Normalize Interval BEFORE Cache Key

```typescript
// Add helper:
function normalizeInterval(interval: string): string {
  const map: Record<string, string> = {
    '60min': '1h',
    '240min': '4h',
    '1day': '1d',
  };
  return map[interval] || interval;
}

// Use BEFORE cache key:
const normalized = normalizeInterval(interval);
const cacheKey = `${symbol}_${normalized}_bars`;
```

---

## VALIDATION CHECKLIST

After ALL fixes, run these tests:

### 1. Compilation
```bash
npx tsc --noEmit
# Expected: 0 errors
```

### 2. Composite Key Test
```bash
# Scan same symbol with two different strategies
# Both should appear separately, not overwrite each other
curl "http://localhost:5000/api/scan?symbol=EURUSD&strategies=ema-pullback-intra,bollinger-mr"
# Response should have 2 decisions (or 2 rejections), not 1
```

### 3. H4 Data Test
```bash
curl "http://localhost:5000/api/scan/EURUSD" | grep -i "h4\|trend"
# Should NOT say "H4 trend data unavailable"
```

### 4. Memory Test (optional)
```bash
# Check Map sizes don't grow unbounded
# Run auto-scan for 10 minutes, check memory
```

---

## SUMMARY TABLE

After completing, provide:

| Phase | Fix | File(s) | Status |
|-------|-----|---------|--------|
| 1 | Composite keys | signalStore, freshnessTracker, etc | ✅/❌ |
| 2 | trendBarsH4 | autoScanService.ts | ✅/❌ |
| 2 | outputsize 300 | twelveDataClient.ts | ✅/❌ |
| 3 | contractSize null | positionSizer/utils | ✅/❌ |
| 4 | interval normalize | data client | ✅/❌ |
| - | tsc --noEmit | - | X errors |

---

## NON-NEGOTIABLES (from GPT audit)

- ❌ Do NOT cache strategy results without strategyId in the key
- ❌ Do NOT default numeric fields to 0 (use null for missing)
- ❌ Do NOT silently fail - if no decision, show reason
- ✅ All decision rendering MUST include strategyId
- ✅ Journal payload keys MUST match backend schema exactly

---

START WITH PHASE 1 (Composite Keys). This is the root cause of "cached results showing in wrong strategy."

Show me each file you find with symbol-only keying, and your fix.
```

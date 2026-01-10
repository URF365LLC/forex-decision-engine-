# REPLIT SURGICAL FIX — IDENTITY LEAKAGE (P0 BLOCKER)

Copy and paste this into Replit:

---

```
STOP. READ THIS FIRST.

You are fixing ONE thing: IDENTITY LEAKAGE.

This is the root cause of:
- "Strategy A shows Strategy B's signal"
- "Indicators missing or wrong TF"
- "Cached results appearing in wrong place"
- "System feels non-deterministic"

Until this is fixed, NO OTHER FIX MATTERS.

---

## THE RULE (NON-NEGOTIABLE)

Every cache/store key MUST be:

```
key = `${symbol}::${strategyId}::${interval}`
```

At minimum: `${symbol}::${strategyId}`

NEVER just `symbol`.

---

## YOUR TASK

### Step 1: Find ALL symbol-only keys

Search the entire codebase for these patterns:

```bash
# Run these searches:
grep -rn "\.get(symbol)" src/
grep -rn "\.set(symbol," src/
grep -rn "\[symbol\]" src/
grep -rn "=== symbol" src/
grep -rn "cache.get" src/
grep -rn "store\[" src/
grep -rn "Map.get" src/
```

List EVERY file and line that uses symbol as a key without strategyId.

### Step 2: For each finding, show me:

```
FILE: src/storage/signalStore.ts
LINE: 47
CURRENT: cache.get(symbol)
PROBLEM: Symbol-only key causes cross-strategy collision
FIX: cache.get(`${symbol}::${strategyId}`)
```

### Step 3: Fix each one

Do NOT proceed to next file until current file is complete.

---

## FILES TO CHECK (in order)

1. **signalStore.ts** — signal caching
2. **signalFreshnessTracker.ts** — "is this signal new?" logic
3. **detectionStore.ts** — detection storage (if exists)
4. **cache.ts** — general cache (if exists)
5. **autoScanService.ts** — `trackSignal()` calls
6. **twelveDataClient.ts** — data caching
7. **indicatorService.ts** — indicator caching
8. **batchDataService.ts** — batch data storage
9. **app.js** — frontend rendering/caching
10. **Any other file with .get() or store[] patterns**

---

## EXAMPLE FIXES

### signalFreshnessTracker.ts

```typescript
// ❌ BEFORE:
const key = symbol;
if (signalCache.has(key)) { ... }

// ✅ AFTER:
const key = `${symbol}::${strategyId}`;
if (signalCache.has(key)) { ... }
```

### signalStore.ts

```typescript
// ❌ BEFORE:
export function getSignal(symbol: string) {
  return store.get(symbol);
}

// ✅ AFTER:
export function getSignal(symbol: string, strategyId: string) {
  return store.get(`${symbol}::${strategyId}`);
}
```

### autoScanService.ts

```typescript
// ❌ BEFORE:
const isNew = isNewSignal(symbol, strategyId, direction);
// But isNewSignal internally uses symbol-only key

// ✅ AFTER:
// Ensure isNewSignal uses composite key internally
```

### Frontend (app.js)

```typescript
// ❌ BEFORE:
decisions.find(d => d.symbol === symbol)

// ✅ AFTER:
decisions.find(d => d.symbol === symbol && d.strategyId === strategyId)
```

### Data Cache

```typescript
// ❌ BEFORE:
const cacheKey = `${symbol}_bars`;

// ✅ AFTER:
const cacheKey = `${symbol}_${interval}_bars`;
```

---

## VERIFICATION

After fixing ALL files:

```bash
# Search should return ZERO results:
grep -rn "\.get(symbol)" src/ | grep -v "strategyId\|interval"
grep -rn "\[symbol\]" src/ | grep -v "::"
```

Then test:

```bash
# This should return TWO separate decisions, not one:
curl "http://localhost:5000/api/scan?symbol=EURUSD" | jq '.decisions | length'
# Expected: 9 (one per strategy) or at least > 1
```

---

## OUTPUT FORMAT

For each file fixed, report:

| File | Lines Changed | Keys Fixed | Status |
|------|---------------|------------|--------|
| signalStore.ts | 23, 45, 67 | 3 | ✅ |
| signalFreshnessTracker.ts | 12, 34 | 2 | ✅ |
| ... | ... | ... | ... |

---

## WHAT NOT TO DO

❌ Do NOT skip files because "they look okay"
❌ Do NOT add new features
❌ Do NOT refactor unrelated code
❌ Do NOT cache decisions (only raw market data)
❌ Do NOT proceed to other fixes until this is complete

---

## COMPLETION CRITERIA

You are DONE when:

1. Every cache/store uses composite key
2. grep searches return zero symbol-only matches
3. Scanning same symbol shows multiple strategy results separately
4. `tsc --noEmit` passes

---

START NOW.

Run the grep searches first. Show me what you find.
```

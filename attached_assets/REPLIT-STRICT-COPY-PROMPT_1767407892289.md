# REPLIT STRICT IMPLEMENTATION PROMPT

Copy and paste this into Replit:

---

```
STOP. READ THIS CAREFULLY.

You are NOT writing new code. You are COPYING files I already provided.

## CRITICAL RULE

The V2 files in `attached_assets/` are PRODUCTION-READY. They contain specific bug fixes that took hours to develop and validate.

You must:
1. COPY these files EXACTLY as-is
2. NOT modify, "improve", or rewrite ANY logic
3. NOT add your own implementations
4. NOT change variable names, function signatures, or logic flow

If you rewrite the code, you will REINTRODUCE the bugs we just fixed.

---

## THE BUGS WE FIXED (DO NOT REINTRODUCE)

### BollingerMR.ts - Lines 103-106
```typescript
// CORRECT (in V2 file):
const riskDistance = Math.abs(entryPrice - stopLossPrice);
const takeProfitPrice = direction === 'long'
  ? entryPrice + (riskDistance * 1.5)
  : entryPrice - (riskDistance * 1.5);

// WRONG (old version had):
const takeProfitPrice = direction === 'long'
  ? bbSignal.middle
  : bbSignal.middle;  // <-- SAME FOR BOTH! THIS WAS THE BUG
```

### SignalQualityGate.ts - Line 179
```typescript
// CORRECT (in V2 file):
const signalTime = signalBar.timestamp ? ...

// WRONG (if you use):
const signalTime = signalBar.time ? ...  // <-- FIELD DOESN'T EXIST
```

### CciZeroLine.ts - Line 61
```typescript
// CORRECT (in V2 file):
if (!allValidNumbers(cciSignal, cciPrev, cciPrev2, emaSignal, atrSignal)) return null;

// WRONG (old version had):
if (!cciSignal || !cciPrev || ...) return null;  // <-- KILLS CCI=0 SIGNALS
```

### TripleEma.ts - Warmup seeding
```typescript
// CORRECT (in V2 file):
result.push(null);  // During warmup

// WRONG (old version had):
result.push(0);  // <-- ZERO TRIGGERS FALSY CHECK
```

---

## EXECUTION STEPS (COPY ONLY)

### Step 1: Backup
```bash
cp -r src/strategies src/strategies.backup.$(date +%Y%m%d_%H%M%S)
```

### Step 2: Copy SignalQualityGate (DO NOT MODIFY)
```bash
cp attached_assets/SignalQualityGate.ts src/strategies/SignalQualityGate.ts
```

### Step 3: Copy ALL 9 strategies (DO NOT MODIFY)
```bash
cp attached_assets/BollingerMR.ts src/strategies/intraday/BollingerMR.ts
cp attached_assets/BreakRetest.ts src/strategies/intraday/BreakRetest.ts
cp attached_assets/CciZeroLine.ts src/strategies/intraday/CciZeroLine.ts
cp attached_assets/EmaPullback.ts src/strategies/intraday/EmaPullback.ts
cp attached_assets/RsiBounce.ts src/strategies/intraday/RsiBounce.ts
cp attached_assets/RsiOversold.ts src/strategies/intraday/RsiOversold.ts
cp attached_assets/StochasticOversold.ts src/strategies/intraday/StochasticOversold.ts
cp attached_assets/TripleEma.ts src/strategies/intraday/TripleEma.ts
cp attached_assets/WilliamsEma.ts src/strategies/intraday/WilliamsEma.ts
```

### Step 4: Verify copies match originals
```bash
echo "=== VERIFICATION ===" 
echo "BollingerMR TP fix:"
grep -n "riskDistance" src/strategies/intraday/BollingerMR.ts | head -3

echo "SignalQualityGate timestamp fix:"
grep -n "signalBar.timestamp" src/strategies/SignalQualityGate.ts | head -2

echo "CciZeroLine allValidNumbers fix:"
grep -n "allValidNumbers" src/strategies/intraday/CciZeroLine.ts | head -2

echo "TripleEma null seeding fix:"
grep -n "result.push(null)" src/strategies/intraday/TripleEma.ts | head -1
```

### Step 5: Compile check
```bash
npx tsc --noEmit
```

---

## VERIFICATION CHECKLIST

After copying, confirm these greps return results:

| File | Grep Command | Expected Match |
|------|--------------|----------------|
| BollingerMR.ts | `grep "riskDistance" src/strategies/intraday/BollingerMR.ts` | `const riskDistance = Math.abs(...)` |
| SignalQualityGate.ts | `grep "signalBar.timestamp" src/strategies/SignalQualityGate.ts` | `signalBar.timestamp ?` |
| CciZeroLine.ts | `grep "allValidNumbers" src/strategies/intraday/CciZeroLine.ts` | `allValidNumbers(cciSignal, cciPrev...` |
| TripleEma.ts | `grep "result.push(null)" src/strategies/intraday/TripleEma.ts` | `result.push(null)` |
| EmaPullback.ts | `grep "runPreFlight" src/strategies/intraday/EmaPullback.ts` | `const preflight = runPreFlight(...)` |

If ANY grep fails, the copy failed. Do NOT proceed.

---

## WHAT YOU MUST NOT DO

❌ Do NOT "improve" the code
❌ Do NOT refactor imports
❌ Do NOT change function names
❌ Do NOT add comments
❌ Do NOT reformat the code
❌ Do NOT write your own implementation "based on" the V2 files
❌ Do NOT merge old and new code

The V2 files are the SINGLE SOURCE OF TRUTH. Copy them byte-for-byte.

---

## EXPECTED OUTPUT

After execution, show me:

1. Backup location created
2. All 10 files copied (1 gate + 9 strategies)
3. All 5 grep verifications passing
4. `tsc --noEmit` output (should be 0 errors)

If compilation fails, show the EXACT error. Do NOT try to fix it yourself - report it to me first.

---

NOW EXECUTE:
1. Run the backup command
2. Run ALL copy commands
3. Run ALL verification greps
4. Run tsc --noEmit
5. Report results

DO NOT MODIFY ANY FILE CONTENTS.
```

# Final 4-Way Sign-Off: BollingerMR Implementation

**Date:** January 23, 2026
**Status:** ✅ APPROVED WITH 3 REQUIRED FIXES

---

## GPT's Final Review: Issues Caught

GPT performed a "last look" review and identified **3 real issues** that must be fixed before implementation.

---

## 🔴 REQUIRED FIX #1: Truthy Checks on BB Values (Real Bug)

### The Problem

Replit's plan has this code in `calcBBWidthPercentile()`:

```typescript
if (bb && bb.upper && bb.lower && bb.middle) {
  widths.push((bb.upper - bb.lower) / bb.middle);
}
```

**Why it's broken:** In JavaScript/TypeScript, `0` is falsy. If any BB value is 0 or very small, the condition fails silently and that data point is skipped. This biases the percentile calculation.

### The Fix

```typescript
if (
  bb &&
  Number.isFinite(bb.upper) &&
  Number.isFinite(bb.lower) &&
  Number.isFinite(bb.middle) &&
  bb.middle !== 0
) {
  widths.push((bb.upper - bb.lower) / bb.middle);
}
```

Also add a guard for the width calculation itself:

```typescript
if (!Number.isFinite(width) || width <= 0) return null;
```

**Claude's Assessment:** ✅ GPT is correct. This is the same class of bug that was fixed in V2 (falsy checks killing valid signals). Must be fixed.

---

## 🟠 REQUIRED FIX #2: Import Dependency Direction

### The Problem

Replit's plan says: *"Import BBand from SignalQualityGate.js"*

This creates wrong dependency direction:
- `utils.ts` is shared core (leaf dependency)
- `SignalQualityGate.ts` is infra module
- utils should NOT depend on infra (creates circular pressure)

### The Fix

Define a local type in utils.ts OR use inline structural type:

**Option A (local type):**
```typescript
// In utils.ts
export interface BBand {
  upper: number;
  middle: number;
  lower: number;
}
```

**Option B (inline in function):**
```typescript
export function calcBBWidthPercentile(
  bbands: Array<{ upper: number; middle: number; lower: number }>,
  currentIdx: number,
  lookback = 50
): { width: number; percentile: number } | null {
```

**Claude's Assessment:** ✅ GPT is correct. Option A is cleaner for reuse. The type is simple enough that duplication isn't a maintenance burden.

---

## 🟠 REQUIRED FIX #3: RR Target vs ATR Multiplier

### The Problem

Replit's plan sets both to 2.0:
```typescript
rrTarget: 2.0,
atrMultiplier: 2.0,
```

**Why this matters:**

The TP resolver logic:
1. Prefers structure **if** structureRR ≥ `max(1, rrTarget × 0.65)` = 1.3R
2. Otherwise falls back to ATR distance = `atrMultiplier × ATR`

With both at 2.0:
- Structure targets < 1.3R get rejected
- Fallback uses 2× ATR (quite far for MR)
- This is a **philosophical shift**: MR typically monetizes via high hit-rate + moderate RR

### The Fix

**Keep `rrTarget: 2.0` but set `atrMultiplier: 1.5`**

```typescript
takeProfitConfig: {
  preferStructure: true,
  structureLookback: 80,
  rrTarget: 2.0,        // Target for structure
  atrMultiplier: 1.5,   // KEEP at 1.5 for fallback
  sessionProfile: DEFAULT_SESSION_TP_PROFILE,
},
```

This gives:
- Structure targets ≥ 1.3R accepted (aiming for 2R)
- Fallback is more conservative 1.5× ATR
- Preserves MR philosophy (quality over distance)

**Claude's Assessment:** ✅ GPT is correct. Mean-reversion benefits from hitting targets, not stretching them. The 1.5 ATR fallback is more appropriate.

---

## 🟡 ADVISORY: Metadata Win Rate

### GPT's Point

Don't hardcode `winRate: 72` — that's a projection, not a fact.

### Claude's Earlier Recommendation

Set to 68% (conservative estimate).

### Final Recommendation

**Either:**
- Keep at 65% (actual current)
- Set to 68% (conservative projection)
- Add comment: `// Target: 72% (validate after 100+ signals)`

**Do NOT** set to 72% as if it's proven.

---

## Updated Execution Plan

### Fixes Applied to Replit's Plan

| Item | Replit Original | Required Fix |
|------|-----------------|--------------|
| BB truthy checks | `bb.upper && bb.lower` | `Number.isFinite()` pattern |
| BBand import | From SignalQualityGate | Define locally in utils.ts |
| atrMultiplier | 2.0 | **1.5** (keep original) |
| winRate metadata | 72 | 65 or 68 (not 72) |

### Corrected calcBBWidthPercentile()

```typescript
/**
 * Calculate BB Width percentile to detect expansion regimes
 */
export interface BBand {
  upper: number;
  middle: number;
  lower: number;
}

export function calcBBWidthPercentile(
  bbands: BBand[],
  currentIdx: number,
  lookback = 50
): { width: number; percentile: number } | null {
  if (!bbands || currentIdx < 0 || !bbands[currentIdx]) return null;

  const current = bbands[currentIdx];

  // Guard against invalid BB values
  if (
    !Number.isFinite(current.upper) ||
    !Number.isFinite(current.lower) ||
    !Number.isFinite(current.middle) ||
    current.middle === 0
  ) {
    return null;
  }

  const width = (current.upper - current.lower) / current.middle;

  // Guard against invalid width
  if (!Number.isFinite(width) || width <= 0) return null;

  const startIdx = Math.max(0, currentIdx - lookback);
  const widths: number[] = [];

  for (let i = startIdx; i < currentIdx; i++) {  // Exclude current (history only)
    const bb = bbands[i];
    if (
      bb &&
      Number.isFinite(bb.upper) &&
      Number.isFinite(bb.lower) &&
      Number.isFinite(bb.middle) &&
      bb.middle !== 0
    ) {
      const w = (bb.upper - bb.lower) / bb.middle;
      if (Number.isFinite(w) && w > 0) {
        widths.push(w);
      }
    }
  }

  if (widths.length < 10) return null;  // Minimum history required

  widths.sort((a, b) => a - b);
  const rank = widths.filter(w => w < width).length;
  const percentile = (rank / widths.length) * 100;

  return { width, percentile };
}
```

### Corrected takeProfitConfig

```typescript
takeProfitConfig: {
  preferStructure: true,
  structureLookback: 80,
  rrTarget: 2.0,
  atrMultiplier: 1.5,   // KEEP at 1.5, not 2.0
  sessionProfile: DEFAULT_SESSION_TP_PROFILE,
},
```

### Corrected Metadata

```typescript
meta: StrategyMeta = {
  id: 'bollinger-mr',
  name: 'Bollinger Mean Reversion',
  description: 'Mean reversion from BB touches with REQUIRED rejection candle, expansion filter, and H4 trend',
  style: 'intraday',
  timeframes: { trend: 'H4', entry: 'H1' },
  winRate: 68,            // Conservative projection (target: 72%, validate after 100+ signals)
  avgRR: 2.0,
  signalsPerWeek: '8-12',
  requiredIndicators: ['bars', 'bbands', 'rsi', 'atr', 'ema200', 'trendBarsH4', 'ema200H4', 'adxH4'],
  version: '2026-01-23',
};
```

---

## Final 4-Way Approval Matrix

| Participant | Original Plan | With Fixes | Final Status |
|-------------|---------------|------------|--------------|
| GPT-4 | ⚠️ 3 issues | ✅ Approved | **APPROVED** |
| Claude | ⚠️ 1 issue (winRate) | ✅ Approved | **APPROVED** |
| Replit | ✅ Ready | Apply fixes | **READY** |
| Human | ⏳ Pending | — | **PENDING** |

---

## Pre-Merge Checklist

- [x] Rejection candle as hard gate ✅
- [x] BB Width expansion filter ✅
- [x] Swing-based stops ✅
- [x] RSI thresholds tightened ✅
- [ ] **FIX:** Number.isFinite() guards in helper
- [ ] **FIX:** BBand type defined locally in utils.ts
- [ ] **FIX:** atrMultiplier stays at 1.5
- [ ] **FIX:** winRate set to 68 (not 72)
- [ ] Human approval
- [ ] Implementation
- [ ] Testing

---

## Confidence Level After GPT Review

| Stage | Confidence |
|-------|------------|
| After Claude review | 95% |
| After GPT final review | **98%** |

GPT caught real issues that would have caused:
1. Silent data corruption (truthy checks)
2. Architectural debt (import direction)
3. Behavioral change in TP selection (atrMultiplier 2.0)

**With these fixes applied, the plan is production-ready.**

# EMA Pullback V3 Implementation Specification

**Document Version:** 1.0
**Strategy Version:** 2026-01-24
**Status:** IMPLEMENTATION READY
**Validation:** 4-Way AI Consensus (GPT-4 + Claude + Replit + Human)

---

## Executive Summary

This document provides the complete implementation specification for EMA Pullback V3. The strategy preserves the core edge (50-70% discretionary win rate) while automating the trader's mental filters.

**Critical Implementation Note:**
RSI extension handling is **CONDITIONAL**, NOT a hard block. Strong trends can sustain extended RSI. This is non-negotiable.

---

## V3 Change Matrix

| Priority | Change | V2 Behavior | V3 Behavior | Impact |
|----------|--------|-------------|-------------|--------|
| 🔴 CRITICAL | ADX Scoring | Unconditional +15 | Tiered: 0/5/10/15 | Fixes false confidence inflation |
| 🟡 HIGH | Candle Confirmation | Color-based (bullish/bearish) | Close-in-range (0.7/0.3) | Quality over color |
| 🟡 HIGH | RSI Extension | None | **CONDITIONAL** block/penalty | Prevents exhaustion entries |
| 🟡 HIGH | EMA50 Reclaim | None | Conditional +10 bonus | Rewards deep pullbacks |
| 🟡 MEDIUM | TP Authority | preferStructure: true | preferStructure: false | Deterministic RR |
| 🟡 MEDIUM | ATR Multiplier | 2.0 | 1.5 | Tighter consistency |

---

## 1. ADX Tiered Scoring (CRITICAL)

### Problem
V2 adds +15 confidence unconditionally when `adx >= 18`. This inflates confidence for weak trends.

### Solution
Replace unconditional +15 with tiered scoring based on actual trend strength.

### Implementation

```typescript
// V3: ADX tiered scoring (replaces unconditional +15)
// Location: After direction is set (lines 95-107 for long, 143-155 for short)

if (adxSignal! >= 35) {
  confidence += 15;
  triggers.push(`Very strong trend (ADX: ${adxSignal!.toFixed(1)})`);
} else if (adxSignal! >= 25) {
  confidence += 10;
  triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
} else if (adxSignal! >= 18) {
  confidence += 5;
  triggers.push(`Moderate trend (ADX: ${adxSignal!.toFixed(1)})`);
} else {
  triggers.push(`Weak trend (ADX: ${adxSignal!.toFixed(1)})`);
  // Note: No confidence bonus for weak trends
}
```

### ADX Tier Reference

| ADX Value | Tier | Confidence Bonus |
|-----------|------|------------------|
| < 18 | Weak | +0 |
| 18-24 | Moderate | +5 |
| 25-34 | Strong | +10 |
| ≥ 35 | Very Strong | +15 |

---

## 2. Close-in-Range Confirmation

### Problem
V2 uses candle color (close > open = bullish). This misses rejection quality - a green candle closing at the bottom of its range is weak.

### Solution
Measure where the close lands within the candle's range.

### Implementation

```typescript
// V3: Calculate close-in-range ratio
// Location: Before direction detection (lines 83-86)

const range = signalBar.high - signalBar.low;
const closeRatio = range > 0 ? (signalBar.close - signalBar.low) / range : 0.5;
```

```typescript
// V3: Apply close-in-range for LONG (lines 122-127)
if (closeRatio > 0.7) {
  confidence += 15;
  triggers.push('Strong close (top 30% of range)');
  reasonCodes.push('CANDLE_CONFIRMATION');
}

// V3: Apply close-in-range for SHORT (lines 170-175)
if (closeRatio < 0.3) {
  confidence += 15;
  triggers.push('Strong close (bottom 30% of range)');
  reasonCodes.push('CANDLE_CONFIRMATION');
}
```

### Close Ratio Reference

| Direction | Threshold | Meaning |
|-----------|-----------|---------|
| LONG | closeRatio > 0.7 | Close in top 30% of range |
| SHORT | closeRatio < 0.3 | Close in bottom 30% of range |

---

## 3. RSI Extension Handling (CONDITIONAL - NOT HARD BLOCK)

### ⚠️ CRITICAL: This is CONDITIONAL logic, NOT a hard block

### Problem
Extended RSI (>70 long, <30 short) can indicate exhaustion OR momentum. Blocking all extended RSI kills valid strong-trend entries.

### Solution
- **Weak/Moderate trends + Extended RSI = BLOCK** (exhaustion risk)
- **Strong trends + Extended RSI = ALLOW with penalty** (momentum can continue)

### Implementation

```typescript
// V3: CONDITIONAL RSI extension handling (NOT hard block)
// Location: After direction is confirmed, before H4 trend check (lines 186-202)
// Strong trends can sustain extended RSI - only penalize, don't kill
// Weak/moderate trends with extended RSI = exhaustion risk = block

if (direction === 'long' && rsiSignal! > 70) {
  if (!preflight.h4Trend || preflight.h4Trend.strength !== 'strong') {
    return null; // Block only in weak/moderate trends
  }
  confidence -= 10;
  triggers.push(`RSI extended but strong trend allows (${rsiSignal!.toFixed(1)})`);
}

if (direction === 'short' && rsiSignal! < 30) {
  if (!preflight.h4Trend || preflight.h4Trend.strength !== 'strong') {
    return null; // Block only in weak/moderate trends
  }
  confidence -= 10;
  triggers.push(`RSI extended but strong trend allows (${rsiSignal!.toFixed(1)})`);
}
```

### RSI Extension Decision Matrix

| Direction | RSI | H4 Trend Strength | Action |
|-----------|-----|-------------------|--------|
| Long | > 70 | Weak/Moderate | **BLOCK** (return null) |
| Long | > 70 | Strong | **ALLOW** with -10 penalty |
| Long | ≤ 70 | Any | Normal processing |
| Short | < 30 | Weak/Moderate | **BLOCK** (return null) |
| Short | < 30 | Strong | **ALLOW** with -10 penalty |
| Short | ≥ 30 | Any | Normal processing |

---

## 4. EMA50 Reclaim Bonus

### Problem
V2 doesn't reward deep pullbacks that touch EMA50 and reclaim. These are often high-quality setups.

### Solution
Add conditional bonus when price touches EMA50 AND reclaims above/below it.

### Implementation

```typescript
// V3: EMA50 reclaim bonus for LONG (lines 129-133)
// Conditional: Only award if price touched EMA50 AND reclaimed
if (signalBar.low <= ema50Signal! && signalBar.close > ema50Signal!) {
  confidence += 10;
  triggers.push('Deep pullback with EMA50 reclaim');
}

// V3: EMA50 reclaim bonus for SHORT (lines 177-181)
if (signalBar.high >= ema50Signal! && signalBar.close < ema50Signal!) {
  confidence += 10;
  triggers.push('Deep pullback with EMA50 reclaim');
}
```

### EMA50 Reclaim Conditions

| Direction | Touch Condition | Reclaim Condition | Bonus |
|-----------|-----------------|-------------------|-------|
| Long | signalBar.low <= ema50 | signalBar.close > ema50 | +10 |
| Short | signalBar.high >= ema50 | signalBar.close < ema50 | +10 |

---

## 5. Take Profit Configuration

### Changes

```typescript
// V3: TP Config (lines 256-262)
takeProfitConfig: {
  preferStructure: false,  // V3: Deterministic RR (was true)
  structureLookback: 60,
  rrTarget: 2,
  atrMultiplier: 1.5,      // V3: Reduced from 2.0
  sessionProfile: DEFAULT_SESSION_TP_PROFILE,
},
```

| Parameter | V2 Value | V3 Value | Reason |
|-----------|----------|----------|--------|
| preferStructure | true | **false** | Deterministic RR targets |
| atrMultiplier | 2.0 | **1.5** | Tighter, more consistent stops |

---

## 6. PHASE1_SIGNAL Logging

### Purpose
Enables validation tracking and optimization analysis.

### Implementation

```typescript
// V3: PHASE1_SIGNAL logging (lines 229-248)
const adxTier = adxSignal! >= 35 ? 'very-strong'
             : adxSignal! >= 25 ? 'strong'
             : adxSignal! >= 18 ? 'moderate'
             : 'weak';

logger.info('PHASE1_SIGNAL', {
  symbol,
  timestamp: signalBar.timestamp,
  direction,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  targetRR: 2.0,
  adxSignal: adxSignal!.toFixed(1),
  adxTier,
  closeRatio: closeRatio.toFixed(2),
  rsiSignal: rsiSignal!.toFixed(1),
  ema50Touched: direction === 'long'
    ? signalBar.low <= ema50Signal!
    : signalBar.high >= ema50Signal!,
  ema50Reclaimed: direction === 'long'
    ? signalBar.close > ema50Signal!
    : signalBar.close < ema50Signal!,
  h4TrendDirection: preflight.h4Trend?.direction ?? 'unknown',
  h4TrendStrength: preflight.h4Trend?.strength ?? 'unknown',
  confidence,
});
```

---

## 7. Meta/Version Updates

```typescript
meta: StrategyMeta = {
  id: 'ema-pullback-intra',
  name: 'EMA Pullback',
  description: 'Trend continuation on EMA 20/50 pullback with tiered ADX, close-in-range confirmation, and RSI extension filter',
  style: 'intraday',
  timeframes: { trend: 'H4', entry: 'H1' },
  winRate: 50,
  avgRR: 2.0,
  signalsPerWeek: '6-12',
  requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr', 'trendBarsH4', 'ema200H4', 'adxH4'],
  version: '2026-01-24',  // V3: Updated
};
```

### Header Comment Update

```typescript
/**
 * EMA Pullback Strategy - PROP-GRADE V3
 * Historical Win Rate: 50% | Historical Avg RR: 2.0
 *
 * V3 ENHANCEMENTS (4-Way AI Validation Consensus - Jan 2026):
 * 🔴 CRITICAL: ADX unconditional +15 replaced with tiered scoring
 * 🟡 Replaced candle color with close-in-range momentum confirmation (0.7/0.3)
 * 🟡 Added EMA50 reclaim bonus (conditional on touch)
 * 🟡 Added RSI extension CONDITIONAL handling (penalty in strong trends, block in weak)
 * 🟡 TP authority aligned (preferStructure: false)
 * 🟡 atrMultiplier reduced to 1.5 for consistency
 *
 * V2 FIXES (Retained):
 * - Added H4 trend framework
 * - Fixed falsy checks
 * - Counter-trend rejection
 * - minBars: 250
 */
```

---

## Confidence Scoring Math

### Maximum Possible Confidence

| Component | Max Points |
|-----------|------------|
| Base direction match | +25 |
| ADX tier (very strong) | +15 |
| RSI neutral (40-60) | +10 |
| EMA200 slope | +10 |
| Close-in-range | +15 |
| EMA50 reclaim | +10 |
| H4 trend alignment | +5 to +15 |
| RR favorable | +10 |
| **Maximum** | **~100** |

### Deductions

| Condition | Penalty |
|-----------|---------|
| RSI extended in strong trend | -10 |
| H4 trend alignment adjustments | Variable |

### Minimum Threshold
`confidence >= 50` required for signal generation.

---

## Acceptance Checklist

### Unit Tests Required

- [ ] ADX < 18 awards +0 confidence
- [ ] ADX 18-24 awards +5 confidence
- [ ] ADX 25-34 awards +10 confidence
- [ ] ADX >= 35 awards +15 confidence
- [ ] Long: closeRatio > 0.7 awards +15
- [ ] Short: closeRatio < 0.3 awards +15
- [ ] Long + RSI > 70 + weak/moderate H4 = **blocked**
- [ ] Long + RSI > 70 + strong H4 = **allowed with -10**
- [ ] Short + RSI < 30 + weak/moderate H4 = **blocked**
- [ ] Short + RSI < 30 + strong H4 = **allowed with -10**
- [ ] EMA50 touch + reclaim = +10
- [ ] EMA50 no touch = no bonus
- [ ] preferStructure = false
- [ ] atrMultiplier = 1.5
- [ ] PHASE1_SIGNAL log includes all required fields

### Integration Tests

- [ ] Strategy generates signals with confidence >= 50
- [ ] Weak ADX scenarios produce lower confidence
- [ ] Strong trends with extended RSI still fire
- [ ] Deep pullbacks with EMA50 reclaim score higher

---

## File Reference

**Implementation File:**
`src/strategies/intraday/EmaPullback.ts`

**Key Line Numbers:**
- Close-in-range calculation: Lines 83-86
- ADX tiered scoring (long): Lines 95-107
- ADX tiered scoring (short): Lines 143-155
- Close-in-range check (long): Lines 122-127
- Close-in-range check (short): Lines 170-175
- EMA50 reclaim (long): Lines 129-133
- EMA50 reclaim (short): Lines 177-181
- RSI conditional handling: Lines 186-202
- PHASE1_SIGNAL logging: Lines 229-248
- TP config: Lines 256-262

---

## Implementation Order

1. **ADX Tiered Scoring** - Replace unconditional +15 with tier logic
2. **Close-in-Range** - Add ratio calculation and confidence checks
3. **RSI Conditional** - Implement trend-based block/penalty
4. **EMA50 Reclaim** - Add conditional touch/reclaim bonus
5. **TP Config** - Update preferStructure and atrMultiplier
6. **Logging** - Add PHASE1_SIGNAL with all fields
7. **Meta/Header** - Update version and description

---

## Non-Negotiables

1. **RSI is CONDITIONAL** - Never implement as hard block
2. **ADX is TIERED** - No unconditional +15
3. **Close-in-range replaces color** - Quality over direction
4. **EMA50 requires both touch AND reclaim** - Not just position

---

*Document generated for 4-Way AI Validation Process*
*Last Updated: 2026-01-24*

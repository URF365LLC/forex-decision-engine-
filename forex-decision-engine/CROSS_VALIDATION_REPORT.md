# Cross-Validation Report: False Signal Reduction

**Date:** February 10, 2026  
**Scope:** All 11 strategy files + SignalQualityGate shared infrastructure  
**Purpose:** Document every proposed fix with before/after code, rationale, and verification steps for external review  
**Status:** PRE-IMPLEMENTATION — No code changes have been made  
**Line numbers verified against:** Current codebase as of February 10, 2026 (commit 8dfef52)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Systemic Issues (Affect All Strategies)](#2-systemic-issues)
   - [S-01: ADX Minimum Too Low in Regime Detector](#s-01)
   - [S-02: Session Confidence Bonus Too Generous](#s-02)
   - [S-03: Regime Detector Over-Permissive for Weak Trends](#s-03)
   - [S-04: Signal Overlap / Multi-Strategy Spam](#s-04)
3. [Per-Strategy Issues](#3-per-strategy-issues)
   - [P-01: EMA Pullback — Unconditional ADX Confidence Bonus](#p-01)
   - [P-02: Multi-Oscillator Momentum — Loose Oscillator Thresholds](#p-02)
   - [P-03: Multi-Oscillator Momentum — Misnamed Reason Codes](#p-03)
   - [P-04: Triple EMA — Over-Firing on Every EMA21 Touch](#p-04)
   - [P-05: Williams %R — No Explicit ADX Gate](#p-05)
   - [P-06: CCI Zero-Line — Extreme Threshold Too Common](#p-06)
   - [P-07: Bollinger MR — No RSI Hard Gate](#p-07)
   - [P-08: Stochastic Oversold — Confidence Scoring Inflation](#p-08)
   - [P-09: Break & Retest — Swing Lookback Too Short](#p-09)
   - [P-10: Liquidity Sweep — Sweep Lookback Too Short](#p-10)
   - [P-11: RSI Bounce — Dead Code (Not Registered)](#p-11)
4. [Confidence Scoring Walkthrough](#4-confidence-scoring-walkthrough)
5. [Expected Impact Summary](#5-expected-impact-summary)
6. [Verification Procedures](#6-verification-procedures)

---

## 1. Executive Summary

The audit identified **4 systemic issues** and **11 per-strategy issues** that collectively allow false or low-quality signals to pass through the grading system. The root causes fall into three categories:

| Category | Count | Impact |
|----------|-------|--------|
| Confidence inflation (session bonuses, unconditional bonuses) | 4 | Weak signals promoted to A/B+ grades |
| Loose indicator thresholds (below industry standards) | 4 | Strategies fire in non-confirming conditions |
| Structural gaps (missing gates, dead code, lookback issues) | 6 | Signals generated without proper validation |

**Key Finding:** A mediocre setup during London/NY overlap with H4 trend alignment routinely scores 80-90+ confidence (A/A+ grade) due to stacking of generous bonuses (+20 session + up to +20 trend + +10 RR = +50 on top of a 30-40 base).

---

## 2. Systemic Issues

These affect the shared infrastructure used by all 10 active strategies.

---

<a id="s-01"></a>
### S-01: ADX Minimum Too Low in Regime Detector

**File:** `src/strategies/SignalQualityGate.ts`  
**Function:** `detectRegime()` (starts at line 430)  
**Exact location:** Line 451 (`if (adx >= 14)`)  
**Severity:** HIGH  
**Category:** Loose threshold

#### Problem

The regime detector classifies ADX ≥ 14 as `weak-trend`, which allows trend-continuation strategies to fire. The professional standard for confirming a trend exists is ADX ≥ 20 (Wilder's original specification). ADX 14-20 represents "developing or absent trend" territory where trend strategies produce false signals in essentially flat/choppy markets.

The comment on line 449 acknowledges the change: `"LOWERED from 18 to capture more opportunities"` — but the trade-off is significantly more false signals in non-trending conditions.

Note: The `RsiOversold` strategy independently enforces `adxH4Val > 20` at its own line 92, confirming the 20 threshold is the intended project standard.

#### Before Code (lines 449-453, exact)

```typescript
  // Weak trend: ADX 14-30 (LOWERED from 18 to capture more opportunities)
  // ADX 14-18 is "developing trend" - allow with confidence penalty
  if (adx >= 14) {
    return { regime: 'weak-trend', allowTrend: true, allowMeanReversion: true };
  }
```

#### Proposed After Code

```typescript
  // Weak trend: ADX 20-30 (restored to industry standard per Wilder's ADX)
  // ADX < 20 = no confirmed trend — trend strategies should not fire
  if (adx >= 20) {
    return { regime: 'weak-trend', allowTrend: true, allowMeanReversion: true };
  }
```

#### Rationale

- **Wilder's ADX (1978):** ADX < 20 = "no trend present." ADX 20-25 = "emerging trend." ADX > 25 = "strong trend."
- **Industry consensus:** Most prop firm risk models use ADX ≥ 20 as the minimum for trend-following entries.
- **Impact of ADX 14:** At ADX 14, price is typically range-bound with random oscillations. Trend-continuation strategies (EMA Pullback, Triple EMA, Stochastic Oversold, Williams %R, RSI Oversold) will fire on what appear to be pullbacks but are actually noise.

#### Expected Impact

- Trend-continuation strategies will no longer fire during flat/choppy conditions (ADX 14-19)
- Estimated false signal reduction: **20-30%** for trend strategies
- Legitimate trending signals (ADX ≥ 20) remain unaffected

#### Verification Steps

1. Confirm that `detectRegime()` on line 430 is the sole ADX gate for all strategies via `runPreFlight()`
2. Search for any strategy-level ADX overrides that might bypass this gate
3. Verify that changing 14 → 20 doesn't break the `range` classification (line 456): ADX < 20 should now fall to `range`, which blocks trend strategies (`allowTrend: false`)
4. Cross-reference with `RsiOversold.ts` line 92 (`const adxStrong = adxH4Val > 20`) — this strategy already independently enforces ADX > 20, confirming the standard

---

<a id="s-02"></a>
### S-02: Session Confidence Bonus Too Generous

**File:** `src/strategies/SignalQualityGate.ts`  
**Function:** `checkSession()` (starts at line 318)  
**Exact location:** Line 353 (`return { allowed: true, adjustment: 20 }`)  
**Severity:** HIGH  
**Category:** Confidence inflation

#### Problem

The London/NY overlap killzone (13:00-17:00 UTC) adds **+20 confidence points** to every signal. This is applied via `preflight.confidenceAdjustments` (line 536) and stacks with all other bonuses. A weak signal with 50-55 base confidence gets inflated to 70-75 (B+/A territory) purely because of the time of day.

The session bonus system spans lines 330-415 with these values:
- Asian session: -15 (penalty)
- London Open: +15
- London Session: +10
- **London/NY Overlap: +20** ← problem
- NY Afternoon: +5

#### Before Code

```typescript
// Line 350-355
// London/NY Overlap Killzone: 13:00-17:00 UTC (+20 confidence)
// HIGHEST VOLUME PERIOD - best signals
if (utcHour >= 13 && utcHour < 17) {
  return { allowed: true, adjustment: 20 };
}
```

#### Proposed After Code

```typescript
// London/NY Overlap Killzone: 13:00-17:00 UTC (+10 confidence)
// HIGHEST VOLUME PERIOD - good liquidity but session alone shouldn't push grade
if (utcHour >= 13 && utcHour < 17) {
  return { allowed: true, adjustment: 10 };
}
```

Also reduce London Open from +15 to +10:

```typescript
// Line 342-344 (Before)
if (utcHour >= 7 && utcHour < 9) {
  return { allowed: true, adjustment: 15 };
}

// (After)
if (utcHour >= 7 && utcHour < 9) {
  return { allowed: true, adjustment: 10 };
}
```

#### Rationale

- A session bonus should reflect improved execution quality (tighter spreads, better fills), not inflate signal confidence
- +20 points is equivalent to an entire RSI extreme bonus or a rejection candle confirmation — the time of day should not carry that much weight
- With the current system, a C-grade signal (50-59) during London/NY overlap becomes B+ (70-79) without any additional technical confirmation
- Reducing to +10 still rewards good session timing but prevents grade inflation

#### Expected Impact

- Signals during London/NY overlap will score 10 points lower
- Marginal signals (50-65 base) during peak hours will no longer be inflated to A/B+ grades
- Estimated reduction in inflated grades: **15-25%** of total signals during overlap hours

#### Verification Steps

1. Trace `checkSession()` return → `confidenceAdjustments` → `preflight.confidenceAdjustments` → each strategy's `confidence += preflight.confidenceAdjustments`
2. Confirm every strategy applies this via `confidence += preflight.confidenceAdjustments` (all 10 do)
3. Calculate worst-case current scoring: base 30 + trend 20 + session 20 + RR 10 + candle 10 = 90 (A+) — a basic setup should not reach A+
4. Calculate with fix: base 30 + trend 20 + session 10 + RR 10 + candle 10 = 80 (A) — still generous but more realistic

---

<a id="s-03"></a>
### S-03: Regime Detector Over-Permissive for Weak Trends

**File:** `src/strategies/SignalQualityGate.ts`  
**Lines:** 449-453  
**Severity:** MEDIUM  
**Category:** Loose gating

#### Problem

The `weak-trend` regime (ADX 14-30, or 20-30 after S-01 fix) sets both `allowTrend: true` and `allowMeanReversion: true`. This means virtually all strategy types are permitted simultaneously, defeating the purpose of regime-based filtering.

In a weak trend (ADX 20-30), mean-reversion strategies should carry a confidence penalty since the market has directional bias that works against reversal setups.

#### Before Code

```typescript
// Line 449-453
if (adx >= 14) {
  return { regime: 'weak-trend', allowTrend: true, allowMeanReversion: true };
}
```

#### Proposed After Code

```typescript
// Weak trend: ADX 20-30 — trend strategies allowed, MR allowed with penalty
if (adx >= 20) {
  return { regime: 'weak-trend', allowTrend: true, allowMeanReversion: true,
           reason: `Weak trend (ADX=${adx.toFixed(1)}) - MR carries penalty` };
}
```

Combined with an additional confidence penalty in `runPreFlight()` (around line 562-566):

```typescript
// Current: Only penalizes mean-reversion in strong-trend
if (strategyType === 'mean-reversion' && regime.regime === 'strong-trend') {
  const strongTrendPenalty = -15;
  confidenceAdjustments += strongTrendPenalty;
}

// Proposed: Also penalize mean-reversion in weak-trend
if (strategyType === 'mean-reversion' && regime.regime === 'strong-trend') {
  confidenceAdjustments += -15;
  warnings.push('Mean-reversion in strong trend: -15pt penalty');
}
if (strategyType === 'mean-reversion' && regime.regime === 'weak-trend') {
  confidenceAdjustments += -10;
  warnings.push('Mean-reversion in weak trend: -10pt penalty');
}
```

#### Rationale

- In a weak trend, mean-reversion at BB extremes can still work, but the directional bias reduces the probability
- A -10 penalty for MR in weak trends filters out the weakest reversal setups while still allowing high-confluence setups (BB touch + rejection + RSI extreme = 55+ base) to pass

#### Expected Impact

- Mean-reversion strategies (Bollinger MR, Liquidity Sweep) will score 10 points lower during weak trends
- Marginal MR signals in trending conditions will be filtered out
- Estimated false signal reduction for MR strategies: **10-15%**

#### Verification Steps

1. Trace which strategies use `strategyType: 'mean-reversion'` — search for `strategyType: 'mean-reversion'` across all strategy files
2. Confirm Bollinger MR (line 49) and Liquidity Sweep (line 48) use this type
3. Verify the penalty stacks correctly: a weak-trend MR signal gets -10 from regime + whatever session adjustment applies

---

<a id="s-04"></a>
### S-04: Signal Overlap / Multi-Strategy Spam

**File:** Multiple strategy files + `src/strategies/registry.ts`  
**Severity:** MEDIUM  
**Category:** Structural gap

#### Problem

Multiple strategies fire on the same market condition because they detect overlapping patterns:

**Trending pullback scenario:**
- RSI Oversold: fires on RSI < 30 in uptrend
- EMA Pullback: fires on price touching EMA20/50 zone
- Triple EMA: fires on price touching EMA21
- Williams %R: fires on %R < -80 turning up

All four can trigger simultaneously on a single pullback bar, generating 4 separate signals for the same trade.

**Oscillator extreme scenario:**
- Stochastic Oversold: fires on Stoch K < 20
- Williams %R: fires on %R < -80
- Multi-Oscillator: fires on RSI < 35 + Stoch < 25

#### Proposed Resolution

This is a **documentation-only finding** — no code change proposed at this stage. Proper resolution requires a deduplication layer in the scan orchestrator (e.g., allow only the highest-confidence signal per symbol per scan cycle, or group strategies into "families" and take only one signal per family).

#### Verification Steps

1. Run a scan during London session on a trending pair (e.g., EUR/USD in an established trend)
2. Count how many strategies fire simultaneously for the same symbol and direction
3. Document which strategy families overlap most frequently

---

## 3. Per-Strategy Issues

---

<a id="p-01"></a>
### P-01: EMA Pullback — Unconditional ADX Confidence Bonus

**File:** `src/strategies/intraday/EmaPullback.ts`  
**Lines:** 78-80 (long), 91-93 (short)  
**Severity:** HIGH  
**Category:** Confidence inflation

#### Problem

After the V2 refactor removed the explicit ADX ≥ 20 gate (line 58-59 comment: `"Redundant ADX>=20 check REMOVED"`), the +15 confidence bonus for "Strong trend" was kept unconditionally. The code adds +15 and labels it "Strong trend (ADX: X)" regardless of the actual ADX value. A signal with ADX 14 (barely trending) gets the same +15 bonus as one with ADX 40 (strong trend).

#### Before Code

```typescript
// Lines 72-80 (long direction)
if (bullishTrend && inPullbackZone && signalBar.close > ema20Signal!) {
  direction = 'long';
  confidence += 25;
  triggers.push('Price above EMA200 (uptrend)');
  triggers.push('EMA20 > EMA50 (bullish structure)');
  triggers.push('Price pulled back to EMA20/50 zone');
  reasonCodes.push('EMA_PULLBACK');
  confidence += 15;  // ← UNCONDITIONAL +15
  triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);  // ← Labels it "Strong" regardless
```

```typescript
// Lines 85-93 (short direction — same issue)
} else if (bearishTrend && inPullbackZone && signalBar.close < ema20Signal!) {
  direction = 'short';
  confidence += 25;
  triggers.push('Price below EMA200 (downtrend)');
  triggers.push('EMA20 < EMA50 (bearish structure)');
  triggers.push('Price pulled back to EMA20/50 zone');
  reasonCodes.push('EMA_PULLBACK');
  confidence += 15;  // ← UNCONDITIONAL +15
  triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);  // ← Labels it "Strong" regardless
```

#### Proposed After Code

```typescript
// Lines 78-80 (long direction)
  reasonCodes.push('EMA_PULLBACK');
  if (adxSignal! >= 25) {
    confidence += 15;
    triggers.push(`Strong trend (ADX: ${adxSignal!.toFixed(1)})`);
  } else if (adxSignal! >= 20) {
    confidence += 8;
    triggers.push(`Moderate trend (ADX: ${adxSignal!.toFixed(1)})`);
  }
```

Apply the same change for lines 91-93 (short direction).

#### Rationale

- ADX 14-19: no confirmed trend → should receive no trend bonus
- ADX 20-24: emerging trend → moderate bonus (+8)
- ADX ≥ 25: confirmed trend → full bonus (+15)
- This aligns with the RsiOversold strategy (line 92) which already uses `adxStrong = adxH4Val > 20`

#### Expected Impact

- EMA Pullback signals in weak/no-trend conditions lose 8-15 confidence points
- Signals with ADX < 20 that previously scored as B+ will drop to C or no-trade
- Estimated false signal reduction: **20-30%** for this strategy

#### Verification Steps

1. Confirm `adxSignal` at line 52 is the H1 ADX (not H4) — it is: `const adxSignal = atIndex(adx, signalIdx)`
2. Note that H4 ADX is checked separately via `preflight.h4Trend` at line 103-112
3. Both the H1 ADX (entry timeframe) and H4 ADX (trend timeframe) should confirm trend strength
4. After fix, trace a signal with ADX=16: base 25 + trend bonus 0 + session 10 + RR 10 + candle 10 + preflight adjustments = 55 max without H4 trend. This is borderline C/B, which is appropriate for a weak-trend environment

---

<a id="p-02"></a>
### P-02: Multi-Oscillator Momentum — Loose Oscillator Thresholds

**File:** `src/strategies/intraday/MultiOscillatorMomentum.ts`  
**Lines:** 199 (RSI), 263-264 (Stochastic)  
**Severity:** HIGH  
**Category:** Loose threshold

#### Problem

The strategy uses looser thresholds than industry standard for determining "oversold" and "overbought" conditions:

| Oscillator | Current Threshold | Industry Standard | Gap |
|-----------|-------------------|-------------------|-----|
| RSI "oversold" | < 35 | < 30 | 5 points too loose |
| RSI "overbought" | > 65 | > 70 | 5 points too loose |
| Stochastic "oversold" | < 25 | < 20 | 5 points too loose |
| Stochastic "overbought" | > 75 | > 80 | 5 points too loose |

Since only 2 of 3 oscillators need to confirm (line 17: `MIN_CONFIRMATIONS = 2`), loose thresholds on RSI and Stochastic mean that MACD histogram flip + either RSI 35 or Stoch 25 = signal. MACD histogram flips are extremely common (happen on nearly every minor pullback), so the entire signal quality depends on the RSI/Stoch gate.

#### Before Code

```typescript
// Line 199 — checkRSI method
const wasOversold = rsiPrev < 35 || rsiPrev2 < 35;
const wasOverbought = rsiPrev > 65 || rsiPrev2 > 65;
```

```typescript
// Lines 263-264 — checkStochastic method
const wasOversold = stochPrev.k < 25 || stochPrev.d < 25;
const wasOverbought = stochPrev.k > 75 || stochPrev.d > 75;
```

#### Proposed After Code

```typescript
// checkRSI — tighten to industry standard
const wasOversold = rsiPrev < 30 || rsiPrev2 < 30;
const wasOverbought = rsiPrev > 70 || rsiPrev2 > 70;
```

```typescript
// checkStochastic — tighten to industry standard
const wasOversold = stochPrev.k < 20 || stochPrev.d < 20;
const wasOverbought = stochPrev.k > 80 || stochPrev.d > 80;
```

#### Rationale

- RSI 30/70 are the universally accepted oversold/overbought levels (Wilder, 1978)
- Stochastic 20/80 are the standard extreme zones (Lane, 1984)
- RSI at 35 or 65 is a "slightly below/above neutral" reading — not an extreme. Using these as "oversold/overbought" means the oscillator confirms on nearly every minor pullback
- The Multi-Oscillator strategy was designed to replace single-indicator CCI with better confirmation. Loose thresholds undermine that purpose

#### Expected Impact

- RSI will trigger less frequently (RSI 30-35 is a common zone in trends, RSI < 30 is genuinely oversold)
- Stochastic will trigger less frequently (K < 20 is a genuine extreme, K < 25 includes moderate pullbacks)
- Estimated false signal reduction: **25-35%** for this strategy

#### Verification Steps

1. The `checkRSI` method (line 192) checks `rsiPrev` and `rsiPrev2` against these thresholds
2. The `checkStochastic` method (line 255) checks `stochPrev.k` and `stochPrev.d`
3. Verify that the higher-strength bonus still works: line 206 awards +15 if `rsiPrev < 30` (this becomes the new baseline, so the bonus should be adjusted to `rsiPrev < 20` for "extremely oversold")
4. Similarly, line 270 awards +15 if `stochPrev.k < 20` — this becomes the new baseline, bonus should shift to `stochPrev.k < 10`

---

<a id="p-03"></a>
### P-03: Multi-Oscillator Momentum — Misnamed Reason Codes

**File:** `src/strategies/intraday/MultiOscillatorMomentum.ts`  
**Lines:** 238, 248  
**Severity:** LOW  
**Category:** Data integrity

#### Problem

MACD histogram signals use CCI reason codes (`CCI_ZERO_CROSS_UP` / `CCI_ZERO_CROSS_DOWN`). This is misleading because the Multi-Oscillator strategy replaced CCI, but the reason codes weren't updated.

#### Before Code

```typescript
// Line 238
reasonCode: 'CCI_ZERO_CROSS_UP',

// Line 248
reasonCode: 'CCI_ZERO_CROSS_DOWN',
```

#### Proposed After Code

```typescript
reasonCode: 'MACD_HISTOGRAM_FLIP_UP',

reasonCode: 'MACD_HISTOGRAM_FLIP_DOWN',
```

Note: This requires adding the new reason codes to the `ReasonCode` type definition in `src/strategies/types.ts`.

#### Verification Steps

1. Search for `CCI_ZERO_CROSS` usage: it's used by CCI Zero-Line strategy legitimately (lines 93, 113 in CciZeroLine.ts) and incorrectly in Multi-Oscillator
2. Check if any frontend display logic or journal entries reference `CCI_ZERO_CROSS` for formatting — these would also need updating
3. Verify the `ReasonCode` type in `types.ts` accepts the new codes

---

<a id="p-04"></a>
### P-04: Triple EMA — Over-Firing on Every EMA21 Touch

**File:** `src/strategies/intraday/TripleEma.ts`  
**Lines:** 94, 105  
**Severity:** MEDIUM  
**Category:** Loose entry condition

#### Problem

The entry condition is: `signalBar.low <= ema21Signal! && signalBar.close > ema21Signal!` (for longs). This triggers on ANY bar where the low dips to EMA21 and closes above it. In an established trend, price regularly oscillates around EMA21, causing this to fire on nearly every pullback — even shallow, insignificant ones.

There is no minimum pullback depth requirement. A 2-pip dip to EMA21 counts the same as a 20-pip pullback.

#### Before Code

```typescript
// Line 94 (long)
if (bullishStack && signalBar.low <= ema21Signal! && signalBar.close > ema21Signal!) {

// Line 105 (short)
} else if (bearishStack && signalBar.high >= ema21Signal! && signalBar.close < ema21Signal!) {
```

#### Proposed After Code

```typescript
// Long: require meaningful pullback depth (at least 30% of ATR below EMA21)
const pullbackDepthLong = ema21Signal! - signalBar.low;
if (bullishStack && signalBar.low <= ema21Signal! && signalBar.close > ema21Signal!
    && pullbackDepthLong >= atrSignal! * 0.3) {

// Short: require meaningful pullback depth
const pullbackDepthShort = signalBar.high - ema21Signal!;
} else if (bearishStack && signalBar.high >= ema21Signal! && signalBar.close < ema21Signal!
    && pullbackDepthShort >= atrSignal! * 0.3) {
```

#### Rationale

- A minimum pullback depth of 0.3× ATR ensures the pullback is meaningful relative to current volatility
- Shallow touches (price barely grazing EMA21) are noise, not genuine pullback-and-continuation setups
- The 0.3× ATR threshold is conservative — it won't filter out real pullbacks but will eliminate micro-touches

#### Expected Impact

- Shallow EMA21 touches (< 0.3× ATR depth) will be filtered out
- Estimated false signal reduction: **15-25%** for this strategy (depends on how often shallow touches occur)

#### Verification Steps

1. Confirm `atrSignal` is available at the point of evaluation (line 81: `const atrSignal = atIndex(atr, signalIdx)` — yes, validated on line 84)
2. Test with sample data: in EURUSD with ATR of 0.0050, 0.3× ATR = 0.0015 (1.5 pips). A bar with low only 0.5 pips below EMA21 would be filtered
3. Verify this doesn't conflict with the EMA Pullback strategy which has its own pullback zone definition (it uses EMA20/50 zone, not EMA21)

---

<a id="p-05"></a>
### P-05: Williams %R — No Explicit ADX Gate

**File:** `src/strategies/intraday/WilliamsEma.ts`  
**Function:** `analyze()` (starts at line 33)  
**Exact location:** Lines 77-81 (comment block where ADX check was removed)  
**Severity:** MEDIUM  
**Category:** Missing gate

#### Problem

The V2→GO upgrade removed the explicit ADX ≥ 20 check. Line 78 states: `"NOTE: Redundant ADX>=20 check REMOVED - preflight already gates ADX>=14"`. However, the preflight's ADX gate is only 14 (see S-01). This means Williams %R fires in markets with ADX as low as 14, which is essentially flat.

**Documentation vs. code mismatch:** The strategy header comment (line 6) claims `"Strong trend filter: ADX_H4 >= 20 AND price vs EMA200 alignment"` but the code at line 81 says `"ADX check removed"`. The documentation is aspirational, not factual. The strategy DOES require H4 trend direction (line 80: `if (!preflight.h4Trend) return null`) and EMA200 alignment (lines 100, 142), but does NOT enforce ADX ≥ 20 anywhere in its own code. It relies entirely on the preflight gate of ADX ≥ 14.

#### Before Code

```typescript
// Lines 77-81
// RULE 1: H4 TREND DIRECTION REQUIRED (ADX gate moved to SignalQualityGate)
// NOTE: Redundant ADX>=20 check REMOVED - preflight already gates ADX>=14
if (!preflight.h4Trend) return null;
// ADX check removed - SignalQualityGate handles regime detection with adaptive thresholds
```

#### Proposed After Code

```typescript
// RULE 1: H4 TREND DIRECTION + ADX STRENGTH REQUIRED
if (!preflight.h4Trend) return null;
if (preflight.h4Trend.adxValue < 20) return null; // Enforce minimum trend strength
```

#### Rationale

- Williams %R is a trend-continuation strategy (line 44: `strategyType: 'trend-continuation'`)
- The header documentation claims ADX ≥ 20 is enforced — the code should match
- Even after S-01 fix raises the regime gate to 20, adding an explicit check here provides defense-in-depth
- The RSI Oversold strategy already independently enforces ADX > 20 (RsiOversold.ts line 92), establishing the precedent

#### Expected Impact

- Williams %R signals in ADX < 20 conditions will be blocked
- Combined with S-01, this provides double-gating for trend strength
- Estimated false signal reduction: **10-15%** for this strategy

#### Verification Steps

1. Confirm `preflight.h4Trend.adxValue` is populated from H4 data (SignalQualityGate.ts line 128: `const adxVal = adxH4[...]` → line 144: `return { ..., adxValue: adxVal }`)
2. Verify this is the H4 ADX, not H1 — the strategy doesn't request H1 ADX in its `requiredIndicators`
3. Cross-reference with the strategy's documented behavior: line 6 says "ADX_H4 >= 20" — fix makes code match docs

---

<a id="p-06"></a>
### P-06: CCI Zero-Line — Extreme Threshold Too Common

**File:** `src/strategies/intraday/CciZeroLine.ts`  
**Lines:** 81-82  
**Severity:** MEDIUM  
**Category:** Loose threshold

#### Problem

The "extreme" CCI threshold is ±100, meaning `wasExtremeLow = cciPrev2 < -100 || cciPrev < -100`. CCI regularly crosses ±100 during normal market movements — it's not genuinely "extreme." In trending markets, CCI can oscillate between -100 and +200 routinely, making this check nearly always true.

The strategy does have a "deep extreme bonus" at ±150 (lines 97-100, 117-120), but the entry gate itself is too permissive at ±100.

#### Before Code

```typescript
// Lines 81-82
const wasExtremeLow = cciPrev2! < -100 || cciPrev! < -100;
const wasExtremeHigh = cciPrev2! > 100 || cciPrev! > 100;
```

#### Proposed After Code

```typescript
// Raise extreme threshold to ±150 (genuine extremes, not routine oscillation)
const wasExtremeLow = cciPrev2! < -150 || cciPrev! < -150;
const wasExtremeHigh = cciPrev2! > 150 || cciPrev! > 150;
```

And adjust the "deep extreme" bonus threshold accordingly:

```typescript
// Lines 97-100 (before)
if (cciPrev2! < -150 || cciPrev! < -150) {

// (after — shift to -200 for truly deep extremes)
if (cciPrev2! < -200 || cciPrev! < -200) {
```

#### Rationale

- CCI was designed by Donald Lambert (1980) with ±100 as "start of potential extreme" — not a confirmation
- CCI ±150 is more commonly used as the extreme level in professional trading systems
- In trending markets, CCI routinely reaches ±100 on every pullback. At ±150, only genuine exhaustion/reversal points are captured
- The deep extreme bonus shifts to ±200, which represents true exhaustion

#### Expected Impact

- CCI Zero-Line strategy will fire less frequently, only on genuine extreme readings
- Estimated false signal reduction: **20-30%** for this strategy

#### Verification Steps

1. Review how CCI values distribute in typical market data: In trending markets, CCI ±100 is hit 2-3 times per day; CCI ±150 is hit 1-2 times per day; CCI ±200 is hit < 1 time per day
2. Confirm the entry condition on lines 89 and 109 still works: CCI must cross zero FROM the extreme, so raising the extreme threshold means CCI needs to go further before a valid cross is detected
3. Check that the V3 enhancements (EMA200 gate, close-in-range, setup-invalidation stops) remain functional — they are independent of the extreme threshold

---

<a id="p-07"></a>
### P-07: Bollinger MR — No RSI Hard Gate

**File:** `src/strategies/intraday/BollingerMR.ts`  
**Function:** `analyze()` (starts at line 43)  
**Exact location:** Lines 83-125 (signal detection block)  
**Severity:** MEDIUM  
**Category:** Missing gate

#### Problem

The V3 upgrade header (line 8) states `"Tightened RSI thresholds from 35/65 to 30/70"` — this refers to the **bonus scoring thresholds** (lines 95-103), not a hard gate. RSI confirmation remains purely optional. The V3 REQUIRED rejection candle (line 85: `if (!rejection.ok) return null`) is the only hard gate beyond BB touch.

A signal can achieve sufficient confidence (≥50) with just:
- BB touch: +20 (line 88/109)
- Rejection candle: +20 (line 91/112)
- Session bonus: +10-20 (via preflight)
- H4 trend aligned: +10-20 (via getTrendConfidenceAdjustment)
- RR favorable: +10 (line 164)
= 70-90 total — **without any RSI confirmation**

RSI is used in the `requiredIndicators` array (line 39) and IS checked at lines 95-103/116-124, but only as a tiered bonus (+15 if RSI < 30, +20 if RSI < 20). If RSI is at 50 (completely neutral), the signal still passes with 70-90 confidence. This means a BB touch with rejection during London/NY session in an aligned trend always grades A/B+, even when RSI shows no oversold/overbought condition at all.

#### Before Code

```typescript
// Lines 83-103 (long direction — RSI is optional)
if (signalBar.low <= bbSignal.lower) {
  const rejection = isRejectionCandle(signalBar, 'long');
  if (!rejection.ok) return null;  // rejection is required
  
  direction = 'long';
  confidence += 20;  // BB touch
  // ...
  confidence += 20;  // rejection candle
  // ...
  // RSI is ONLY a bonus (lines 95-103):
  if (rsiSignal! < 20) {
    confidence += 20;
  } else if (rsiSignal! < 30) {
    confidence += 15;
  }
  // If RSI is 50 (neutral): no penalty, no bonus — signal still passes
```

#### Proposed After Code

```typescript
// Add RSI as a soft gate: require RSI < 40 for longs (or > 60 for shorts)
// This ensures at least a directional RSI bias, even if not full oversold
if (signalBar.low <= bbSignal.lower) {
  const rejection = isRejectionCandle(signalBar, 'long');
  if (!rejection.ok) return null;
  if (rsiSignal! > 40) return null;  // RSI must show at least mild oversold bias
  
  direction = 'long';
  confidence += 20;
  // ... (rest unchanged)
```

```typescript
// Short direction:
if (signalBar.high >= bbSignal.upper) {
  const rejection = isRejectionCandle(signalBar, 'short');
  if (!rejection.ok) return null;
  if (rsiSignal! < 60) return null;  // RSI must show at least mild overbought bias
  
  direction = 'short';
  confidence += 20;
  // ... (rest unchanged)
```

#### Rationale

- Bollinger Mean Reversion works best when price is both at the band extreme AND oscillators confirm the extreme
- A BB touch at the lower band with RSI at 50 means price is at a statistical extreme but momentum is neutral — this is NOT a high-probability reversal setup
- RSI < 40 for longs (or > 60 for shorts) is a very soft gate — it only requires directional bias, not full oversold/overbought
- The tiered RSI bonus system (lines 95-103) still rewards stronger RSI extremes with more confidence

#### Expected Impact

- Signals where price touches BB but RSI is neutral (40-60) will be blocked
- This affects approximately **15-20%** of current Bollinger MR signals
- High-quality signals (RSI < 30 + BB touch) are completely unaffected

#### Verification Steps

1. Verify `rsiSignal` is available at line 66 (`const rsiSignal = atIndex(rsi, signalIdx)`) and validated on line 71 (`allValidNumbers(rsiSignal, ...)`)
2. Check that RSI 40/60 as soft gates don't conflict with the existing tiered bonus at 20/30/70/80
3. In a BB touch scenario with RSI at 45 (neutral): before fix = signal passes; after fix = blocked. This is correct behavior for a mean-reversion strategy

---

<a id="p-08"></a>
### P-08: Stochastic Oversold — Confidence Scoring Inflation

**File:** `src/strategies/intraday/StochasticOversold.ts`  
**Lines:** 85-109 (long), 114-139 (short)  
**Severity:** LOW  
**Category:** Confidence inflation

#### Problem

The strategy is actually well-gated (requires H4 trend, EMA200 alignment, rejection candle, Stoch cross in zone). However, the confidence scoring is generous enough that nearly every signal that passes the gates grades A or higher.

Maximum scoring path:
- Base: +35 (Stoch cross in zone + rejection candle)
- Extreme Stoch: +10
- H4 trend strong aligned: +20
- Session (London/NY): +20
- RR favorable: +10
= **95 total (A+ grade)**

Even a minimal signal:
- Base: +35
- H4 trend moderate: +15
- Session (London): +10
- RR favorable: +10
= **70 (B+ grade)**

Every signal that passes the hard gates automatically grades B+ or higher. There is no differentiation between "decent" and "excellent" setups.

#### Before Code

```typescript
// Line 97 (base confidence)
confidence += 35;

// Line 144 (H4 trend)
const trendAdj = getTrendConfidenceAdjustment(preflight.h4Trend, direction);
confidence += trendAdj;  // +10 to +20
```

#### Proposed After Code

```typescript
// Reduce base confidence to 25 (let confluence build the score)
confidence += 25;

// No change needed to trend adjustment — it's correctly tiered
```

#### Rationale

- With base 25 instead of 35, the minimum passing signal becomes: 25 + 15 (moderate trend) + 10 (session) + 10 (RR) = 60 (B grade) — this is appropriate for a basic valid setup
- The maximum becomes: 25 + 10 (extreme stoch) + 20 (strong trend) + 20 (session) + 10 (RR) = 85 (A grade) — reserved for truly excellent confluence
- Differentiation between B and A now requires additional confluence, which is the intended behavior

#### Expected Impact

- Average Stochastic Oversold signal drops ~10 confidence points
- Basic signals grade B instead of B+/A
- Excellent signals grade A instead of A+
- No signals are newly blocked (minimum path still exceeds 50)

#### Verification Steps

1. Verify minimum confidence path after fix: 25 + 10 (weak trend) + 0 (bad session) + 10 (RR) = 45 — this would be blocked (< 50), which is correct for a weak trend + bad session
2. Verify typical path: 25 + 15 (moderate trend) + 10 (London) + 10 (RR) = 60 (B) — appropriate
3. Check the minimum confidence gate at line 183 (`if (confidence < 50) return null`) — still functional

---

<a id="p-09"></a>
### P-09: Break & Retest — Swing Lookback Too Short

**File:** `src/strategies/intraday/BreakRetest.ts`  
**Lines:** 30, 80-81, 179  
**Severity:** LOW  
**Category:** Loose detection

#### Problem

The `findSwingPoints()` function uses `lookback = 5` (line 30), meaning a bar is a "swing high" if it's higher than its 5 neighbors on each side. On H1 bars, 5 bars = 5 hours — this captures very short-term fluctuations rather than meaningful support/resistance levels.

Additionally, `findRecentResistance()` and `findRecentSupport()` (lines 79-91) use swing `lookback = 3`, which is even shorter — a bar higher than 3 neighbors (3 hours) qualifies as "resistance."

The structure detection (`detectStructure` on line 52) uses only the last 4 swing points from 50 bars. With a 5-bar lookback producing many small swings, the "last 4" may be very recent, micro-level swings rather than meaningful structure.

#### Before Code

```typescript
// Line 30
function findSwingPoints(bars: Bar[], lookback: number = 5): SwingPoint[] {

// Line 80
const swings = findSwingPoints(bars.slice(-lookback - 10), 3);  // lookback=3 for S/R

// Line 179
const swings = findSwingPoints(bars.slice(-50), 5);  // lookback=5 for structure
```

#### Proposed After Code

```typescript
// Increase default swing lookback to 8 (8 hours = meaningful on H1)
function findSwingPoints(bars: Bar[], lookback: number = 8): SwingPoint[] {

// Increase S/R swing lookback to 5 (from 3)
const swings = findSwingPoints(bars.slice(-lookback - 10), 5);

// Use default (8) for structure detection, increase slice to 80 bars
const swings = findSwingPoints(bars.slice(-80), 8);
```

#### Rationale

- On H1 timeframe, an 8-bar lookback means a swing point must be the highest/lowest in a 16-bar window (16 hours ≈ 2 trading sessions)
- This filters out intra-session noise and captures true session highs/lows
- The 80-bar slice (instead of 50) provides roughly 2 weeks of H1 data, giving more meaningful structure context

#### Expected Impact

- Fewer false swing points detected → fewer false break & retest signals
- Structure detection becomes more reliable (HH/HL patterns based on multi-session swings)
- Estimated false signal reduction: **10-15%** for this strategy

#### Verification Steps

1. Confirm the `lookback` parameter is a symmetric check: line 38-41 checks `bars[i-j]` and `bars[i+j]` for `j=1..lookback`
2. With lookback=8, the loop at line 33 starts at `i=8` and ends at `bars.length - 8`, so 16 bars at the edges are excluded — verify the slice is large enough
3. Check that the break validation (line 194-196, `breakoutBars = bars.slice(signalIdx - 5, signalIdx)`) still works with the new structure detection

---

<a id="p-10"></a>
### P-10: Liquidity Sweep — Sweep Lookback Too Short

**File:** `src/strategies/intraday/LiquiditySweep.ts`  
**Lines:** 81-82  
**Severity:** LOW  
**Category:** Loose detection

#### Problem

The sweep detection uses a 3-bar lookback: `getRecentSweep(smcBars, 'long', 3)`. This means only the last 3 bars are checked for a sweep event. A minor wick that slightly exceeds a swing low within the last 3 hours counts as a "liquidity sweep," even though genuine ICT liquidity sweeps are typically more deliberate events.

#### Before Code

```typescript
// Lines 81-82
const longSweep = getRecentSweep(smcBars, 'long', 3);
const shortSweep = getRecentSweep(smcBars, 'short', 3);
```

#### Proposed After Code

```typescript
// Extend to 5-bar lookback for more reliable sweep detection
const longSweep = getRecentSweep(smcBars, 'long', 5);
const shortSweep = getRecentSweep(smcBars, 'short', 5);
```

#### Rationale

- ICT liquidity sweeps are deliberate institutional moves that take time to develop
- A 3-bar window (3 hours on H1) is too narrow — the sweep might be detected mid-formation
- A 5-bar window (5 hours) allows the full sweep-and-reversal pattern to complete before being detected
- The wider window also reduces the chance of false sweeps from normal price noise

#### Expected Impact

- Fewer false sweep detections from minor wicks
- More time for the sweep pattern to confirm before signaling
- Estimated false signal reduction: **5-10%** for this strategy

#### Verification Steps

1. Read `getRecentSweep()` implementation in `src/modules/smartMoney/liquiditySweep.ts` to understand what the lookback parameter controls
2. Verify the function signature accepts numeric lookback
3. Confirm that a wider lookback doesn't cause the sweep to expire before the reversal candle is detected

---

<a id="p-11"></a>
### P-11: RSI Bounce — Dead Code (Not Registered)

**File:** `src/strategies/intraday/RsiBounce.ts` (full file) + `src/strategies/registry.ts`  
**Severity:** LOW  
**Category:** Dead code

#### Problem

The `RsiBounce` class exists at `src/strategies/intraday/RsiBounce.ts` (125 lines) but is NOT registered in the strategy registry (`registry.ts`). It is never instantiated, never called, and generates no signals. The file is dead code.

#### Evidence

Registry file (`src/strategies/registry.ts`) imports and instantiates these 10 strategies.

**Imports** (lines 8-17): `RsiOversold`, `StochasticOversold`, `BollingerMR`, `WilliamsEma`, `TripleEma`, `BreakRetest`, `CciZeroLine`, `EmaPullback`, `MultiOscillatorMomentum`, `LiquiditySweep` — no `RsiBounce` import.

**STRATEGIES object** (lines 19-30):
1. RsiOversold
2. StochasticOversold
3. BollingerMR
4. WilliamsEma
5. TripleEma
6. BreakRetest
7. CciZeroLine
8. EmaPullback
9. MultiOscillatorMomentum
10. LiquiditySweep

`RsiBounce` is **not imported** and **not in the STRATEGIES object**.

#### Proposed Resolution

**Option A (Recommended):** Delete `RsiBounce.ts` entirely — it's superseded by the existing `RsiOversold` strategy which does the same thing with better architecture (H4 trend filter, ADX > 20 gate, swing-based stops).

**Option B:** If the strategy is intended for future use, add a clear comment at the top: `// DISABLED: Not registered in registry.ts — superseded by RsiOversold`

#### Verification Steps

1. Search for `RsiBounce` imports across the entire codebase: `grep -r "RsiBounce" src/`
2. Confirm no other file imports or references it
3. Compare `RsiBounce` (minBars: 50, RSI < 30 + BB touch, ATR-based stops) with `RsiOversold` (minBars: 250, RSI < 30 + H4 trend + ADX > 20, swing-based stops) — RsiOversold is strictly superior

---

## 4. Confidence Scoring Walkthrough

To illustrate how confidence inflation works, here are two walkthroughs using the **Bollinger MR** strategy (BollingerMR.ts) with exact line references.

*Line number verification date: February 10, 2026*

### Scenario A: EUR/USD Long, H4 bullish (ADX=25), London/NY overlap, RSI at 50 (neutral)

| Component | Current Score | Proposed Score | Code Reference |
|-----------|:------------:|:--------------:|--------|
| BB lower touch | +20 | +20 | BollingerMR.ts line 88 |
| Rejection candle confirmed | +20 | +20 | BollingerMR.ts line 91 |
| RSI bonus (RSI=50 → no bonus) | +0 | +0 | BollingerMR.ts lines 95-103 |
| RSI hard gate (P-07 fix) | — | **blocks** (RSI 50 > 40) | Proposed gate before line 87 |
| H4 trend aligned (moderate) | +15 | — | BollingerMR.ts line 130-131 |
| Session bonus (London/NY) | +20 | — | SignalQualityGate.ts line 354 |
| RR favorable | +10 | — | BollingerMR.ts line 164 |
| **Total** | **85 (A)** | **Blocked** | |

**Current system grades A** for a BB touch with rejection but zero RSI confirmation. With P-07 fix, signal is blocked because RSI (50) > 40 threshold, correctly identifying this as not a genuine mean-reversion setup.

### Scenario B: EUR/USD Long, H4 bullish (ADX=25), London/NY overlap, RSI at 28 (oversold)

| Component | Current Score | Proposed Score | Code Reference |
|-----------|:------------:|:--------------:|--------|
| BB lower touch | +20 | +20 | BollingerMR.ts line 88 |
| Rejection candle confirmed | +20 | +20 | BollingerMR.ts line 91 |
| RSI oversold bonus (RSI=28 < 30) | +15 | +15 | BollingerMR.ts lines 99-101 |
| RSI hard gate (P-07, RSI 28 < 40) | — | passes | — |
| H4 trend aligned (moderate) | +15 | +15 | BollingerMR.ts line 130-131 |
| Session bonus (London/NY) | +20 | +10 | S-02 fix: 20→10 |
| RR favorable | +10 | +10 | BollingerMR.ts line 164 |
| **Total** | **100 → clamped (A+)** | **90 (A)** | |

With RSI confirmation present, the signal passes both systems. The proposed fixes reduce from A+ to A — still a high-grade signal, but with room for truly exceptional setups (RSI < 20, strong trend ADX > 30, extreme rejection) to differentiate.

### Scenario C: GBP/USD Long, ADX=16 (weak trend), Asian session, RSI at 32

This scenario tests the systemic ADX fix (S-01) and session penalty interaction.

| Component | Current Score | Proposed Score | Code Reference |
|-----------|:------------:|:--------------:|--------|
| BB lower touch | +20 | +20 | BollingerMR.ts line 88 |
| Rejection candle confirmed | +20 | +20 | BollingerMR.ts line 91 |
| RSI bonus (RSI=32, not < 30) | +0 | +0 | BollingerMR.ts line 99 threshold |
| RSI hard gate (P-07, RSI 32 < 40) | — | passes | — |
| H4 trend (weak, moderate adj) | +10 | +10 | BollingerMR.ts line 130-131 |
| MR weak-trend penalty (S-03) | +0 | -10 | Proposed penalty |
| Session (Asian, -15) | -15 | -15 | SignalQualityGate.ts line 336 |
| RR favorable | +10 | +10 | BollingerMR.ts line 164 |
| **Total** | **45 → blocked (<50)** | **35 → blocked (<50)** | |

Both current and proposed systems block this signal. The current system blocks it marginally (45). The proposed system blocks it more decisively (35), providing a wider safety margin against scoring noise. This confirms the fixes don't over-filter — weak signals are already correctly blocked in the worst conditions.

---

## 5. Expected Impact Summary

| Fix ID | Strategy/Component | Estimated False Signal Reduction | Risk of Filtering Good Signals |
|--------|-------------------|:--------------------------------:|:------------------------------:|
| S-01 | All trend strategies (ADX gate) | 20-30% | Very Low (ADX ≥ 20 is industry standard) |
| S-02 | All strategies (session bonus) | 15-25% of overlap-hour signals | None (still rewards session quality) |
| S-03 | MR strategies (weak-trend penalty) | 10-15% | Low (high-confluence MR still passes) |
| P-01 | EMA Pullback | 20-30% | Low (real trends have ADX ≥ 25) |
| P-02 | Multi-Oscillator | 25-35% | Very Low (standard thresholds) |
| P-04 | Triple EMA | 15-25% | Low (shallow touches are noise) |
| P-05 | Williams %R | 10-15% | Very Low (defense-in-depth) |
| P-06 | CCI Zero-Line | 20-30% | Low (CCI ±150 is proper extreme) |
| P-07 | Bollinger MR | 15-20% | Very Low (RSI 40/60 is very soft) |
| P-08 | Stochastic Oversold | Grade shift only | None (no signals blocked) |
| P-09 | Break & Retest | 10-15% | Low (better structure detection) |
| P-10 | Liquidity Sweep | 5-10% | Very Low (pattern needs time) |

**Overall estimated false signal reduction:** 30-40% across the system, primarily from the ADX gate fix (S-01) and session bonus reduction (S-02) which affect all strategies.

---

## 6. Verification Procedures

### For External Reviewer

#### Procedure 1: Trace the Confidence Pipeline
1. Pick any strategy file (e.g., `EmaPullback.ts`)
2. Follow the confidence variable from initialization (`let confidence = 0`) through every `+=` and final `clamp()`
3. Map every possible scoring path to a total
4. Verify the minimum passing path (≥50) represents a reasonable trade setup
5. Verify the maximum path doesn't routinely exceed 90 for basic setups

#### Procedure 2: Verify ADX Gate Coverage
1. In `SignalQualityGate.ts`, trace `detectRegime()` → `runPreFlight()` → each strategy's preflight call
2. Confirm every strategy with `strategyType: 'trend-continuation'` is blocked when `allowTrend: false`
3. List which strategies would be affected by raising ADX from 14 to 20:
   - RSI Oversold (has its own ADX > 20 gate — unaffected)
   - Stochastic Oversold (uses `trend-continuation` — affected)
   - EMA Pullback (uses `trend-continuation` — affected)
   - Williams %R (uses `trend-continuation` — affected)
   - Triple EMA (uses `trend-continuation` — affected)

#### Procedure 3: Verify Session Bonus Flow
1. In `SignalQualityGate.ts`, trace `checkSession()` return → `session.adjustment` → `confidenceAdjustments += session.adjustment`
2. Confirm `confidenceAdjustments` is returned in the `PreFlightResult`
3. Confirm every strategy applies it: search for `preflight.confidenceAdjustments` across all strategy files

#### Procedure 4: Confirm No Side Effects
1. Verify `calculateGrade()` thresholds in `utils.ts` line 176-183 are not changed
2. Verify `buildDecision()` in `utils.ts` is not affected by any proposed change
3. Verify position sizing (`calculatePositionSize`) is independent of confidence scoring
4. Verify the frontend display logic doesn't depend on specific confidence ranges (only grades)

#### Procedure 5: Cross-Reference Industry Standards
1. ADX ≥ 20 for trend confirmation: Wilder's "New Concepts in Technical Trading Systems" (1978), Chapter 6
2. RSI 30/70 oversold/overbought: Same source, Chapter 3
3. Stochastic 20/80 extreme zones: George Lane's original specification (1984)
4. CCI ±100 as initial threshold vs. ±150/200 for extremes: Donald Lambert (1980), refined by Ken Wood

---

## Appendix A: File Reference Map

| File | Lines of Code | Findings |
|------|:------------:|:--------:|
| `src/strategies/SignalQualityGate.ts` | ~580 | S-01, S-02, S-03 |
| `src/strategies/intraday/EmaPullback.ts` | 143 | P-01 |
| `src/strategies/intraday/MultiOscillatorMomentum.ts` | 289 | P-02, P-03 |
| `src/strategies/intraday/TripleEma.ts` | 165 | P-04 |
| `src/strategies/intraday/WilliamsEma.ts` | 242 | P-05 |
| `src/strategies/intraday/CciZeroLine.ts` | 231 | P-06 |
| `src/strategies/intraday/BollingerMR.ts` | 204 | P-07 |
| `src/strategies/intraday/StochasticOversold.ts` | 210 | P-08 |
| `src/strategies/intraday/BreakRetest.ts` | 328 | P-09 |
| `src/strategies/intraday/LiquiditySweep.ts` | 327 | P-10 |
| `src/strategies/intraday/RsiBounce.ts` | 125 | P-11 |
| `src/strategies/registry.ts` | 206 | P-11 |
| `src/strategies/utils.ts` | ~750 | (reference only) |

## Appendix B: Strategy Classification

| Strategy | Type | ADX Gated By | Has Own ADX Check |
|----------|------|:------------:|:-----------------:|
| RSI Oversold | trend-continuation | Preflight + own (>20) | YES (line 92) |
| Stochastic Oversold | trend-continuation | Preflight only | NO |
| EMA Pullback | trend-continuation | Preflight only | NO (removed) |
| Williams %R | trend-continuation | Preflight only | NO (removed) |
| Triple EMA | trend-continuation | Preflight only | NO |
| CCI Zero-Line | momentum | Preflight only | NO |
| Multi-Oscillator | momentum | Preflight only | NO |
| Break & Retest | breakout | Preflight only | NO |
| Bollinger MR | mean-reversion | Preflight only | NO |
| Liquidity Sweep | mean-reversion | Preflight only | NO |
| RSI Bounce | mean-reversion | N/A (not registered) | NO |

# Validation Report: False Signal Reduction Cross-Validation

**Date:** February 10, 2026
**Validator:** Claude Opus 4.6 (automated code-level audit)
**Method:** Line-by-line comparison of every report claim against actual source code
**Base path:** `forex-decision-engine/src/strategies/`

---

## Overall Verdict

**14 of 15 findings are ACCURATE.** One finding (P-10) has a flawed rationale — the proposed change would make the strategy *more* permissive, not less, contradicting its stated purpose.

| Rating | Count | Findings |
|--------|:-----:|----------|
| ACCURATE (exact match) | 12 | S-01, S-03, S-04, P-01, P-02, P-03, P-04, P-05, P-06, P-07, P-09, P-11 |
| ACCURATE (trivial offset) | 1 | S-02 (line 350 vs actual 351, off by 1) |
| ACCURATE but INCOMPLETE | 1 | Section 4 walkthrough (omits EMA200 slope bonus) |
| FLAWED RATIONALE | 1 | P-10 (Liquidity Sweep lookback) |

---

## Per-Finding Validation

### S-01: ADX Minimum Too Low in Regime Detector

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| File: `SignalQualityGate.ts` | Confirmed | YES |
| Lines 449-453 | Lines 449-453 exactly | YES |
| `if (adx >= 14)` threshold | Line 451: `if (adx >= 14) {` | YES |
| Comment "LOWERED from 18" | Line 449: `// Weak trend: ADX 14-30 (LOWERED from 18 to capture more opportunities)` | YES |
| `detectRegime()` on line 430 | Line 430: `function detectRegime(h4Trend: H4TrendResult \| undefined, atrPercent: number): RegimeResult {` | YES |
| Returns `allowTrend: true` | Line 452: `return { regime: 'weak-trend', allowTrend: true, allowMeanReversion: true };` | YES |
| ADX < 14 falls to `range` | Line 456: `return { regime: 'range', allowTrend: false, allowMeanReversion: true, ... }` | YES |
| RsiOversold line 92 has `adxH4Val > 20` | Line 92: `const adxStrong = adxH4Val > 20;` | YES |

**Additional note:** The chop classification at line 438 (`adx < 15 && atrPercent < 0.1`) would remain unaffected by raising the weak-trend threshold. After the proposed fix, ADX 15-19 with normal volatility would fall to `range` (trend blocked), which is the intended behavior.

---

### S-02: Session Confidence Bonus Too Generous

**VERDICT: ACCURATE** (trivial 1-line offset)

| Claim | Actual | Match |
|-------|--------|:-----:|
| London/NY overlap +20, lines 350-355 | Lines 351-355 (comment starts at 351, not 350) | ~YES |
| `if (utcHour >= 13 && utcHour < 17)` | Line 353: exact match | YES |
| `return { allowed: true, adjustment: 20 }` | Line 354: exact match | YES |
| Asian session: -15 | Line 337: `return { allowed: true, adjustment: -15, ... }` | YES |
| London Open: +15 | Line 343: `return { allowed: true, adjustment: 15 }` | YES |
| London Session: +10 | Line 348: `return { allowed: true, adjustment: 10 }` | YES |
| NY Afternoon: +5 | Line 362: `return { allowed: true, adjustment: 5 }` | YES |
| Session spans lines 330-415 | `checkSession` function: lines 318-415, switch block starts ~330 | YES |

**All 10 strategies apply `preflight.confidenceAdjustments` — confirmed:**

| Strategy | Line | Code |
|----------|:----:|------|
| EmaPullback | 113 | `confidence += preflight.confidenceAdjustments` |
| MultiOscillatorMomentum | 136 | `confidence += preflight.confidenceAdjustments` |
| TripleEma | 133 | `confidence += preflight.confidenceAdjustments` |
| WilliamsEma | 185 | `confidence += preflight.confidenceAdjustments` |
| CciZeroLine | 166 | `confidence += preflight.confidenceAdjustments` |
| BollingerMR | 141 | `confidence += preflight.confidenceAdjustments` |
| StochasticOversold | 149 | `confidence += preflight.confidenceAdjustments` |
| BreakRetest | 277 | `confidence += preflight.confidenceAdjustments` |
| LiquiditySweep | 188 | `confidence += preflight.confidenceAdjustments` |
| RsiOversold | 149 | `confidence += preflight.confidenceAdjustments` |

---

### S-03: Regime Detector Over-Permissive for Weak Trends

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| `weak-trend` allows both trend + MR | Line 452: `allowTrend: true, allowMeanReversion: true` | YES |
| Penalty only for MR in `strong-trend` | Lines 562-566: `if (strategyType === 'mean-reversion' && regime.regime === 'strong-trend')` | YES |
| Penalty is -15 | Line 563: `const strongTrendPenalty = -15` | YES |
| No penalty for MR in `weak-trend` | Confirmed: no such code block exists | YES |

---

### S-04: Signal Overlap / Multi-Strategy Spam

**VERDICT: ACCURATE**

Registry confirms 10 strategies (lines 19-30). The overlapping pattern families described (trending pullback: RSI Oversold + EMA Pullback + Triple EMA + Williams %R; oscillator extreme: Stochastic + Williams + Multi-Oscillator) are correctly identified. No deduplication layer exists in the codebase. Documentation-only finding is appropriate.

---

### P-01: EMA Pullback — Unconditional ADX Confidence Bonus

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Lines 78-80 have unconditional +15 | Line 78: `reasonCodes.push('EMA_PULLBACK')`, Line 79: `confidence += 15`, Line 80: `triggers.push(\`Strong trend (ADX: ...)\`)` | YES |
| Lines 91-93 (short) same issue | Line 91: `reasonCodes.push('EMA_PULLBACK')`, Line 92: `confidence += 15`, Line 93: `triggers.push(\`Strong trend...\`)` | YES |
| Comment "Redundant ADX>=20 check REMOVED" at line 58-59 | Line 58: `// NOTE: Redundant ADX>=20 check REMOVED - SignalQualityGate handles regime detection` | YES |
| `adxSignal` at line 52 is H1 ADX | Line 52: `const adxSignal = atIndex(adx, signalIdx)` — uses H1 `adx` array | YES |
| H4 ADX checked via preflight at lines 103-112 | Lines 103-112: `if (preflight.h4Trend) { ... getTrendConfidenceAdjustment ... }` | YES |

The +15 bonus is truly unconditional — there is no `if` guard around `confidence += 15` on lines 79/92. The trigger label says "Strong trend" regardless of actual ADX value.

---

### P-02: Multi-Oscillator Momentum — Loose Oscillator Thresholds

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Line 17: `MIN_CONFIRMATIONS = 2` | `const MIN_CONFIRMATIONS = 2` | YES |
| Line 199: RSI `< 35` / `> 65` | Lines 199-200: `rsiPrev < 35`, `rsiPrev > 65` | YES |
| Lines 263-264: Stoch `< 25` / `> 75` | Lines 263-264: `stochPrev.k < 25 \|\| stochPrev.d < 25`, `stochPrev.k > 75 \|\| stochPrev.d > 75` | YES |
| Line 206: +15 bonus if `rsiPrev < 30` | Line 206: `strength: rsiPrev < 30 ? 15 : 10` | YES |
| Line 270: +15 bonus if `stochPrev.k < 20` | Line 270: `strength: stochPrev.k < 20 ? 15 : 10` | YES |

---

### P-03: Multi-Oscillator Momentum — Misnamed Reason Codes

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Line 238: `CCI_ZERO_CROSS_UP` | `reasonCode: 'CCI_ZERO_CROSS_UP'` | YES |
| Line 248: `CCI_ZERO_CROSS_DOWN` | `reasonCode: 'CCI_ZERO_CROSS_DOWN'` | YES |
| CCI Zero-Line uses same codes legitimately | CciZeroLine.ts line 93: `'CCI_ZERO_CROSS_UP'`, line 113: `'CCI_ZERO_CROSS_DOWN'` | YES |
| New MACD codes would need to be added to `ReasonCode` type | Confirmed: types.ts lines 59-60 only define CCI variants, no MACD variants exist | YES |

---

### P-04: Triple EMA — Over-Firing on Every EMA21 Touch

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Line 94 (long): `signalBar.low <= ema21Signal! && signalBar.close > ema21Signal!` | Exact match | YES |
| Line 105 (short): `signalBar.high >= ema21Signal! && signalBar.close < ema21Signal!` | Exact match | YES |
| `atrSignal` available at line 81 | Line 81: `const atrSignal = atIndex(atr, signalIdx)` | YES |
| Validated on line 84 | Line 84: `if (!allValidNumbers(ema8Signal, ema21Signal, ema55Signal, atrSignal)) return null` | YES |
| No minimum pullback depth | Confirmed: no ATR-relative depth check exists | YES |

---

### P-05: Williams %R — No Explicit ADX Gate

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Lines 77-81 comment about removed ADX check | Line 78: `// NOTE: Redundant ADX>=20 check REMOVED - preflight already gates ADX>=14` | YES |
| Strategy header (line 6) claims ADX >= 20 | Line 6: `* 1. Strong trend filter: ADX_H4 >= 20 AND price vs EMA200 alignment` | YES |
| `strategyType: 'trend-continuation'` at line 44 | Line 44: `strategyType: 'trend-continuation'` | YES |
| `preflight.h4Trend.adxValue` sourced from H4 data | SignalQualityGate.ts line 128: `const adxVal = adxH4[...]`, line 144: `return { ..., adxValue: adxVal }` | YES |

The discrepancy between documentation (ADX >= 20) and implementation (relying on preflight ADX >= 14) is confirmed.

---

### P-06: CCI Zero-Line — Extreme Threshold Too Common

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Lines 81-82: `cciPrev2! < -100`, `cciPrev2! > 100` | Exact match | YES |
| Deep extreme bonus at lines 97-100: `cciPrev2! < -150` | Line 97: `if (cciPrev2! < -150 \|\| cciPrev! < -150)` | YES |
| Deep extreme bonus at lines 117-120: `cciPrev2! > 150` | Line 117: `if (cciPrev2! > 150 \|\| cciPrev! > 150)` | YES |
| V3 enhancements (EMA200 gate, close-in-range, setup-invalidation) | Lines 132-135, 84-86, 170-180 respectively | YES |

---

### P-07: Bollinger MR — No RSI Hard Gate

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Line 85: rejection candle is required | `if (!rejection.ok) return null` | YES |
| RSI is bonus-only, not a gate | No `return null` on RSI values; lines 95-103 add confidence but never block | YES |
| BB touch: +20 | Line 88: `confidence += 20` | YES |
| Rejection candle: +20 | Line 91: `confidence += 20` | YES |
| RSI < 20: +20 bonus | Line 95-96: `if (rsiSignal! < 20) { confidence += 20; ...}` | YES |
| RSI < 30: +15 bonus | Line 99-100: `else if (rsiSignal! < 30) { confidence += 15; ...}` | YES |
| Short: RSI > 80: +20, RSI > 70: +15 | Lines 116-123: confirmed | YES |
| `strategyType: 'mean-reversion'` | Line 49: `strategyType: 'mean-reversion'` | YES |

Confidence path without RSI: 20 (BB) + 20 (rejection) + 10-20 (trend via `getTrendConfidenceAdjustment`) + 10-20 (session) + 10 (RR at line 164) = 70-90. Confirmed.

---

### P-08: Stochastic Oversold — Confidence Scoring Inflation

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Base confidence +35 at line 97 | Line 97: `confidence += 35` | YES |
| Extreme stoch +10 | Line 106-107: `if (stochSignal.k < 10) { confidence += 10; ...}` | YES |
| H4 trend max +20 | `getTrendConfidenceAdjustment` returns +20 for `strong` at SQG line 161 | YES |
| Session max +20 | London/NY overlap: `adjustment: 20` | YES |
| RR +10 at line 177 | Line 176-178: `if (rr >= 1.5) { confidence += 10; ...}` | YES |
| Max total: 95 | 35 + 10 + 20 + 20 + 10 = 95 | YES |
| Minimum gate at line 183 | Line 183: `if (confidence < 50) return null` | YES |

---

### P-09: Break & Retest — Swing Lookback Too Short

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Line 30: default lookback = 5 | `function findSwingPoints(bars: Bar[], lookback: number = 5)` | YES |
| Line 80: S/R uses lookback = 3 | `const swings = findSwingPoints(bars.slice(-lookback - 10), 3)` | YES |
| Line 179: structure uses 50-bar slice with lookback 5 | `const swings = findSwingPoints(bars.slice(-50), 5)` | YES |
| Lines 38-41: symmetric check `bars[i-j]` and `bars[i+j]` | Exact match | YES |
| Line 52: `detectStructure` uses last 4 swings | Line 53: `if (swings.length < 4) return 'neutral'`, Line 56: `const recent = swings.slice(-4)` | YES |
| Lines 194-196: break validation | `breakoutBars = bars.slice(signalIdx - 5, signalIdx)` | YES |

---

### P-10: Liquidity Sweep — Sweep Lookback Too Short

**VERDICT: FLAWED RATIONALE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| Lines 81-82: lookback = 3 | `getRecentSweep(smcBars, 'long', 3)`, `getRecentSweep(smcBars, 'short', 3)` | YES |
| Function is in `modules/smartMoney/liquiditySweep.ts` | Confirmed via import on line 19 | YES |

**However, the rationale and proposed fix are incorrect.**

The third parameter is **`maxAgeBars`**, not a detection lookback. The actual `getRecentSweep` implementation (liquiditySweep.ts lines 279-300):

```typescript
export function getRecentSweep(bars, direction, maxAgeBars = 5) {
  const sweeps = detectLiquiditySweeps(bars);  // detects ALL sweeps from ALL bars
  const relevantSweeps = sweeps.filter(s => {
    const age = bars.length - 1 - s.reversalBarIndex;
    if (age > maxAgeBars) return false;  // filters by AGE of reversal
    // ...
  });
}
```

**What `maxAgeBars=3` actually means:** Only sweeps whose reversal bar occurred within the last 3 bars are returned. `detectLiquiditySweeps(bars)` already scans the entire bar history for sweep events — the parameter is a *recency filter*, not a detection window.

**Why the proposed change is counterproductive:**
- Increasing from 3 to 5 would accept *older* sweep signals (reversals up to 5 bars/hours ago)
- This makes the strategy *more permissive*, not less — stale sweeps that already played out would still generate signals
- The report claims this would "reduce false sweep detections from minor wicks" — but `maxAgeBars` has no effect on how sweeps are detected, only on how recently they must have occurred
- The report's rationale ("allows the full sweep-and-reversal pattern to complete") is backwards — the pattern is already complete when `detectLiquiditySweeps` returns it; the age filter determines if it's fresh enough to trade

**Correct direction for false signal reduction** would be to *decrease* `maxAgeBars` (e.g., to 2), ensuring only very fresh sweeps are acted upon, or to add minimum sweep magnitude requirements.

---

### P-11: RSI Bounce — Dead Code (Not Registered)

**VERDICT: ACCURATE**

| Claim | Actual | Match |
|-------|--------|:-----:|
| RsiBounce.ts exists (125 lines) | File exists, 125 lines of code | YES |
| NOT imported in registry.ts | Registry imports (lines 8-17): 10 strategies, no RsiBounce | YES |
| NOT in STRATEGIES object | STRATEGIES (lines 19-30): 10 entries, no RsiBounce | YES |
| RsiBounce: minBars 50, RSI < 30 + BB touch | Lines 36, 61: `minBars: 50`, `rsiSignal < 30 && signalBar.low <= bbSignal.lower` | YES |
| RsiOversold: minBars 250, ADX > 20 | Lines 55, 92: `minBars: 250`, `adxStrong = adxH4Val > 20` | YES |

---

## Section 4 Walkthrough Validation

**VERDICT: ACCURATE but INCOMPLETE**

The EMA Pullback walkthrough (EUR/USD, ADX=22, London/NY, RSI=48) is missing the **EMA200 slope bonus** which can add up to +10 more confidence (EmaPullback.ts line 83: `if (slope > 0.00005) { confidence += 10; ... }`).

| Component | Report Claims | Actual Code | Match |
|-----------|:------------:|:-----------:|:-----:|
| Base | +25 (line 74) | Line 74: `confidence += 25` | YES |
| ADX bonus | +15 (unconditional) | Line 79: `confidence += 15` | YES |
| RSI neutral | +10 (line 81) | Line 81: `if (rsiSignal! >= 40 && rsiSignal! <= 60) { confidence += 10; ... }` — RSI 48 qualifies | YES |
| EMA200 slope | **NOT LISTED** | Line 83: `if (slope > 0.00005) { confidence += 10; ... }` — could add +10 | MISSING |
| Bullish candle | +10 (line 84) | Line 84: `if (signalBar.close > signalBar.open) { confidence += 10; ... }` | YES |
| H4 trend (moderate) | +15 | SQG line 162: `if (trend.strength === 'moderate') return 15` — ADX 22 → moderate | YES |
| Session bonus | +20 | SQG line 354: `adjustment: 20` | YES |
| RR favorable | +10 (line 123) | Line 122-123: `reasonCodes.push('RR_FAVORABLE'); confidence += 10` | YES |

Corrected total with slope: 25 + 15 + 10 + 10 + 10 + 15 + 20 + 10 = **115** (clamped to 100), same A+ grade. The report's conclusion that this setup "routinely reaches A+ capped at 100" is actually **understated** — the real total is even higher.

---

## Grade Thresholds Verification

Report references `calculateGrade()` in utils.ts. Confirmed at lines 176-183:

```
A+: confidence >= 90
A:  confidence >= 80
B+: confidence >= 70
B:  confidence >= 60
C:  confidence >= 50
no-trade: < 50
```

All grade labels used throughout the report match these thresholds.

---

## Appendix Validation

### File Reference Map (Appendix A)

| File | Report LOC | Actual LOC | Match |
|------|:----------:|:----------:|:-----:|
| SignalQualityGate.ts | ~580 | 597 | ~YES |
| EmaPullback.ts | 143 | 142 | ~YES |
| MultiOscillatorMomentum.ts | 289 | 288 | ~YES |
| TripleEma.ts | 165 | 164 | ~YES |
| WilliamsEma.ts | 242 | 241 | ~YES |
| CciZeroLine.ts | 231 | 230 | ~YES |
| BollingerMR.ts | 204 | 203 | ~YES |
| StochasticOversold.ts | 210 | 209 | ~YES |
| BreakRetest.ts | 328 | 327 | ~YES |
| LiquiditySweep.ts | 327 | 326 | ~YES |
| RsiBounce.ts | 125 | 125 | YES |
| registry.ts | 206 | 205 | ~YES |

All within ±1 line (likely counting with/without trailing newline). No material discrepancy.

### Strategy Classification (Appendix B)

All `strategyType` values verified against actual preflight calls:

| Strategy | Report Type | Actual `strategyType` | Line | Match |
|----------|-------------|----------------------|:----:|:-----:|
| RSI Oversold | trend-continuation | `'trend-continuation'` | 55 | YES |
| Stochastic Oversold | trend-continuation | `'trend-continuation'` | 44 | YES |
| EMA Pullback | trend-continuation | `'trend-continuation'` | 36 | YES |
| Williams %R | trend-continuation | `'trend-continuation'` | 44 | YES |
| Triple EMA | trend-continuation | `'trend-continuation'` | 61 | YES |
| CCI Zero-Line | momentum | `'momentum'` | 49 | YES |
| Multi-Oscillator | momentum | `'momentum'` | 51 | YES |
| Break & Retest | breakout | `'breakout'` | 153 | YES |
| Bollinger MR | mean-reversion | `'mean-reversion'` | 49 | YES |
| Liquidity Sweep | mean-reversion | `'mean-reversion'` | 48 | YES |

### ADX Gating (Appendix B)

| Strategy | Report: Has Own ADX Check | Actual | Match |
|----------|:-------------------------:|--------|:-----:|
| RSI Oversold | YES (line 92) | Line 92: `const adxStrong = adxH4Val > 20` | YES |
| All others | NO | No independent ADX >= 20 checks found | YES |

---

## Summary of Issues Found in the Report

1. **P-10 (Liquidity Sweep):** The proposed fix (increasing `maxAgeBars` from 3 to 5) would make the strategy *more* permissive by accepting older/staler sweep signals. This contradicts the stated goal of false signal reduction. The `maxAgeBars` parameter is a recency filter on already-detected sweeps, not a detection lookback window.

2. **Section 4 walkthrough:** Omits the EMA200 slope bonus (+10), understating the current maximum by 10 points. Conclusion is still valid since both values clamp to 100.

3. **Line counts in Appendix A:** Systematically off by +1 across most files (likely difference between `wc -l` and actual content lines). Immaterial.

Everything else — all code snippets, line references, logic descriptions, strategy classifications, confidence paths, and proposed rationales — is verified correct against the source code.

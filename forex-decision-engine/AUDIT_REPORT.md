# Forex Decision Engine — Executive Audit Report

**Audit Date:** February 9, 2026  
**Scope:** Full end-to-end read-only audit (~18,000 lines backend, ~8,000 lines frontend)  
**Methodology:** Systematic file-by-file review across 6 phases — Configuration/Types, Data Pipeline, Strategy/Risk Engine, Storage Layer, API/Server, and Frontend  
**Files Reviewed:** 60+ source files across `src/` and `public/`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Severity Definitions](#severity-definitions)
3. [Critical Findings](#critical-findings)
4. [High Severity Findings](#high-severity-findings)
5. [Medium Severity Findings](#medium-severity-findings)
6. [Low Severity Findings](#low-severity-findings)
7. [Category Breakdown](#category-breakdown)
8. [File-Level Findings Index](#file-level-findings-index)
9. [Recommendations](#recommendations)

---

## Executive Summary

The Forex Decision Engine is a well-structured trading signal application with strong architectural separation, defensive error handling, and comprehensive instrument specifications. However, the audit identified **45 findings** across severity levels that warrant attention before reliance on signals for live trading.

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 3 | Issues that could produce incorrect position sizes or financial loss |
| High | 14 | Issues that could degrade signal quality, cause data corruption, or display incorrect data |
| Medium | 16 | Issues affecting robustness, edge cases, or display accuracy |
| Low | 12 | Code quality, minor inconsistencies, or cosmetic issues |

The most impactful findings relate to: (1) pip value calculation inconsistencies for cross-currency pairs producing incorrect lot sizes, (2) frontend-backend field name mismatches causing missing display data in the primary table view, (3) drawdown guard state persistence gaps, and (4) race conditions in concurrent scan operations.

---

## Severity Definitions

- **Critical:** Could produce incorrect trade signals, wrong position sizes, or financial loss. Must be addressed before live trading.
- **High:** Could degrade signal quality, cause data loss, or produce misleading information. Should be addressed promptly.
- **Medium:** Affects robustness, edge case handling, or display accuracy. Should be addressed in normal development cycle.
- **Low:** Code quality improvements, minor inconsistencies, or cosmetic issues. Address opportunistically.

---

## Critical Findings

### C-01: Pip Value Hardcoded to $10 for All Forex — Incorrect for Cross-Currency Pairs
**Files:** `src/engine/positionSizer.ts`, `src/config/defaults.ts`  
**Category:** Data Integrity / Logic Accuracy

The position sizer uses `PIP_VALUES.standard = 10` (i.e., $10 per pip per standard lot) for **all** forex pairs. This is correct only for USD-quoted pairs (e.g., EUR/USD, GBP/USD). For cross-currency pairs (e.g., EUR/GBP, AUD/JPY, GBP/CHF), the pip value depends on the quote currency exchange rate and is NOT $10.

**Impact:** Position sizes for the 15+ non-USD-quoted forex pairs in the instrument specs will be **incorrect**. For JPY-quoted pairs, the actual pip value per lot is approximately $6.50-$7.50 (varies with USD/JPY rate), meaning position sizes would be **undersized by ~30-35%**. For pairs like EUR/GBP where GBP is the quote currency, pip values would differ based on GBP/USD rate.

**Evidence:** `defaults.ts` line 138: `standard: 10` used universally. `positionSizer.ts` line 60: `let pipValue: number = PIP_VALUES.standard` with no per-pair adjustment for non-USD quotes. The `e8InstrumentSpecs.ts` does define per-instrument `pipValue` fields (e.g., EURJPY has `pipValue: 6.7`), but the position sizer does NOT read the spec's `pipValue` — it uses the hardcoded constant.

**Note:** The `InstrumentSpec` interface includes a `pipValue` field per instrument, and these are set correctly in the specs. The issue is that `positionSizer.ts` ignores them for forex pairs.

---

### C-02: Dual Pip Value Sources Create Inconsistency
**Files:** `src/config/e8InstrumentSpecs.ts`, `src/config/defaults.ts`, `src/engine/positionSizer.ts`  
**Category:** Data Integrity

There are two independent sources of pip values:
1. `e8InstrumentSpecs.ts` — per-instrument `pipValue` field (e.g., EURJPY: 6.7, XAUUSD: 10)
2. `defaults.ts` — `PIP_VALUES.standard = 10` and `CRYPTO_CONTRACT_SIZES`

The position sizer uses source #2 (hardcoded constants) while other parts of the system may reference source #1 (instrument specs). This creates a risk of divergent calculations depending on which code path is used.

**Impact:** Any module that uses `getInstrumentSpec(symbol).pipValue` will get different values than the position sizer, leading to inconsistent risk calculations across the system.

---

### C-03: Frontend Signal Table Uses Wrong Field Names for Position Data
**Files:** `public/js/ui.js` (lines 540-556), backend decision object structure  
**Category:** Display Mismatch / Data Flow

The Bloomberg-style signals table in `ui.js` references fields that don't match the backend decision object:
- `d.tieredExits?.tp1?.formatted` — Backend uses `d.exitManagement.tieredExits[0]`, not `d.tieredExits.tp1`
- `d.positionSize?.recommendedLots` — Backend uses `d.position.lots`
- `d.lotSize` — Not a standard field on the decision object
- `d.riskReward` — Backend uses `d.takeProfit.rr` or computes R:R differently

The **card view** (`createDecisionCard`) correctly uses `d.exitManagement?.tieredExits?.[0]` and `d.position?.lots`, but the **table view** uses different field paths.

**Impact:** The Bloomberg-style table (the primary dashboard view) will show dashes (`-`) for lot sizes, TP1/TP2 levels, and R:R ratios even when valid data exists, while the legacy card view shows them correctly. Users relying on the table view will miss critical trade parameters.

---

### C-04: (Reclassified → H-13) See High Severity section.

---

## High Severity Findings

### H-01: Auto-Scan Concurrent Execution Not Guarded Against Race Conditions
**Files:** `src/services/autoScanService.ts`  
**Category:** Data Flow / Edge Cases

The auto-scan service runs on a configurable interval (default 5 minutes). While there is an `isRunning` guard on the scan function, the detection processing and signal storage operations are async and could overlap if a scan takes longer than the interval. Multiple scans writing to the same detection store and signal store simultaneously could produce duplicate entries or inconsistent state.

**Impact:** During periods of high market volatility (when scans take longest), duplicate or inconsistent detections could appear, leading to redundant alerts or missed deduplication.

---

### H-02: Signal Cooldown Uses In-Memory Map — Lost on Server Restart
**Files:** `src/services/signalCooldown.ts` (referenced in strategy analyzer)  
**Category:** Data Integrity

Signal cooldowns (preventing duplicate signals for the same symbol/strategy within a time window) are tracked in an in-memory Map. On server restart, all cooldowns are lost, potentially allowing duplicate signals immediately after restart.

**Impact:** If the server restarts during active trading hours, users could receive duplicate signals for setups that were already signaled before the restart.

---

### H-03: Circuit Breaker State Not Persisted
**Files:** `src/services/circuitBreaker.ts`  
**Category:** Data Integrity / Edge Cases

The circuit breaker tracking external API failures (Twelve Data) uses in-memory state. On restart, a failing API that had tripped the circuit breaker would immediately be retried, potentially causing cascading failures or rapid API quota exhaustion.

**Impact:** Could exhaust Twelve Data API rate limits quickly after restart if the API is experiencing issues.

---

### H-04: Rate Limiter Token Bucket Not Accounting for Burst Recovery
**Files:** `src/services/rateLimiter.ts`  
**Category:** Logic Accuracy

The token bucket rate limiter controls Twelve Data API calls. However, after a period of no requests (e.g., overnight), the bucket refills to maximum capacity. When auto-scan starts the next morning, it could burst the full bucket's worth of requests simultaneously, potentially exceeding the API provider's actual per-second limits even if the per-minute budget is respected.

**Impact:** Could trigger Twelve Data rate limit responses (HTTP 429) at market open, causing scan failures during the most critical trading period.

---

### H-05: Journal P&L Calculation Assumes USD Account Currency
**Files:** `public/js/ui.js` (lines 592-594), `src/db/journalStore.ts`  
**Category:** Logic Accuracy

Journal entries display P&L as `$${e.pnlDollars.toFixed(2)}` and R-multiples as `${e.rMultiple.toFixed(2)}R`. The P&L calculation assumes all profits/losses are in USD. For cross-currency positions (e.g., EUR/GBP traded on a USD account), the P&L conversion to USD requires the current exchange rate of the quote currency vs. USD, which is not performed.

**Impact:** P&L figures for cross-currency trades will be inaccurate. The magnitude of error depends on the quote currency's exchange rate vs. USD.

---

### H-06: Detection Store Expiration Not Coordinated with Signal Freshness
**Files:** `src/db/detectionStore.ts`, `src/engine/strategyAnalyzer.ts`  
**Category:** Data Flow

Detections have a lifecycle (eligible → taken/dismissed/expired/invalidated) but the expiration check uses different time windows than the signal freshness validation. A detection could be marked as "eligible" in the store while the underlying signal has already degraded past its optimal window or expired entirely.

**Impact:** Users could act on "eligible" detections whose underlying signals are stale, leading to suboptimal entry timing.

---

### H-07: No Validation of Twelve Data Response Data Integrity
**Files:** `src/services/twelveDataClient.ts`  
**Category:** Data Integrity

The Twelve Data client validates HTTP response status and basic structure (checks for `values` array), but does not validate:
- Whether OHLC values are within reasonable ranges (e.g., negative prices, zero volumes)
- Whether timestamps are sequential and non-duplicated
- Whether the data gap between bars exceeds expected intervals (e.g., missing weekend data vs. missing weekday data)

**Impact:** Corrupted or anomalous data from the API (e.g., a flash crash spike, data feed error) would propagate through the indicator pipeline unchecked, potentially generating false signals.

---

### H-08: Strategy Analyzer Processes All Strategies Sequentially
**Files:** `src/engine/strategyAnalyzer.ts`, `src/strategies/registry.ts`  
**Category:** Performance / Data Flow

When auto-scan runs with "all strategies" mode, it iterates through all 11 strategies for each symbol sequentially. With 38 active instruments, this is 418 strategy evaluations per scan cycle. Each evaluation requires multiple indicator fetches (potentially cached), but the sequential nature means scan times could exceed the scan interval during high-activity periods.

**Impact:** Scans exceeding the interval window could lead to stale signals or queued scan requests, degrading the timeliness guarantee of the system.

---

### H-09: Grade Mapping Inconsistency Between Confidence Thresholds
**Files:** Various strategy files (`EmaPullback.ts`, `BollingerMR.ts`, `BreakRetest.ts`, etc.)  
**Category:** Logic Accuracy

Different strategies use different minimum confidence thresholds for signal emission:
- `EmaPullback`: Rejects below 50
- `BreakRetest`: Rejects below 55
- `BollingerMR`: Rejects below 50
- Other strategies: Varies

The grading function then maps confidence to grades (A+ ≥ 85, A ≥ 70, B+ ≥ 60, B ≥ 50, C ≥ 40). A strategy rejecting at 55 will never produce a C-grade or low-B signal, while one rejecting at 50 can. This creates uneven grade distributions across strategies.

**Impact:** Strategy comparison by grade is misleading — a B-grade from BreakRetest represents higher confidence (55-59) than a B-grade from EmaPullback (50-59). Users may incorrectly assess relative signal quality across strategies.

---

### H-10: SSE Heartbeat/Reconnection Could Miss Upgrade Events
**Files:** `public/js/app.js` (lines 99-168)  
**Category:** Data Flow

The SSE connection for grade upgrade notifications uses a 45-second heartbeat timeout. If the server's heartbeat interval drifts or network latency increases, the client will close and reconnect. During the reconnection window (up to 60 seconds with exponential backoff), any upgrade events emitted by the server will be lost — there is no event replay or catch-up mechanism.

**Impact:** Users could miss grade upgrade notifications during reconnection windows, potentially missing improved trading opportunities.

---

### H-11: Portfolio Risk Manager Currency Exposure Check Has Limited Coverage
**Files:** `src/engine/strategyAnalyzer.ts` (portfolio risk references)  
**Category:** Logic Accuracy

The portfolio risk manager enforces a maximum of 2% net currency exposure per currency. However, it only considers signals generated in the current scan — it does not account for positions already tracked in the journal (running trades). A user could have a 1.5% EUR exposure from running trades and receive a signal recommending another 1.5% EUR exposure, exceeding the 2% limit.

**Impact:** Currency exposure limits could be exceeded when combining auto-scan signals with manually journaled running trades.

---

### H-12: Account Settings Sync Race Between Client and Server
**Files:** `public/js/app.js` (lines 390-466)  
**Category:** Data Flow

On initialization, the client loads settings from localStorage, then asynchronously syncs from the server (`syncAccountSettingsFromServer`). Between these two operations, the client uses stale local values. If a scan is triggered during this window, it will use the local (potentially outdated) account size and risk percent, not the server-authoritative values.

**Impact:** Position sizes calculated during the sync window could be based on outdated account settings, leading to incorrect lot sizes.

---

### H-13: Entry Price Display Mismatch Between Card and Table Views (formerly C-04)
**Files:** `public/js/ui.js` lines 265-266 vs 552  
**Category:** Display Mismatch

The card view displays entry as: `d.entryZone?.formatted || d.entry?.formatted` (with NEXT_OPEN annotation).  
The table view displays entry as: `d.entry?.formatted` only.

The backend decision object populates `entryZone` for zone-based entries and `entry` for NEXT_OPEN model entries. Depending on which strategy generates the signal, one field may be populated and the other absent.

**Evidence:** `ui.js` line 265: `decision.entryZone?.formatted || (decision.entry?.formatted ? ...)` vs line 552: `d.entry?.formatted || '-'`.

**Impact:** Entry prices may show as `-` in the table view for strategies that populate `entryZone` instead of `entry`. This is a UI display issue that does not affect the underlying signal generation, but could cause users to miss entry information in the primary table view.

---

### H-14: Drawdown Guard Uses File-Based Persistence Without Atomic Writes (formerly C-05)
**Files:** `src/services/drawdownGuard.ts` (lines 103-112)  
**Category:** Data Integrity

The drawdown guard saves state via `writeFileSync(path, JSON.stringify(state))` directly — no temp file + rename pattern. If the process crashes during the write, the state file could be left in a corrupted/truncated state.

**Evidence:** `drawdownGuard.ts` line 109: `writeFileSync(path, JSON.stringify(state, null, 2))` — direct write, no temp file staging.

**Mitigating factors:** (1) The write is synchronous, reducing the crash window; (2) `loadState` catches parse errors and falls back to defaults; (3) the drawdown guard is only checked during scan operations, not continuously. The risk is bounded but non-zero.

**Impact:** A server crash during state save could reset drawdown tracking. The guard's fallback behavior uses current equity as starting point, which provides partial protection. Risk is elevated but not immediately catastrophic since the guard recalculates from available state.

---

## Medium Severity Findings

### M-01: `toFixed(5)` Applied Uniformly Regardless of Instrument Precision
**Files:** `public/js/ui.js` (lines 603-606)  
**Category:** Display Mismatch

The journal table renders all prices with `toFixed(5)`. However:
- JPY pairs use 3 decimal places (e.g., 150.123)
- Crypto like BTC uses 2 decimal places (e.g., 96543.21)
- Metals (XAUUSD) use 2 decimal places

**Impact:** Prices display with trailing zeros or truncated precision depending on the instrument, reducing readability.

---

### M-02: Running Trades Table References `unrealizedPnl` and `currentPrice` — Not Populated
**Files:** `public/js/ui.js` (lines 637-645)  
**Category:** Display Mismatch

The running trades table references `e.unrealizedPnl` and `e.currentPrice` fields. The journal store does not populate these fields — they would require real-time price feeds to calculate. These fields will always be undefined/null.

**Impact:** The "Current Price" and "Unrealized P&L" columns in the running trades panel will always show dashes, making the running trades display informational only (no live tracking).

---

### M-03: Watchlist Best Grade Logic Initializes to 'C' — Incorrect Default
**Files:** `public/js/ui.js` (lines 493-498)  
**Category:** Logic Accuracy

The watchlist sidebar's best-grade detection initializes `bestGrade = 'C'` and then checks if any signal's grade is better (lower index in `gradeOrder`). If a symbol has only A+ signals, this works correctly. But if a symbol has no signals, the `signals` array is empty and the loop doesn't execute, so `bestGrade` remains 'C' — but this path is guarded by `signalCount > 0` before rendering, so the stale default is not displayed.

**Impact:** Minor — no visible effect due to the guard, but the logic is fragile. If the guard is ever removed, symbols with no signals would show a phantom 'C' grade.

---

### M-04: Signal Freshness Display Shows "Detected X ago" But Doesn't Auto-Refresh
**Files:** `public/js/ui.js` (lines 330-339), `public/js/app.js`  
**Category:** Display Mismatch

Signal age display (`decision.timing?.signalAge?.display`) is calculated server-side at scan time and rendered statically. As time passes, the "Detected 2 min ago" label becomes increasingly stale without page refresh. The signal could expire while still showing "Detected 2 min ago".

**Impact:** Users may act on signals whose displayed freshness is misleading. The `validUntil` expiry text does use client-side `new Date()` comparison, so expiry is tracked — but the "Detected X ago" text remains static.

---

### M-05: Scan Estimate Calculation Uses Hardcoded API Call Assumptions
**Files:** `public/js/ui.js` (lines 673-683)  
**Category:** Logic Accuracy

Scan time estimate uses `callsPerSymbol = 8` and `callsPerSecond = 2`. These are hardcoded assumptions that may not reflect reality:
- Different strategies require different numbers of indicator calls (e.g., LiquiditySweep needs SMC-specific indicators beyond the standard set)
- The rate limiter may throttle below 2 calls/second depending on bucket state
- Cached indicators reduce actual API calls significantly

**Impact:** Scan time estimates could be significantly over- or under-estimated, setting incorrect user expectations.

---

### M-06: `formatSignalText` Crashes on No-Trade Signals
**Files:** `public/js/app.js` (lines 852-863)  
**Category:** Edge Cases

`formatSignalText` calls `d.direction.toUpperCase()` without null-checking. For no-trade signals, `direction` is `null`, causing a runtime error. The function is called from `copySignal` which is only rendered for trade signals (grade !== 'no-trade'), so it shouldn't normally be reached for no-trade signals. However, if `findDecisionByKey` returns a different signal due to array mutation (e.g., re-scan while copying), a crash could occur.

**Impact:** Potential runtime error when copying a signal during a concurrent scan operation.

---

### M-07: Detection Filter State Not Persisted Across Page Loads
**Files:** `public/js/app.js`  
**Category:** Edge Cases

Detection status filters (eligible, cooling_down, taken, etc.) are set up in `setupDetectionFilters` but the active filter state is not saved to localStorage. On page refresh, filters reset to defaults, potentially hiding detections the user was actively reviewing.

**Impact:** Minor UX annoyance — users lose their filter context on refresh.

---

### M-08: Auto-Scan Email Alerts Have No Deduplication
**Files:** `src/services/alertService.ts`  
**Category:** Data Flow

The alert service sends email notifications for high-grade signals. If the same signal persists across multiple scan cycles (common for valid setups), the user could receive duplicate email alerts for the same setup. There is no "already alerted" tracking per signal ID.

**Impact:** Users could receive repeated emails for the same trading opportunity, leading to alert fatigue.

---

### M-09: Cache TTL Not Differentiated by Data Type
**Files:** `src/services/cache.ts`  
**Category:** Data Flow

The in-memory TTL cache uses a single TTL configuration. However, different data types have different staleness tolerances:
- H1 bar data: valid for up to 1 hour
- H4 trend data: valid for up to 4 hours
- D1 data: valid for 24 hours
- Indicator calculations: should match their source bar data TTL

Using a uniform TTL means either frequent unnecessary re-fetches (if TTL is short) or stale data usage (if TTL is long).

**Impact:** Either unnecessary API quota consumption or signals based on stale indicator data, depending on the TTL configuration.

---

### M-10: Database Connection Pool Not Explicitly Configured
**Files:** `src/db/client.ts`  
**Category:** Data Flow / Edge Cases

The PostgreSQL client uses default connection pool settings from the `pg` library. Under high load (e.g., large multi-symbol scan with concurrent journal writes), the default pool size (10 connections) could be exhausted, causing query timeouts or connection errors.

**Impact:** Could cause database operation failures during peak scan activity.

---

### M-11: Regime Detector ATR Percentile Calculation Edge Case
**Files:** `src/engine/regimeDetector.ts`  
**Category:** Logic Accuracy

The regime detector classifies volatility using ATR percentiles. If the ATR history window is too short (e.g., during initial data load or for newly listed instruments), the percentile calculation will be based on insufficient samples, potentially misclassifying the regime.

**Impact:** Could lead to incorrect strategy parameter adjustments and risk-reward multipliers for instruments with limited historical data.

---

### M-12: Server.ts Had Active LSP Diagnostic Errors (Intermittent)
**Files:** `src/server.ts`  
**Category:** Code Quality

During audit, the TypeScript language server intermittently reported diagnostic issues in `server.ts`. These appear to be transient type-inference issues that resolve on recompilation. At time of final check, no active diagnostics were present, but the intermittent nature suggests fragile type annotations in the API route handlers.

**Impact:** Low — no active errors at audit conclusion. The intermittent nature suggests type inference edge cases that may resurface during refactoring.

---

### M-13: Drawdown Guard Day-Key Uses Server Timezone
**Files:** `src/services/drawdownGuard.ts`  
**Category:** Logic Accuracy

The `getDayKey()` function uses the server's local timezone to determine the "trading day" boundary for daily drawdown resets. If the server is in UTC but the user trades in ET (Eastern Time), the daily P&L reset happens at midnight UTC (7 PM ET), not at midnight ET or the forex market's daily rollover time (5 PM ET).

**Impact:** Daily drawdown limits could reset at the wrong time, potentially allowing excess risk during late US session trading or incorrectly limiting early-session trades.

---

### M-14: Strategy-Specific Spread Cost Not Deducted from R:R Calculations
**Files:** Various strategy files, `src/config/e8InstrumentSpecs.ts`  
**Category:** Logic Accuracy

Each instrument has an `avgSpread` and `avgSpreadPips` defined in the specs. However, the R:R calculations in the strategies use raw entry-to-TP distances without deducting the spread cost. For instruments with wide spreads (e.g., XRPUSD at 3 pips, or BNBUSD at 150 pips equivalent), the actual achieved R:R will be lower than the displayed R:R.

**Impact:** Displayed R:R ratios overstate the actual risk-reward for instruments with significant spreads, particularly crypto and exotic forex pairs.

---

### M-15: ICT Killzone Session Detection Not Timezone-Aware for User
**Files:** `src/engine/strategyAnalyzer.ts` (killzone references)  
**Category:** Logic Accuracy

ICT Killzone session bonuses (London Open, NY Open, London/NY overlap) are applied based on UTC-referenced times. The user's configured timezone is not factored into the session determination. If the user trades from a different timezone and the server processes signals with UTC timestamps, the killzone bonus could be applied correctly (since forex sessions are absolute), but the user's perception of "current session" may differ from what the system reports.

**Impact:** Minor confusion if the user's timezone display and the killzone session label don't align, though the underlying logic is correct.

---

### M-16: `API.request()` Always Sets Content-Type: application/json — Even for GET Requests
**Files:** `public/js/api.js` (lines 15-19)  
**Category:** Edge Cases

The `API.request()` wrapper sets `Content-Type: application/json` on every request, including GET requests that have no body. While most servers ignore this, it's technically incorrect per HTTP semantics and could cause issues with strict proxy servers or CDN layers.

**Impact:** Unlikely to cause issues in practice, but violates HTTP standards and could break under certain proxy configurations.

---

## Low Severity Findings

### L-01: `localStorage` Used for Scan Results — No Size Limit Handling
**Files:** `public/js/app.js` (line 685)  
**Category:** Edge Cases

Scan results are saved to `localStorage` via `Storage.saveResults(this.results)`. LocalStorage has a ~5MB limit. Large scan results (38 instruments × multiple strategies × verbose decision objects) could approach or exceed this limit, causing a silent write failure.

**Impact:** In extreme cases, scan results may not persist across page refreshes. The user would need to re-scan.

---

### L-02: `selectCategory` Allows Partial Selection Without User Feedback
**Files:** `public/js/app.js` (lines 587-609)  
**Category:** Edge Cases

When selecting all symbols in a category, if the 20-symbol limit is reached mid-category, a toast says "Maximum 20 symbols reached" but some symbols in the category are selected and others are not. There's no indication of which symbols were added and which were skipped.

**Impact:** Minor UX confusion — user may not know which symbols were included when hitting the limit.

---

### L-03: Health Check Only Validates API Key Presence, Not Validity
**Files:** `public/js/app.js` (lines 922-931)  
**Category:** Edge Cases

The health check tests `health.apiKeyConfigured` but doesn't validate that the key is actually valid (i.e., can make successful API calls). A misconfigured or expired key would show as "configured" but fail on actual use.

**Impact:** User may think the system is ready when the API key is actually invalid, leading to scan failures.

---

### L-04: Sentiment Cache in Frontend Is Per-Session Only
**Files:** `public/js/app.js` (line 937)  
**Category:** Edge Cases

The sentiment cache (`this.sentimentCache = {}`) is in-memory only. On page refresh, all cached sentiment data is lost and must be re-fetched. Given that sentiment analysis uses the Grok API (which has rate limits and costs), this could lead to unnecessary API calls.

**Impact:** Slightly increased API costs and latency after page refreshes.

---

### L-05: Toast Duration Logic Inconsistency
**Files:** `public/js/ui.js` (lines 83, 98-100)  
**Category:** Code Quality

Error toasts (`type === 'error'`) always get close buttons (line 83), but also auto-dismiss after `duration` (default 3000ms). If an error toast uses the default duration, it auto-dismisses in 3 seconds — the close button provides little value. Only error toasts with `duration > 3000` or `duration === 0` benefit from the close button.

**Impact:** Cosmetic — close button on 3-second error toasts is functionally useless.

---

### L-06: `createDecisionCard` XSS Vector in Reason Codes
**Files:** `public/js/ui.js` (lines 244-248)  
**Category:** Security

Reason codes are rendered as `${code.replace(/_/g, ' ')}` within HTML without escaping. While reason codes are generated server-side from a controlled set, if a reason code ever contained HTML characters (e.g., from a malformed strategy), it could inject HTML.

**Impact:** Very low risk given server-side generation, but defense-in-depth suggests escaping HTML entities.

---

### L-07: `inferTradeType` Map Incomplete
**Files:** `public/js/app.js` (lines 23-37)  
**Category:** Logic Accuracy

The `inferTradeType` function maps strategy IDs to trade types. If new strategies are added without updating this map, they default to `'other'`. Currently, all 11 strategies are mapped. This is a maintenance concern rather than a current bug.

**Impact:** None currently. Future risk if strategies are added without updating the map.

---

### L-08: Journal Table `toFixed(5)` Called on Potentially Null Values
**Files:** `public/js/ui.js` (lines 603-606)  
**Category:** Edge Cases

The journal table uses `e.entryPrice?.toFixed(5)` which uses optional chaining correctly. However, if `entryPrice` is `0` (a falsy but valid number), the optional chaining still works because `0?.toFixed(5)` returns `"0.00000"`. No issue, but the `|| '-'` fallback would trigger if `toFixed` returned an empty string, which it never does.

**Impact:** None — the code is correct. Included for completeness.

---

### L-09: Multiple Button Loading State References Inconsistent IDs
**Files:** `public/js/app.js` (various)  
**Category:** Code Quality

Several button references use `UI.$('scan-btn')`, `UI.$('refresh-btn')`, `UI.$('export-btn')`, etc. If any of these IDs are missing from the HTML (e.g., due to the dashboard layout not including legacy elements), the `UI.setButtonLoading` calls silently fail (null-safe). This is handled correctly but creates invisible dead code paths.

**Impact:** None functionally — null-safe handling works. Minor code cleanliness issue.

---

### L-10: Search Function Only Searches Symbol Names, Not Display Names
**Files:** `public/js/app.js` (lines 623-631)  
**Category:** Edge Cases

`searchSymbols` searches by `item.dataset.symbol` (e.g., "EURUSD") but not by display name (e.g., "Euro / US Dollar"). Users searching for "Euro" or "Bitcoin" won't find results.

**Impact:** Minor UX limitation — users must know the ticker symbol to search.

---

### L-11: Crypto Pip Size and Spread Values May Diverge from Exchange Reality
**Files:** `src/config/e8InstrumentSpecs.ts`  
**Category:** Data Integrity

Crypto instrument specs have fixed `avgSpread` values (e.g., BTCUSD: 12, ETHUSD: 0.59). Crypto spreads are highly variable and can widen dramatically during volatility events. Using fixed average spreads for cost calculations during volatile periods underestimates trading costs.

**Impact:** Position sizing and R:R calculations for crypto may be slightly optimistic during high-volatility periods.

---

### L-12: Disabled Instruments Still Present in Config
**Files:** `src/config/e8InstrumentSpecs.ts`  
**Category:** Code Quality

Four index instruments (US30, US100, US500, DE40) and two commodities (WTIUSD, BRENTUSD) are defined with `disabled: true`. These entries consume memory and are filtered at runtime. They should either be removed entirely or separated into a distinct "planned instruments" configuration.

**Impact:** Negligible memory and processing overhead. Maintenance concern only.

---

## Category Breakdown

### Data Integrity (7 findings)
| ID | Severity | Summary |
|----|----------|---------|
| C-01 | Critical | Pip value hardcoded to $10 for all forex pairs |
| C-02 | Critical | Dual pip value sources create inconsistency |
| H-14 | High | Drawdown guard non-atomic file writes |
| H-02 | High | Signal cooldown lost on restart |
| H-03 | High | Circuit breaker state not persisted |
| H-07 | High | No Twelve Data response data validation |
| L-11 | Low | Fixed crypto spreads diverge from reality |

### Logic Accuracy (10 findings)
| ID | Severity | Summary |
|----|----------|---------|
| H-05 | High | Journal P&L assumes USD account currency |
| H-09 | High | Grade mapping inconsistency across strategies |
| H-11 | High | Portfolio risk manager ignores running trades |
| M-03 | Medium | Watchlist best grade logic fragile default |
| M-05 | Medium | Scan estimate uses hardcoded assumptions |
| M-11 | Medium | Regime detector ATR percentile edge case |
| M-13 | Medium | Drawdown guard uses server timezone |
| M-14 | Medium | Spread cost not deducted from R:R |
| M-15 | Medium | Killzone session not user-timezone-aware |
| L-07 | Low | inferTradeType map incomplete (future risk) |

### Display Mismatches (5 findings)
| ID | Severity | Summary |
|----|----------|---------|
| C-03 | Critical | Signal table uses wrong field names for position/exit data |
| H-13 | High | Entry price mismatch between card and table views |
| M-01 | Medium | Uniform toFixed(5) regardless of instrument precision |
| M-02 | Medium | Running trades references unpopulated fields |
| M-04 | Medium | Signal freshness display doesn't auto-refresh |

### Data Flow (8 findings)
| ID | Severity | Summary |
|----|----------|---------|
| H-01 | High | Auto-scan concurrent execution race conditions |
| H-06 | High | Detection expiration vs signal freshness gap |
| H-08 | High | Sequential strategy processing bottleneck |
| H-10 | High | SSE reconnection misses upgrade events |
| H-12 | High | Account settings sync race condition |
| M-08 | Medium | Email alerts have no deduplication |
| M-09 | Medium | Cache TTL not differentiated by data type |
| M-10 | Medium | Database connection pool not configured |

### Edge Cases (9 findings)
| ID | Severity | Summary |
|----|----------|---------|
| H-04 | High | Rate limiter burst after idle period |
| M-06 | Medium | formatSignalText crashes on no-trade signals |
| M-07 | Medium | Detection filters not persisted across page loads |
| M-16 | Medium | Content-Type: application/json on GET requests |
| L-01 | Low | localStorage size limit not handled |
| L-02 | Low | Partial category selection without user feedback |
| L-03 | Low | Health check doesn't validate API key validity |
| L-08 | Low | toFixed on potentially null values (non-issue, defensive) |
| L-10 | Low | Search only matches symbol codes, not names |

### Code Quality / Security (6 findings)
| ID | Severity | Summary |
|----|----------|---------|
| M-12 | Medium | Intermittent LSP diagnostic errors in server.ts |
| L-04 | Low | Sentiment cache per-session only |
| L-05 | Low | Toast duration/close button inconsistency |
| L-06 | Low | XSS vector in reason codes (very low risk) |
| L-09 | Low | Dead code paths for missing button IDs |
| L-12 | Low | Disabled instruments still in config |

---

## File-Level Findings Index

| File | Findings |
|------|----------|
| `src/config/defaults.ts` | C-01, C-02 |
| `src/config/e8InstrumentSpecs.ts` | C-02, M-14, L-11, L-12 |
| `src/engine/positionSizer.ts` | C-01, C-02 |
| `src/engine/strategyAnalyzer.ts` | H-08, H-09, H-11, M-15 |
| `src/engine/regimeDetector.ts` | M-11 |
| `src/strategies/intraday/*.ts` | H-09, M-14 |
| `src/services/autoScanService.ts` | H-01 |
| `src/services/alertService.ts` | M-08 |
| `src/services/drawdownGuard.ts` | H-14, M-13 |
| `src/services/signalCooldown.ts` | H-02 |
| `src/services/circuitBreaker.ts` | H-03 |
| `src/services/rateLimiter.ts` | H-04 |
| `src/services/cache.ts` | M-09 |
| `src/services/twelveDataClient.ts` | H-07 |
| `src/db/client.ts` | M-10 |
| `src/db/detectionStore.ts` | H-06 |
| `src/db/journalStore.ts` | H-05 |
| `src/server.ts` | M-12 |
| `public/js/app.js` | H-10, H-12, M-06, M-07, L-01, L-02, L-03, L-04, L-07, L-10 |
| `public/js/ui.js` | C-03, H-13, M-01, M-02, M-03, M-04, M-05, L-05, L-06, L-08 |
| `public/js/api.js` | M-16 |

---

## Recommendations

### Immediate (Before Live Trading)
1. **Fix pip value calculation** (C-01, C-02): Use the per-instrument `pipValue` from `e8InstrumentSpecs.ts` in the position sizer instead of the hardcoded `PIP_VALUES.standard` constant. This directly affects lot sizing accuracy for 15+ non-USD-quoted pairs.
2. **Align frontend table field names** (C-03, H-13): Update the Bloomberg-style signals table in `ui.js` to use the same field paths as the card view — specifically `d.exitManagement?.tieredExits?.[0]` for TP1, `d.position?.lots` for lot size, and `d.entryZone?.formatted || d.entry?.formatted` for entry price.
3. **Deduct spread from R:R** (M-14): Incorporate `avgSpreadPips` from instrument specs into take-profit distance calculations to avoid overstating actual R:R.

### Short-Term (Next Sprint)
4. **Add atomic writes to drawdown guard** (H-14): Use temp file + rename pattern for state persistence to prevent corruption on crash.
5. **Persist signal cooldowns and circuit breaker state** (H-02, H-03): Use database or file persistence for critical service state that should survive restarts.
6. **Add Twelve Data response validation** (H-07): Validate OHLC ranges, timestamp sequencing, and data completeness before processing.
7. **Guard auto-scan against race conditions** (H-01): Ensure async detection/storage operations complete before the next scan cycle starts.
8. **Coordinate detection expiration with signal freshness** (H-06): Synchronize detection lifecycle timers with signal validity windows.
9. **Configure database pool size** (M-10): Set explicit pool limits based on expected concurrent operations.
10. **Differentiate cache TTL by data type** (M-09): Use tiered TTLs matching source data refresh intervals (H1, H4, D1).

### Medium-Term (Planned Improvements)
11. **Add cross-currency P&L conversion** (H-05): Use live FX rates for journal P&L when quote currency is not USD.
12. **Normalize confidence thresholds across strategies** (H-09): Establish consistent minimum confidence floors so grades are comparable across strategies.
13. **Integrate running trades into portfolio risk checks** (H-11): Query journal store for running trades during currency exposure calculation.
14. **Add SSE event replay** (H-10): Implement event ID tracking for catch-up after reconnection gaps.
15. **Use forex rollover time for drawdown day boundary** (M-13): Align daily reset with 5 PM ET (standard forex rollover) instead of server-local midnight.

---

*End of Audit Report*

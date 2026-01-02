# Forex Decision Engine

## Overview
A trading decision engine for Forex, Metals, and Cryptocurrency markets, designed to generate actionable trade signals. It provides clear entry zones, stop losses, and take profit targets. The system employs a deterministic strategy combining trend analysis (EMA 200, ADX) with entry triggers (EMA 20/50 pullbacks, RSI resets) to produce graded trade recommendations (A+/B grades). It is specifically built for prop firm trading, incorporating E8 Markets risk management rules and position sizing.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes (2026-01-02)
**V1.1 Emergency Patches - Three-Way Audit Fixes**
- CRITICAL: Fixed crypto contract sizes preventing 100,000x position sizing error (BTCUSD: 1→2, ETHUSD: 1→20, XRPUSD: 1→100000)
- Created `drawdownGuard.ts`: E8 Markets compliance (4% daily, 6% total limits) with persistent state
- Server route lockdown: `/api/analyze` disabled (410 Gone), `/api/scan` requires strategyId
- Hard-fail indicator validation: Array mismatches now block trades (was just warning)
- Increased data lookback: outputsize 100→300, EMA200 strategies require 250 bars (was 50)
- Added timeframes metadata to 6 strategies missing it
- Fixed frontend sentiment bugs (app.js data.sentiment→data.rating, ui.js dead code removed)
- Fixed strategyAnalyzer.ts missing entry field in createNoTradeDecision
- Updated signalStore.ts to use new Decision type from strategies/types.js

## Previous Changes (2026-01-01)
**Auto-Scan & Signal Freshness**
- Added Auto-Scan feature: Background scanner runs every 5 minutes using batch API
- Signal Freshness Tracking: Shows "Detected Xh Ym ago" timestamps to prevent late entries
- Auto-Scan UI toggle in Watchlist panel with email config, min grade filter, status display
- New services: `batchDataService.ts` (Twelve Data /batch endpoint), `autoScanService.ts`, `alertService.ts`
- New API endpoints: POST /api/autoscan/start, /stop, GET /api/autoscan/status, PUT /api/autoscan/config
- Signal freshness tracker: `signalFreshnessTracker.ts` with SYMBOL::STRATEGY::DIRECTION key format
- Time utilities: `timeUtils.ts` with formatSignalAge(), isStale() (4hr threshold), formatEntryPrice()
- Decision interface extended with `entry: { price, formatted }` and `timing: { firstDetected, signalAge, validUntil, isStale }`
- Email alerts via Resend (optional - requires RESEND_API_KEY secret)

**Grok AI Sentiment Analysis (On-Demand)**
- Added grokSentimentService.ts: xAI Grok-3 API integration for X/Twitter market sentiment
- On-demand "Get Sentiment" button on trade cards - user controls API usage
- Frontend caching (5-min TTL) to prevent duplicate API calls per session
- Sentiment displayed as colored badges: bullish (green), bearish (red), neutral (gray), mixed (amber)
- API endpoints: GET /api/sentiment/:symbol, POST /api/sentiment/batch, GET /api/sentiment/status
- Requires XAI_API_KEY secret for X/Twitter sentiment analysis

**Frontend UI Update - Multi-Asset Class Support**
- Added Metals (2), Indices (6), and Commodities (2) sections to watchlist panel
- Strategy dropdown now dynamically loads all 9 strategies from API
- Updated `app.js`: universe state, loadUniverse(), selectCategory() for 5 asset classes
- Added click event handlers for metals-symbols, indices-symbols, commodities-symbols grids
- Total: 46 instruments across 5 asset classes now visible in UI

**H4 Trend Support + RsiOversold Strategy**
- TRUE H4 timeframe support via native Twelve Data 4h interval with D1 fallback
- New `RsiOversold` strategy: with-trend pullback using H4 EMA200+ADX>20, 3-bar RSI lookback, swing-based stops
- Two-seatbelt safety: SEATBELT 1 (fail-fast H4 validation), SEATBELT 2 (separate trendIdx for H4 vs signalIdx for H1)
- Added `fetchTrendDataH4()` with D1 fallback logging (`TREND_FALLBACK_D1_USED`)
- Added `validateH4Alignment()` with NaN padding for H4 data integrity
- Added H4 fields to types.ts: `trendBarsH4`, `ema200H4`, `adxH4`, `trendTimeframeUsed`, `trendFallbackUsed`
- Added `CANDLE_CONFIRMATION` to ReasonCode for candle pattern confirmation
- Removed metals daily-only restriction - all asset classes now use unified 1h entry interval
- RsiBounce bug fixes: timeframes metadata (H1/H1), type cast safety, NaN-safe gating, RR threshold 1.5→1.25
- Updated `strategyAnalyzer.ts` to pass H4 data through `convertToStrategyIndicatorData`
- Now 9 intraday strategies registered (added rsi-oversold with 62% win rate, 2.0 R:R)
- API budget: ~26 calls/symbol (added 3 H4 calls), full scan 46 symbols = ~1,196 calls

**E8 Instrument Specs Migration (Earlier 2026-01-01)**
- Created `e8InstrumentSpecs.ts` as single source of truth for all 46 instruments
- Full E8 Markets spec compliance: contract sizes, commission models, pip values, leverage
- Updated rate limiter for Twelve Data $99 plan: 610 calls/min (60 tokens, 10/sec refill, 100ms min delay)
- Fail-fast symbol conversion via `toDataSymbol()` - no heuristic fallbacks

**Previous Changes (2025-12-31)**
- Migrated from Alpha Vantage + KuCoin to Twelve Data as unified data source
- Added new indicators: EMA8, EMA21, EMA55, MACD, OBV
- Implemented NaN padding for indicator array alignment
- Tripwires added to deprecated Alpha Vantage, KuCoin, and Crypto Indicator Service files

## System Architecture

### UI/UX Decisions
-   **Frontend**: Vanilla JavaScript served statically from `public/`.
-   **Design**: Mobile-first approach with a dark theme CSS and 44px touch targets.
-   **Interaction**: `isScanning` guard prevents duplicate scan requests. Error messages display an "ERROR" badge for API failures.
-   **Notifications**: Real-time notifications for grade upgrades via SSE, with auto-dismissal and distinct styling for different upgrade types.

### Technical Implementations

#### Backend (Express + TypeScript)
-   **Framework**: Express.js with TypeScript and ES modules.
-   **Entry Point**: `src/server.ts` handles REST API endpoints for analysis.
-   **Build**: `tsx` for development, `tsc` for production.

#### Decision Engine (`src/engine/`)
Orchestrates trade signal generation:
-   **Indicator Factory & Services**: Unified routing - all symbols (forex/metals/crypto) go through `indicatorService.ts` which uses Twelve Data API exclusively.
-   **Trend Filter**: Determines higher timeframe trend using EMA 200 + ADX.
-   **Entry Trigger**: Detects pullbacks to EMA 20/50 zones with RSI confirmation.
-   **Position Sizer**: Calculates risk-based lot sizing adhering to prop firm constraints.
-   **Grader**: Scores confluence, assigning A+/B/C/no-trade grades.
-   **Strategy Analyzer**: Routes to multiple intraday strategies with NaN padding for indicator alignment.
-   **Safety Gates**: Incorporates volatility gating and signal cooldown mechanisms.
-   **Grade Tracker**: Monitors and detects signal grade improvements or direction flips.
-   **Startup Validation**: `startupValidation.ts` tests EUR/USD, BTC/USD, XAU/USD on startup.

#### Configuration (`src/config/`)
-   **E8 Instrument Specs** (`e8InstrumentSpecs.ts`): SINGLE SOURCE OF TRUTH for all 46 instruments with E8 Markets contract sizes, commission models (fixed USD per lot for forex/metals/indices, 0.035% each way for crypto), pip values, leverage settings.
-   **Strategy Parameters**: Fixed, not user-configurable.
-   **Defaults**: E8 Markets prop firm rules (0.5% risk, 4% daily loss limit, 6% max drawdown).
-   **Universe** (`universe.ts`): DEPRECATED - tripwired to throw error on import.

#### Services (`src/services/`)
-   **Twelve Data Client**: Unified API wrapper for all asset classes with retry logic, fail-fast symbol normalization via `toDataSymbol()`, and crypto exchange handling.
-   **Cache**: In-memory TTL cache for market data and decisions, with separate TTLs for different timeframes and "no-trade" decisions.
-   **Rate Limiter**: Token bucket algorithm for Twelve Data $99 plan (610 calls/min). Config: 60 tokens max, 10 refill/sec, 100ms min delay, 200 max queue (throws FATAL on overflow).
-   **Signal Cooldown**: Prevents duplicate signals based on grade or direction.
-   **Volatility Gate**: Filters signals during extreme ATR conditions.
-   **Logger**: Structured logging with various levels.

#### Deprecated Services (Tripwired)
-   **Alpha Vantage Client** (`alphaVantageClient.ts`): DISABLED - throws error if imported.
-   **KuCoin Client** (`kucoinClient.ts`): DISABLED - throws error if imported.
-   **Crypto Indicator Service** (`cryptoIndicatorService.ts`): DISABLED - throws error if imported.
-   **Universe** (`universe.ts`): DISABLED - throws error if imported (use `e8InstrumentSpecs.ts`).

#### Storage (`src/storage/`)
-   **Signal Store**: In-memory storage with JSON file persistence (`data/signals.json`), using atomic writes.
-   **Journal Store**: Manages trade journal entries with CRUD operations and P&L calculation, stored in `data/journal.json`.

### API Endpoints
-   `GET /api/health`: System health check.
-   `GET /api/universe`: Available trading symbols.
-   `GET /api/status`: Cache and rate limiter status.
-   `POST /api/analyze`: Analyze a single symbol.
-   `POST /api/scan`: Scan multiple symbols, accepting a `strategyId` parameter.
-   `GET /api/signals`: Retrieve signal history.
-   `PUT /api/signals/:id`: Update signal results.
-   `GET /api/strategies`: List available strategies.
-   `GET /api/journal`: Access trade journal data.
-   `POST /api/journal`: Create a new journal entry.
-   `PUT /api/journal/:id`: Update a journal entry.
-   `DELETE /api/journal/:id`: Delete a journal entry.
-   `GET /api/journal/stats`: Retrieve journal statistics.
-   `GET /api/journal/export`: Export journal data as CSV.
-   `GET /api/upgrades/stream`: Server-Sent Events for real-time grade upgrade notifications.
-   `GET /api/upgrades/recent`: Recently detected grade upgrades.

### Feature Specifications
-   **Multi-Strategy System**: Implements 9 intraday strategies, each with defined win rates and specific indicators (RSI Bounce H1-only, RSI Oversold H4-trend, Stochastic Oversold, Bollinger Mean Reversion, Williams %R + EMA, Triple EMA Crossover, Break & Retest, CCI Zero-Line, EMA Pullback).
-   **Confidence Scoring**: Decisions are assigned a 0-100 confidence score, mapped to A+, A, B+, B, C grades.
-   **Reason Codes**: Machine-readable codes explain the rationale behind trade decisions.
-   **Journaling**: Comprehensive trade journaling with P&L calculation, stats tracking, and quick trade action buttons in the frontend.
-   **Strategy Isolation**: Caching of decisions is isolated per strategy to prevent stale data when switching.
-   **Margin-Aware Position Sizing**: Accounts for leverage and margin constraints, especially for crypto assets.
-   **Indicator Alignment**: NaN padding ensures all indicator arrays match bars.length, preventing silent index drift bugs.

## External Dependencies

### Twelve Data API (Primary)
-   **Purpose**: Unified market data and technical indicators for all asset classes (Forex, Metals, Indices, Commodities, Crypto).
-   **Configuration**: `TWELVE_DATA_API_KEY` environment variable (required).
-   **Crypto Exchange**: `TWELVE_DATA_CRYPTO_EXCHANGE` (default: Binance).
-   **Rate Limit**: $99 plan = 610 calls/min. Implements retry with exponential backoff.
-   **Endpoints Used**: /time_series, /ema, /sma, /rsi, /atr, /adx, /stoch, /willr, /cci, /bbands, /macd, /obv.
-   **Symbol Normalization**: Fail-fast via `toDataSymbol()` from e8InstrumentSpecs - throws error for unknown symbols.

### Environment Variables
-   `TWELVE_DATA_API_KEY`: API key for Twelve Data (required).
-   `TWELVE_DATA_CRYPTO_EXCHANGE`: Crypto exchange for consistency (default: Binance).
-   `PORT`: Server port (default: 5000).
-   `LOG_LEVEL`: Logging verbosity (debug/info/warn/error, default: info).
-   `RESEND_API_KEY`: (Optional) API key for Resend email service. If configured, enables email alerts for new trade signals via Auto-Scan feature. Get your key at https://resend.com.
-   `XAI_API_KEY`: (Optional) API key for xAI Grok. If configured, enables real-time X/Twitter sentiment analysis for trading pairs. Get your key at https://x.ai.

### NPM Dependencies
-   **Runtime**: `express`, `cors`, `dotenv`.
-   **Development**: `typescript`, `tsx`, `@types/*` packages.

# Forex Decision Engine

## Overview
A trading decision engine for Forex, Metals, and Cryptocurrency markets, designed to generate actionable trade signals. It provides clear entry zones, stop losses, and take profit targets. The system employs a deterministic strategy combining trend analysis (EMA 200, ADX) with entry triggers (EMA 20/50 pullbacks, RSI resets) to produce graded trade recommendations (A+/B grades). It is specifically built for prop firm trading, incorporating E8 Markets risk management rules and position sizing.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes (2026-01-01)
**E8 Instrument Specs Migration Complete + Verification**
- Created `e8InstrumentSpecs.ts` as single source of truth for all 46 instruments
- Full E8 Markets spec compliance: contract sizes, commission models, pip values, leverage
- Updated rate limiter for Twelve Data $99 plan: 610 calls/min (60 tokens, 10/sec refill, 100ms min delay)
- Added queue overflow protection (200 max, throws FATAL error on overflow)
- Fail-fast symbol conversion via `toDataSymbol()` - no heuristic fallbacks
- Tripwired deprecated `universe.ts` (throws error at module load)
- API v2 `/api/universe` with backward-compatible legacy format plus full instrument specs
- Startup validation checks: duplicate symbols, pipValue > 0, commission model exists
- **Position sizing guard**: Added `Number.isFinite()` check in `calculatePositionSize()` - returns null for invalid/negative lot sizes
- **Smoke tests verified**: EURUSD (A+), BTCUSD (no-trade), FAKESYM (fail-fast rejection)

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
-   **Multi-Strategy System**: Implements 8 intraday strategies, each with defined win rates and specific indicators (e.g., RSI Oversold Bounce, Stochastic Oversold, Bollinger Mean Reversion, Triple EMA Crossover).
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

### NPM Dependencies
-   **Runtime**: `express`, `cors`, `dotenv`.
-   **Development**: `typescript`, `tsx`, `@types/*` packages.

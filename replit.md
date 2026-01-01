# Forex Decision Engine

## Overview
A trading decision engine for Forex, Metals, and Cryptocurrency markets, designed to generate actionable trade signals. It provides clear entry zones, stop losses, and take profit targets. The system employs a deterministic strategy combining trend analysis (EMA 200, ADX) with entry triggers (EMA 20/50 pullbacks, RSI resets) to produce graded trade recommendations (A+/B grades). It is specifically built for prop firm trading, incorporating E8 Markets risk management rules and position sizing.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes (2025-12-31)
**Twelve Data Migration Complete**
- Migrated from Alpha Vantage + KuCoin to Twelve Data as the unified data source
- All asset classes (forex, metals, crypto) now use the same indicator service
- Added new indicators: EMA8, EMA21, EMA55, MACD, OBV
- Implemented NaN padding for indicator array alignment (prevents silent index drift bugs)
- Added startup validation for data pipeline integrity
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
-   **Strategy Parameters**: Fixed, not user-configurable.
-   **Universe**: Predefined list of 28 Forex pairs, 2 Metals (XAUUSD, XAGUSD), and 8 Crypto pairs with metadata.
-   **Defaults**: E8 Markets prop firm rules (0.5% risk, 4% daily loss limit, 6% max drawdown), including specific leverage settings for different asset classes and crypto contract sizes.

#### Services (`src/services/`)
-   **Twelve Data Client**: Unified API wrapper for all asset classes with retry logic, symbol normalization, and crypto exchange handling.
-   **Cache**: In-memory TTL cache for market data and decisions, with separate TTLs for different timeframes and "no-trade" decisions.
-   **Rate Limiter**: Token bucket algorithm for API calls.
-   **Signal Cooldown**: Prevents duplicate signals based on grade or direction.
-   **Volatility Gate**: Filters signals during extreme ATR conditions.
-   **Logger**: Structured logging with various levels.

#### Deprecated Services (Tripwired)
-   **Alpha Vantage Client** (`alphaVantageClient.ts`): DISABLED - throws error if imported.
-   **KuCoin Client** (`kucoinClient.ts`): DISABLED - throws error if imported.
-   **Crypto Indicator Service** (`cryptoIndicatorService.ts`): DISABLED - throws error if imported.

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
-   **Purpose**: Unified market data and technical indicators for all asset classes (Forex, Metals, Crypto).
-   **Configuration**: `TWELVE_DATA_API_KEY` environment variable (required).
-   **Crypto Exchange**: `TWELVE_DATA_CRYPTO_EXCHANGE` (default: Binance).
-   **Rate Limit**: Varies by plan, implements retry with exponential backoff.
-   **Endpoints Used**: /time_series, /ema, /sma, /rsi, /atr, /adx, /stoch, /willr, /cci, /bbands, /macd, /obv.
-   **Symbol Normalization**: EURUSD → EUR/USD, BTCUSD → BTC/USD internally.

### Environment Variables
-   `TWELVE_DATA_API_KEY`: API key for Twelve Data (required).
-   `TWELVE_DATA_CRYPTO_EXCHANGE`: Crypto exchange for consistency (default: Binance).
-   `PORT`: Server port (default: 5000).
-   `LOG_LEVEL`: Logging verbosity (debug/info/warn/error, default: info).

### NPM Dependencies
-   **Runtime**: `express`, `cors`, `dotenv`.
-   **Development**: `typescript`, `tsx`, `@types/*` packages.

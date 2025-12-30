# Forex Decision Engine

## Overview
A trading decision engine for Forex, Metals, and Cryptocurrency markets, designed to generate actionable trade signals. It provides clear entry zones, stop losses, and take profit targets. The system employs a deterministic strategy combining trend analysis (EMA 200, ADX) with entry triggers (EMA 20/50 pullbacks, RSI resets) to produce graded trade recommendations (A+/B grades). It is specifically built for prop firm trading, incorporating E8 Markets risk management rules and position sizing.

## User Preferences
Preferred communication style: Simple, everyday language.

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
-   **Indicator Factory & Services**: Routes and fetches OHLCV and technical indicators from Alpha Vantage (Forex/Metals) or computes them locally (Crypto).
-   **Trend Filter**: Determines higher timeframe trend using EMA 200 + ADX.
-   **Entry Trigger**: Detects pullbacks to EMA 20/50 zones with RSI confirmation.
-   **Position Sizer**: Calculates risk-based lot sizing adhering to prop firm constraints.
-   **Grader**: Scores confluence, assigning A+/B/C/no-trade grades.
-   **Strategy Analyzer**: Routes to multiple intraday strategies (e.g., RSI Oversold Bounce, Bollinger Mean Reversion, EMA Pullback).
-   **Safety Gates**: Incorporates volatility gating and signal cooldown mechanisms.
-   **Grade Tracker**: Monitors and detects signal grade improvements or direction flips.

#### Configuration (`src/config/`)
-   **Strategy Parameters**: Fixed, not user-configurable.
-   **Universe**: Predefined list of 28 Forex pairs, 2 Metals (XAUUSD, XAGUSD), and 8 Crypto pairs with metadata.
-   **Defaults**: E8 Markets prop firm rules (0.5% risk, 4% daily loss limit, 6% max drawdown), including specific leverage settings for different asset classes and crypto contract sizes.

#### Services (`src/services/`)
-   **Alpha Vantage Client**: API wrapper with caching and rate limiting.
-   **Cache**: In-memory TTL cache for market data and decisions, with separate TTLs for different timeframes and "no-trade" decisions.
-   **Rate Limiter**: Token bucket algorithm for API calls.
-   **Signal Cooldown**: Prevents duplicate signals based on grade or direction.
-   **Volatility Gate**: Filters signals during extreme ATR conditions.
-   **Logger**: Structured logging with various levels.

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

## External Dependencies

### Alpha Vantage API
-   **Purpose**: Market data and technical indicators for Forex, Metals, and most Cryptocurrencies.
-   **Configuration**: `ALPHAVANTAGE_API_KEY` environment variable.
-   **Rate Limit**: 150 calls/minute (Premium tier for Forex/Crypto).
-   **Endpoints Used**: FX_INTRADAY, CRYPTO_INTRADAY, TIME_SERIES_DAILY, EMA, RSI, ADX, ATR, STOCH, WILLR, CCI, BBANDS, SMA.

### KuCoin API
-   **Purpose**: Fallback OHLCV data for BNBUSD and BCHUSD, which are not fully supported by Alpha Vantage.
-   **Configuration**: No API key required.
-   **Symbol Mapping**: BNBUSD → BNB-USDT, BCHUSD → BCH-USDT.
-   **Rate Limit**: 100 requests per 10 seconds.

### Environment Variables
-   `ALPHAVANTAGE_API_KEY`: API key for market data (required).
-   `PORT`: Server port (default: 3000).
-   `LOG_LEVEL`: Logging verbosity (debug/info/warn/error, default: info).

### NPM Dependencies
-   **Runtime**: `express`, `cors`, `dotenv`.
-   **Development**: `typescript`, `tsx`, `@types/*` packages.
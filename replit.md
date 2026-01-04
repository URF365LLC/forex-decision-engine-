# Forex Decision Engine

## Overview
The Forex Decision Engine is a trading signal generator for Forex, Metals, and Cryptocurrency markets. Its primary purpose is to provide actionable trade signals, including entry zones, stop losses, and take profit targets, based on a deterministic strategy combining trend analysis (EMA 200, ADX) with entry triggers (EMA 20/50 pullbacks, RSI resets). The system produces graded trade recommendations (A+/B grades) and is specifically tailored for prop firm trading, incorporating E8 Markets risk management rules, position sizing, and drawdown guards. It features multi-strategy scanning, real-time signal freshness tracking, and integrates market sentiment analysis.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend is built with Vanilla JavaScript, served statically, and follows a mobile-first dark theme design with accessible touch targets. It includes an `isScanning` guard to prevent duplicate requests, displays API errors with an "ERROR" badge, and provides real-time notifications for grade upgrades via Server-Sent Events (SSE).

### Technical Implementations

#### Backend (Express + TypeScript)
The backend uses Express.js with TypeScript and ES modules, with `src/server.ts` as the entry point for REST API endpoints. `tsx` is used for development and `tsc` for production builds.

#### Decision Engine (`src/engine/`)
This module orchestrates trade signal generation, including:
-   **Indicator Factory & Services**: Uses `indicatorService.ts` as a unified routing for all asset classes via the Twelve Data API.
-   **Trend Filter**: Determines higher timeframe trends using EMA 200 and ADX.
-   **Entry Trigger**: Detects pullbacks with RSI confirmation.
-   **Position Sizer**: Calculates risk-based lot sizing aligned with prop firm constraints.
-   **Grader**: Assigns confidence scores (A+/B/C/no-trade) based on confluence.
-   **Strategy Analyzer**: Routes to 9 distinct intraday strategies (e.g., RSI Bounce, Bollinger Mean Reversion, Triple EMA Crossover), ensuring NaN padding for indicator alignment.
-   **Safety Gates**: Incorporates volatility gating and signal cooldown.
-   **Grade Tracker**: Monitors signal grade improvements and direction changes.
-   **Startup Validation**: Tests key symbols (EUR/USD, BTC/USD, XAU/USD) on startup.

#### Configuration (`src/config/`)
-   **E8 Instrument Specs** (`e8InstrumentSpecs.ts`): Acts as the single source of truth for 46 instruments, detailing E8 Markets contract sizes, commission models, pip values, and leverage.
-   **Strategy Parameters**: Fixed, non-user-configurable.
-   **Defaults**: Adheres to E8 Markets rules (0.5% risk, 4% daily loss limit, 6% max drawdown).

#### Services (`src/services/`)
Key services include:
-   **Twelve Data Client**: A unified API wrapper with retry logic, fail-fast symbol normalization, and crypto exchange handling.
-   **Cache**: In-memory TTL cache for market data and decisions.
-   **Rate Limiter**: Token bucket algorithm for Twelve Data API access (610 calls/min).
-   **Signal Cooldown**: Prevents duplicate signals.
-   **Volatility Gate**: Filters signals during extreme ATR conditions.
-   **Logger**: Structured logging.

#### Storage (`src/storage/`)
-   **Signal Store**: In-memory storage with JSON file persistence (`data/signals.json`).
-   **Journal Store**: Manages trade journal entries and P&L calculations, stored in `data/journal.json`.

### API Endpoints
Core API endpoints facilitate system health checks, symbol retrieval, signal analysis and scanning, signal history management, strategy listing, and comprehensive trade journaling with statistics and export capabilities. Real-time grade upgrades are streamed via `/api/upgrades/stream`.

### Feature Specifications
-   **Multi-Strategy System**: Implements 9 intraday strategies with defined win rates and specific indicators.
-   **Confidence Scoring**: Decisions receive a 0-100 score, mapped to A+, A, B+, B, C grades.
-   **Reason Codes**: Provides machine-readable explanations for trade decisions.
-   **Journaling**: Comprehensive trade journaling with P&L, stats, and quick actions.
-   **Strategy Isolation**: Decisions are cached per strategy to prevent data staleness.
-   **Margin-Aware Position Sizing**: Accounts for leverage and margin constraints, especially for crypto.
-   **Indicator Alignment**: Uses NaN padding to ensure indicator array consistency.
-   **Auto-Scan v2.0 (Optimized)**: Background scanning with:
    -   **Watchlist Presets**: majors, majors-gold, crypto, metals, indices, minors, all, or custom selection
    -   **Market Hours Filter**: Skips forex/metals during weekend close (Fri 22:00 - Sun 22:00 UTC), keeps crypto 24/7
    -   **Configurable Intervals**: 3, 5, 10, 15, or 30 minutes
    -   **Progress Tracking**: Real-time scan progress, current strategy, and per-strategy results
    -   **API Optimization**: Reduces API calls by focusing on smaller watchlists instead of all 46 instruments
    -   Config persists to `data/autoScanConfig.json` and auto-starts on server reboot with alert callback guard.
-   **Tiered Exit Management**: Every decision includes exitManagement with TP1 (1R, close 50%, move SL to breakeven), TP2 (2R, close 25%), and trailing runner for remaining 25%.
-   **Grok AI Sentiment Analysis**: On-demand X/Twitter market sentiment integration with caching.
-   **Multi-Asset Class Support**: UI and backend support for Forex, Metals, Indices, Commodities, and Crypto.
-   **H4 Trend Support**: Utilizes native Twelve Data 4h interval with D1 fallback for trend analysis.

## External Dependencies

### Twelve Data API (Primary)
-   **Purpose**: Provides unified market data and technical indicators for all supported asset classes.
-   **Configuration**: Requires `TWELVE_DATA_API_KEY` and optional `TWELVE_DATA_CRYPTO_EXCHANGE`.
-   **Rate Limit**: Governed by a 610 calls/min limit.
-   **Endpoints Used**: Various time series and indicator endpoints (`/time_series`, `/ema`, `/rsi`, `/adx`, etc.).
-   **Symbol Normalization**: Uses `toDataSymbol()` for fail-fast symbol validation.

### Environment Variables
-   `TWELVE_DATA_API_KEY`: Required for Twelve Data access.
-   `TWELVE_DATA_CRYPTO_EXCHANGE`: Specifies crypto exchange (default: Binance).
-   `PORT`: Server port (default: 5000).
-   `LOG_LEVEL`: Logging verbosity (default: info).
-   `RESEND_API_KEY`: (Optional) Enables email alerts via Resend.
-   `XAI_API_KEY`: (Optional) Enables xAI Grok sentiment analysis.

### NPM Dependencies
-   **Runtime**: `express`, `cors`, `dotenv`.
-   **Development**: `typescript`, `tsx`, and respective `@types/*` packages.
# Forex Decision Engine

## Overview
The Forex Decision Engine is a trading signal generator for Forex, Metals, and Cryptocurrency markets. Its core purpose is to provide actionable trade signals, including entry zones, stop losses, and take profit targets. The system employs a deterministic strategy combining trend analysis with entry triggers and produces graded trade recommendations (A+/B grades). It is designed for prop firm trading, incorporating E8 Markets risk management, position sizing, and drawdown safeguards. Key capabilities include multi-strategy scanning, real-time signal freshness tracking, and market sentiment analysis.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend is built with Vanilla JavaScript, uses a mobile-first dark theme, and provides real-time notifications via Server-Sent Events (SSE). It includes `isScanning` guards, API error displays, and accessible touch targets.

**Navigation Structure (4 tabs):**
- **Scan**: Manual symbol scanning with two-panel layout (symbol picker + results)
- **Auto**: Auto-scan configuration with detected trades display (configuration + detections)
- **Journal**: Trade journaling with P&L tracking
- **Settings**: Risk parameters and email alert configuration

**Detection Cards display:** Lot sizes, tiered exit targets (TP1/TP2), and bar expiration countdown for setup freshness.

### Technical Implementations

#### Backend (Express + TypeScript)
The backend is an Express.js application written in TypeScript using ES modules, with `src/server.ts` as the entry point for REST API endpoints.

#### Decision Engine (`src/engine/`)
This module is responsible for orchestrating trade signal generation. It includes an Indicator Factory for unified data access via Twelve Data API, a Trend Filter using EMA 200 and ADX, and an Entry Trigger with RSI confirmation. A Position Sizer calculates risk-based lot sizing, while a Grader assigns confidence scores. The Strategy Analyzer routes to 11 distinct intraday strategies. Safety Gates incorporate volatility and signal cooldowns, and a Grade Tracker monitors signal improvements. Startup validation checks key symbols, and a Signal Quality Gate applies pre-flight checks, including ICT Killzone session bonuses.

#### Smart Money Concepts (`src/modules/smartMoney/`)
This module detects ICT-based institutional trading patterns such as Order Blocks, Fair Value Gaps, Liquidity Sweeps, and tracks Market Structure (BOS, CHOCH).

#### Regime Detector (`src/modules/regimeDetector.ts`)
This module classifies volatility regimes (Compression, Normal, Expansion) based on ATR percentiles to adapt strategy parameters and risk-reward multipliers.

#### Configuration (`src/config/`)
Configuration includes `e8InstrumentSpecs.ts` as a single source of truth for 46 instruments, strategy parameters, and default settings adhering to E8 Markets rules (0.5% risk, 4% daily loss limit, 6% max drawdown).

#### Services (`src/services/`)
Core services include a Twelve Data Client with retry logic and normalization, an in-memory TTL Cache, a Token Bucket Rate Limiter for API calls, Signal Cooldown mechanisms, a Volatility Gate, and structured Logging. A Circuit Breaker Service is implemented for Twelve Data, Grok AI, and Database to prevent cascading failures.

#### Storage (`src/storage/`)
The system utilizes a hybrid PostgreSQL and JSON file storage approach. A Signal Store and Journal Store manage signal and trade journal entries, respectively, with PostgreSQL as the primary storage and JSON files for fallback and legacy entries. A Detection Store, backed by PostgreSQL, manages the lifecycle of trade detections.

### API Endpoints
Core API endpoints cover system health, symbol retrieval, signal analysis and scanning, signal history, strategy listings, trade journaling, and statistics. Real-time grade upgrades are streamed via SSE.

### Feature Specifications
-   **Multi-Strategy System**: Implements 11 intraday strategies including RSI Bounce, EMA Pullback, Multi-Oscillator Momentum, and ICT Liquidity Sweep.
-   **Confidence Scoring**: Trade decisions receive a 0-100 score, mapped to A+/A/B+/B/C grades.
-   **Reason Codes**: Provides machine-readable explanations for trade decisions.
-   **Journaling**: Comprehensive trade journaling with P&L and statistics.
-   **Strategy Isolation**: Caches decisions per strategy to prevent data staleness.
-   **Margin-Aware Position Sizing**: Accounts for leverage and margin constraints.
-   **Indicator Alignment**: Uses timestamp-based alignment (`alignIndicatorToBars()`) to ensure indicators match bar arrays regardless of API output sizes. Falls back to NaN for missing timestamps.
-   **Auto-Scan v2.1**: Background scanning with configurable intervals, watchlist presets, market hours filters, and email alerts for high-grade signals. Auto-scan integrates with the Detection Service to persist and manage detected trades.
-   **Tiered Exit Management**: Each decision includes tiered exit points (TP1, TP2, trailing runner) with risk management actions.
-   **Grok AI Sentiment Analysis**: On-demand X/Twitter market sentiment integration with caching, offering a 7-tier sentiment scale, time-horizon split, contrarian detection, and consensus level.
-   **Multi-Asset Class Support**: Supports Forex, Metals, Indices, Commodities, and Crypto.
-   **H4 Trend Support**: Utilizes Twelve Data's 4h interval for trend analysis with D1 fallback.
-   **Detection System**: Manages detection lifecycle (cooling_down, eligible, executed/dismissed/expired) with a 60-minute default cooldown, PostgreSQL-backed storage, and auto-invalidation on direction flips.
-   **Regime Detector Integration**: Adjusts confidence and risk-reward based on volatility regimes.
-   **Portfolio Risk Manager** (NEW 2026-01-09): Tracks net currency exposure across open positions, enforces max 2% per currency, supports all asset classes (forex, metals, crypto, indices, commodities).
-   **Bar Freshness Validation** (NEW 2026-01-09): Pre-flight rejects signals when bar data is stale (>2h H1, >8h H4, >72h D1) to prevent trading on outdated information.
-   **Mean-Reversion in Strong Trends**: Applies -15pt confidence penalty instead of blocking, allowing high-confluence setups to pass while filtering weak ones.

## Recent Changes (2026-01-09)

### Bloomberg Terminal UI Implementation
1. **Dashboard Redesign**: Converted main screen from "manual-scan" to "dashboard" with Bloomberg Terminal-inspired aesthetic
2. **Status Ticker Bar**: Real-time display of API status, account balance, risk percentage, open P&L, win rate, signals count, and auto-scan status
3. **Table-Based Rendering**: New Bloomberg-style functions for signals table, journal table, running trades, and watchlist sidebar
4. **Null Safety**: Added comprehensive null checks throughout UI.js to prevent errors when DOM elements don't exist
5. **Cache Control**: Server now sends no-cache headers for static files to prevent browser caching issues in development

### Quantitative Audit Implementation
1. **Portfolio Risk Manager** (`src/services/portfolioRiskManager.ts`): New service tracking currency exposure across positions to prevent correlated losses. Supports all 46 instruments with asset-class-aware currency extraction.
2. **Stale Data Prevention**: Removed backfill logic from indicator alignment; added bar timestamp freshness validation in SignalQualityGate pre-flight.
3. **Mean-Reversion Regime Fix**: Changed from outright blocking to confidence penalty (-15pts) in strong-trend regimes.
4. **Indicator Alignment Cleanup**: `alignIndicatorToBars()` now returns NaN for missing data instead of backfilling with stale values.

## External Dependencies

### Twelve Data API
-   **Purpose**: Provides unified market data and technical indicators for all supported asset classes.
-   **Configuration**: Requires `TWELVE_DATA_API_KEY` and optionally `TWELVE_DATA_CRYPTO_EXCHANGE`.
-   **Rate Limit**: 610 calls/min.
-   **Endpoints Used**: Time series and various indicator endpoints.

### Environment Variables
-   `TWELVE_DATA_API_KEY`: API key for Twelve Data.
-   `TWELVE_DATA_CRYPTO_EXCHANGE`: Specifies crypto exchange (default: Binance).
-   `PORT`: Server port (default: 5000).
-   `LOG_LEVEL`: Logging verbosity (default: info).
-   `RESEND_API_KEY`: (Optional) Enables email alerts via Resend.
-   `XAI_API_KEY`: (Optional) Enables xAI Grok sentiment analysis.

### NPM Dependencies
-   **Runtime**: `express`, `cors`, `dotenv`, `zod`, `openai`, `kysely`, `pg`.
-   **Development**: `typescript`, `tsx`, `@types/pg`, and other `@types/*` packages.
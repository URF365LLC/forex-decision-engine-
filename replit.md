# Forex Decision Engine

## Overview
The Forex Decision Engine is a trading signal generator for Forex, Metals, and Cryptocurrency markets. It provides actionable trade signals, including entry zones, stop losses, and take profit targets, using a deterministic strategy that combines trend analysis with entry triggers. The system produces graded trade recommendations (A+/B grades) and is designed for prop firm trading, incorporating E8 Markets risk management, position sizing, and drawdown safeguards. Its key capabilities include multi-strategy scanning, real-time signal freshness tracking, and market sentiment analysis. The project's ambition is to deliver a robust, enterprise-grade trading assistant.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend is built with Vanilla JavaScript, features a mobile-first dark theme, and provides real-time notifications via Server-Sent Events (SSE). It includes `isScanning` guards, API error displays, and accessible touch targets. The navigation comprises four tabs: Scan, Auto, Journal, and Settings. Detection cards display lot sizes, tiered exit targets (TP1/TP2), and bar expiration countdowns. The dashboard features a Bloomberg Terminal-inspired aesthetic with a status ticker bar and table-based rendering for signals, journal, running trades, and watchlist.

### Technical Implementations

#### Backend
The backend is an Express.js application written in TypeScript using ES modules.

#### Decision Engine
This module orchestrates trade signal generation, including an Indicator Factory, Trend Filter (EMA 200, ADX), Entry Trigger (RSI confirmation), Position Sizer, and Grader for confidence scoring. It routes to 11 distinct intraday strategies, incorporates Safety Gates (volatility, signal cooldowns), and performs startup validation and signal quality checks (including ICT Killzone session bonuses).

#### Smart Money Concepts
This module detects ICT-based institutional trading patterns such as Order Blocks, Fair Value Gaps, Liquidity Sweeps, and Market Structure (BOS, CHOCH).

#### Regime Detector
This module classifies volatility regimes (Compression, Normal, Expansion) using ATR percentiles to adapt strategy parameters and risk-reward multipliers.

#### Configuration
`e8InstrumentSpecs.ts` serves as a single source of truth for 46 instruments, strategy parameters, and default settings adhering to E8 Markets rules (0.5% risk, 4% daily loss limit, 6% max drawdown).

#### Services
Core services include a Twelve Data Client with retry logic and normalization, an in-memory TTL Cache, a Token Bucket Rate Limiter, Signal Cooldown mechanisms, a Volatility Gate, and structured Logging. A Circuit Breaker Service is implemented for Twelve Data, Grok AI, and Database connections. A Portfolio Risk Manager tracks net currency exposure across open positions, enforcing a maximum of 2% per currency.

#### Storage
A hybrid PostgreSQL and JSON file storage approach is used. PostgreSQL is primary for Signal, Journal, and Detection Stores, with JSON files used for fallback and legacy entries.

#### API Endpoints
Core API endpoints cover system health, symbol retrieval, signal analysis and scanning, signal history, strategy listings, trade journaling, and statistics. Real-time grade upgrades are streamed via SSE.

### Feature Specifications
-   **Multi-Strategy System**: Implements 11 intraday strategies.
-   **Confidence Scoring**: Trade decisions receive a 0-100 score, mapped to A+/A/B+/B/C grades.
-   **Reason Codes**: Provides machine-readable explanations for trade decisions.
-   **Journaling**: Comprehensive trade journaling with P&L and statistics.
-   **Strategy Isolation**: Caches decisions per strategy to prevent data staleness.
-   **Margin-Aware Position Sizing**: Accounts for leverage and margin constraints.
-   **Indicator Alignment**: Uses timestamp-based alignment (`alignIndicatorToBars()`) for indicator data.
-   **Auto-Scan v2.1**: Background scanning with configurable intervals, watchlist presets, market hours filters, and email alerts for high-grade signals.
-   **Tiered Exit Management**: Each decision includes tiered exit points (TP1, TP2, trailing runner).
-   **Grok AI Sentiment Analysis**: On-demand X/Twitter market sentiment integration with caching.
-   **Multi-Asset Class Support**: Supports Forex, Metals, Indices, Commodities, and Crypto.
-   **H4 Trend Support**: Utilizes Twelve Data's 4h interval for trend analysis with D1 fallback.
-   **Detection System**: Manages detection lifecycle with statuses like `cooling_down`, `eligible`, `taken`, `dismissed`, `expired`, `invalidated`.
-   **Regime Detector Integration**: Adjusts confidence and risk-reward based on volatility regimes.
-   **Bar Freshness Validation**: Rejects signals if bar data is stale.
-   **Mean-Reversion in Strong Trends**: Applies a -15pt confidence penalty instead of blocking mean-reversion setups in strong trends.

## External Dependencies

### Twelve Data API
-   **Purpose**: Provides unified market data and technical indicators.
-   **Configuration**: Requires `TWELVE_DATA_API_KEY` and optionally `TWELVE_DATA_CRYPTO_EXCHANGE`.
-   **Rate Limit**: 610 calls/min.

### Environment Variables
-   `TWELVE_DATA_API_KEY`: API key for Twelve Data.
-   `TWELVE_DATA_CRYPTO_EXCHANGE`: Specifies crypto exchange.
-   `PORT`: Server port.
-   `LOG_LEVEL`: Logging verbosity.
-   `RESEND_API_KEY`: (Optional) Enables email alerts via Resend.
-   `XAI_API_KEY`: (Optional) Enables xAI Grok sentiment analysis.

### NPM Dependencies
-   **Runtime**: `express`, `cors`, `dotenv`, `zod`, `openai`, `kysely`, `pg`.
-   **Development**: `typescript`, `tsx`, `@types/pg`, and other `@types/*` packages.
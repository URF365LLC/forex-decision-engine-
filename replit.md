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

## Recent Changes

### January 2026 - E8 Account Presets Implementation

#### New Features
1. **E8 Account Presets** - Added dropdown to Settings tab with 4 E8 Markets account presets:
   - $10k Challenge (Daily: $400, Max DD: $600)
   - $25k Challenge (Daily: $1,000, Max DD: $1,500)
   - $50k Challenge (Daily: $2,000, Max DD: $3,000)
   - $100k Challenge (Daily: $4,000, Max DD: $6,000)

2. **Dynamic Account Settings API** - GET/PUT `/api/settings/account` endpoints for retrieving and persisting account configuration. Settings sync to autoScanService for position sizing.

3. **Position Sizing Integration** - AutoScan and strategy analysis now use dynamic account settings instead of hardcoded $100k. Lot sizes scale appropriately per account tier.

#### Key Architecture
- **E8_ACCOUNT_PRESETS** array in `defaults.ts` defines all preset configurations
- **account_settings** PostgreSQL table persists settings across restarts
- **Server-side validation** enforces preset ID against known presets, derives accountSize from preset (not trusted from client)
- **autoScanService.updateAccountSettings()** propagates changes to scanning engine
- **Startup loading** retrieves saved settings from database, falls back to $10k default if none exists

### January 2026 - UI/Backend Data Integrity Audit

#### Fixed Bugs
1. **CRITICAL: TieredExits Data Transformation** - `formatTieredExits()` in `detectionStore.ts` now correctly handles both array format (`TieredExitInfo[]`) and legacy object format (`{tp1, tp2}`). Backend stores tieredExits as array with `level` property; frontend expects object with `tp1`/`tp2` keys. The function now converts array format to object format for UI consumption.

2. **Journal Table Field Mismatch** - Fixed `e.lotSize` to `e.lots` in `ui.js` `renderJournalTable()` and `renderRunningTrades()` functions. Backend `journalStore.ts` uses field name `lots`.

#### New UI Features
1. **Risk Amount Display** - Detection cards now show dollar risk amount alongside lot size when available (e.g., "0.5 lots ($125.00 risk)").

2. **Status Reason Display** - Detection cards now display `statusReason` for terminal statuses (dismissed, invalidated, expired) with tooltip for full text.

#### Key Data Contracts
- **DetectedTrade.tieredExits**: Stored as `TieredExitInfo[]` (array with `level`, `price`, `pips`, `rr` properties)
- **API Response tieredExits**: Transformed to `{tp1: {price, formatted, pips, rr}, tp2: {...}}` object format
- **Journal Entry lots field**: Backend uses `lots`, not `lotSize`
- **Detection statuses**: 'taken' is canonical; 'executed' deprecated but supported for backwards compatibility
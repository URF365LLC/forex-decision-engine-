# Forex Decision Engine

## Overview
The Forex Decision Engine is a trading signal generator for Forex, Metals, and Cryptocurrency markets, providing actionable trade signals including entry zones, stop losses, and take profit targets. It uses a deterministic strategy combining trend analysis with entry triggers to produce graded trade recommendations (A+/B grades). Designed for prop firm trading, it integrates E8 Markets risk management, position sizing, and drawdown safeguards. Key capabilities include multi-strategy scanning, real-time signal freshness tracking, and market sentiment analysis. The project aims to be a robust, enterprise-grade trading assistant.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend, built with Vanilla JavaScript, features a mobile-first dark theme and real-time notifications via Server-Sent Events (SSE). It includes `isScanning` guards, API error displays, and accessible touch targets. Navigation consists of Dashboard, Auto, Journal, History, and Settings tabs. Detection cards show lot sizes, tiered exit targets (TP1/TP2), and bar expiration countdowns. The dashboard has a Bloomberg Terminal-inspired aesthetic with a status ticker bar and table-based rendering for signals, journal, running trades, and watchlist.

### Technical Implementations

#### Backend
The backend is an Express.js application written in TypeScript using ES modules.

#### Decision Engine
Orchestrates trade signal generation, including an Indicator Factory, Trend Filter (EMA 200, ADX), Entry Trigger (RSI confirmation), Position Sizer, and Grader for confidence scoring. It routes to 10 distinct intraday strategies, incorporates Safety Gates (volatility, signal cooldowns), and performs startup validation and signal quality checks (including ICT Killzone session bonuses).

#### Smart Money Concepts
Detects ICT-based institutional trading patterns like Order Blocks, Fair Value Gaps, Liquidity Sweeps, and Market Structure (BOS, CHOCH).

#### Regime Detector
Classifies volatility regimes (Compression, Normal, Expansion) using ATR percentiles to adapt strategy parameters and risk-reward multipliers.

#### Configuration
`e8InstrumentSpecs.ts` is the single source of truth for 46 instruments (40 active, 6 disabled), strategy parameters, and default settings adhering to E8 Markets rules (0.5% risk, 4% daily loss limit, 6% max drawdown).

#### Services
Core services include a Twelve Data Client with retry logic, an in-memory TTL Cache, a Token Bucket Rate Limiter, Signal Cooldown mechanisms, a Volatility Gate, structured Logging, and a Circuit Breaker Service for external dependencies. A Portfolio Risk Manager enforces a maximum of 2% net currency exposure per currency.

#### Storage
A hybrid PostgreSQL and JSON file storage approach is used, with PostgreSQL for Signal, Journal, and Detection Stores, and JSON for fallback/legacy entries.

#### API Endpoints
API endpoints cover system health, symbol retrieval, signal analysis and scanning, signal history, strategy listings, trade journaling, and statistics. Real-time grade upgrades are streamed via SSE.

### Feature Specifications
-   **Multi-Strategy System**: Implements 10 intraday strategies (RsiBounce deprecated Jan 2026).
-   **Confidence Scoring**: Trade decisions receive a 0-100 score, mapped to A+/A/B+/B/C grades, with reason codes.
-   **Journaling**: Comprehensive trade journaling with P&L and statistics.
-   **Auto-Scan v2.1**: Background scanning with configurable intervals, watchlist presets, market hours filters, and email alerts for high-grade signals.
-   **Tiered Exit Management**: Each decision includes tiered exit points (TP1, TP2, trailing runner).
-   **Grok AI Sentiment Analysis**: On-demand X/Twitter market sentiment integration with caching.
-   **Multi-Asset Class Support**: Supports Forex, Metals, Indices, Commodities, and Crypto.
-   **H4 Trend Support**: Uses Twelve Data's 4h interval for trend analysis with D1 fallback.
-   **Detection System**: Manages detection lifecycle with statuses like `cooling_down`, `eligible`, `taken`, `dismissed`, `expired`, `invalidated`.
-   **Regime Detector Integration**: Adjusts confidence and risk-reward based on volatility regimes.
-   **Bar Freshness Validation**: Rejects signals if bar data is stale.

## External Dependencies

-   **Twelve Data API**: Provides unified market data and technical indicators. Requires `TWELVE_DATA_API_KEY` and optionally `TWELVE_DATA_CRYPTO_EXCHANGE`.
-   **Resend (Optional)**: For email alerts. Requires `RESEND_API_KEY`.
-   **xAI Grok (Optional)**: For market sentiment analysis. Requires `XAI_API_KEY`.
-   **PostgreSQL**: Database for persistent storage.
-   **NPM Dependencies**: `express`, `cors`, `dotenv`, `zod`, `openai`, `kysely`, `pg` for runtime.

## V3 Strategy Optimizations (Jan 2026)

All strategies undergo 4-Way AI Validation (GPT-4, Claude, Replit Agent, Human) before production deployment.

### BollingerMR V3 (2026-01-22)
- Confidence scoring corrected (40pts touch+rejection)
- Two-tier RSI scoring implemented
- Setup-invalidation stops with 0.4 ATR buffer

### CciZeroLine V3 (2026-01-23)
- EMA200 directional hard gate added
- Close-in-range confirmation (0.7/0.3)
- 2-bar + 0.4 ATR stops
- Strong counter-trend block
- CCI slope bonus

### EmaPullback V3 (2026-01-24)
- ADX unconditional +15 replaced with tiered scoring (0/5/10/15 by ADX tier)
- Candle color replaced with close-in-range momentum confirmation (0.7/0.3)
- EMA50 reclaim bonus (conditional on touch AND reclaim)
- RSI extension CONDITIONAL handling (penalty in strong trends, block in weak/moderate)
- TP authority aligned (preferStructure: false)
- atrMultiplier reduced to 1.5 for consistency
- PHASE1_SIGNAL logging for validation tracking

### Deprecated Strategies
- **RsiBounce** (deprecated 2026-01-22): Removed from registry due to poor automation performance

## Integration Audit Summary (Jan 2026)

### Audit Date: 2026-01-24
Full audit report: `forex-decision-engine/AUDIT_REPORT.md`

### Key Findings
- **13 items** identified across Critical (2), High (2), Medium (4), Low/Optional (5)
- **Risk Assessment**: LOW-MODERATE - core integration flows work correctly; issues are primarily UX polish

### Critical Issues
1. **Silent API Failure Pattern**: Non-critical bootstrap API errors logged to console without user feedback
2. **SSE Reconnection Visibility Gap**: Real-time feed disconnects hidden from users for first 3 attempts

### High Priority Items
1. TypeScript type casting errors in server.ts (3 LSP errors on lines 480, 753, 1000)
2. Detection refresh leaves stale state on error

### Low/Optional
Backend maintenance functions (`resetDrawdownState`, `archiveOverflow`, etc.) are intentionally internal - not defects

### Remediation Priority
1. Week 1: Add user feedback to critical API calls, SSE connection status indicator
2. Week 2: Fix TypeScript type casting with Zod validation
3. Backlog: Loading state improvements, toast standardization

## UI/UX Updates (Jan 2026)

### Signal History Feature (2026-01-24)
- Added new "History" tab in navigation for archived signal exploration
- Features: sortable columns, multi-filter support (strategy, symbol, grade, result, date range)
- Pagination for large datasets (50 signals per page)
- Signal result tracking (mark as win/loss)
- Stats header showing total signals, A+ count, win rate, avg confidence

### Disabled Instruments (2026-01-24)
- **WTI and Brent removed** - marked as disabled with reason "Data not real-time - stale/unreliable quotes"
- Consistent with prior index removals (SP, NSDQ, DOW, DAX, NIKKEI, ASX)
- Active instrument count now: 38 (28 forex, 8 crypto, 2 metals)

### Bug Fixes (2026-01-26)
- **Market Hours Logic**: Fixed SignalQualityGate to correctly handle weekend boundaries:
  - Saturday: Market fully closed
  - Sunday: Opens at 22:00 UTC (not midnight)
  - Friday: Closes at 22:00 UTC
- **Symbol Count**: Auto-scan now correctly shows 38 active instruments instead of 46
- **Disabled Filtering**: All presets (all, commodities, indices) now properly filter out disabled instruments
- **CSS Layout**: Fixed black space issue on Journal and History tabs with min-height styling

### Responsive Design (2026-01-24)
- Added tablet breakpoint (768px): horizontal scroll nav, stacked filters, wrapped metrics
- Added mobile breakpoint (480px): compact typography, hidden less-important columns, full-width buttons
- Table scroll containers for mobile horizontal scrolling
- Navigation uses horizontal scroll on narrow screens (no hamburger menu for simplicity)
# Forex Decision Engine

## Overview
The Forex Decision Engine is a trading signal generator for Forex, Metals, and Cryptocurrency markets, providing actionable trade signals including entry zones, stop losses, and take profit targets. It uses a deterministic strategy combining trend analysis with entry triggers to produce graded trade recommendations (A+/B grades). Designed for prop firm trading, it integrates E8 Markets risk management, position sizing, and drawdown safeguards. Key capabilities include multi-strategy scanning, real-time signal freshness tracking, and market sentiment analysis. The project aims to be a robust, enterprise-grade trading assistant.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend, built with Vanilla JavaScript, features a mobile-first dark theme and real-time notifications via Server-Sent Events (SSE). It includes `isScanning` guards, API error displays, and accessible touch targets. Navigation consists of Scan, Auto, Journal, and Settings tabs. Detection cards show lot sizes, tiered exit targets (TP1/TP2), and bar expiration countdowns. The dashboard has a Bloomberg Terminal-inspired aesthetic with a status ticker bar and table-based rendering for signals, journal, running trades, and watchlist.

### Technical Implementations

#### Backend
The backend is an Express.js application written in TypeScript using ES modules.

#### Decision Engine
Orchestrates trade signal generation, including an Indicator Factory, Trend Filter (EMA 200, ADX), Entry Trigger (RSI confirmation), Position Sizer, and Grader for confidence scoring. It routes to 10 active intraday strategies, incorporates Safety Gates (volatility, signal cooldowns), and performs startup validation and signal quality checks (including ICT Killzone session bonuses).

#### Smart Money Concepts
Detects ICT-based institutional trading patterns like Order Blocks, Fair Value Gaps, Liquidity Sweeps, and Market Structure (BOS, CHOCH).

#### Regime Detector
Classifies volatility regimes (Compression, Normal, Expansion) using ATR percentiles to adapt strategy parameters and risk-reward multipliers.

#### Configuration
`e8InstrumentSpecs.ts` is the single source of truth for 46 instruments (38 active, 8 disabled), strategy parameters, and default settings adhering to E8 Markets rules (0.5% risk, 4% daily loss limit, 6% max drawdown). Active breakdown: 28 forex, 2 metals, 8 crypto. Disabled: 4 indices (no realtime data), 2 commodities (WTI/BRENT - no realtime data).

#### Services
Core services include a Twelve Data Client with retry logic, an in-memory TTL Cache, a Token Bucket Rate Limiter, Signal Cooldown mechanisms, a Volatility Gate, structured Logging, and a Circuit Breaker Service for external dependencies. A Portfolio Risk Manager enforces a maximum of 2% net currency exposure per currency.

#### Storage
A hybrid PostgreSQL and JSON file storage approach is used, with PostgreSQL for Signal, Journal, and Detection Stores, and JSON for fallback/legacy entries.

#### API Endpoints
API endpoints cover system health, symbol retrieval, signal analysis and scanning, signal history, strategy listings, trade journaling, and statistics. Real-time grade upgrades are streamed via SSE.

### Feature Specifications
-   **Multi-Strategy System**: Implements 10 active intraday strategies (RsiBounce removed as dead code).
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

## Recent Changes (February 2026)

### Signal Quality Hardening (14 validated fixes)
Cross-validated audit by Claude and ChatGPT Codex to reduce false signals by 30-40%. Key changes:

**Systemic (all strategies):**
- S-01: ADX weak-trend threshold raised 14→20 (SignalQualityGate.ts)
- S-02: Session bonuses reduced — London/NY Overlap +20→+10 (SignalQualityGate.ts)
- S-03: Mean-reversion weak-trend penalty -10 added (SignalQualityGate.ts)

**Per-strategy:**
- P-01: EmaPullback — tiered ADX bonus (≥25: +15, 20-24: +8, <20: +0)
- P-02/P-03: MultiOscillatorMomentum — RSI 35→30/65→70, Stoch 25→20/75→80
- P-04: TripleEma — 0.3×ATR minimum pullback depth filter
- P-05: WilliamsEma — ADX ≥ 20 hard gate
- P-06: CciZeroLine — extreme thresholds ±100→±150
- P-07: BollingerMR — RSI soft gate (long ≤40, short ≥60)
- P-08: StochasticOversold — base confidence 35→25
- P-09: BreakRetest — swing lookbacks 5→8, S/R 3→5, structure slice 50→80
- P-11: Deleted dead RsiBounce.ts strategy file

**Documentation:** Full audit in CROSS_VALIDATION_REPORT.md

### FVG Confluence Gate (Feb 2026)
Added Fair Value Gap (FVG) analysis to the shared `buildDecision` pipeline, giving all 10 strategies institutional-level FVG awareness:
- **Supportive FVG**: Unfilled FVG aligned with trade direction near entry → +5 to +10 confidence bonus
- **Counter FVG Wall**: Unfilled FVG opposing trade direction between entry and TP → -5 to -10 confidence penalty
- **TP Adjustment**: When counter-FVG wall exists, TP pulls back to wall edge (maintaining min 1R) to avoid running into reversal zone
- **Double-count guard**: Strategies that already use FVG internally (LiquiditySweep) are excluded from global FVG adjustments
- **Email alerts**: FVG status (PRO/AGAINST) displayed in detection alert emails with color-coded badge, summary, and TP adjustment notes
- **Frontend**: Detection cards show FVG PRO (green) or FVG AGAINST (red) badge with summary text
- **Database**: FVG data persisted in `detections.fvg_data` JSONB column
- **Decision type**: New optional `fvg?: FVGConfluence` field on Decision interface

## External Dependencies

-   **Twelve Data API**: Provides unified market data and technical indicators. Requires `TWELVE_DATA_API_KEY` and optionally `TWELVE_DATA_CRYPTO_EXCHANGE`.
-   **Resend (Optional)**: For email alerts. Requires `RESEND_API_KEY`.
-   **xAI Grok (Optional)**: For market sentiment analysis. Requires `XAI_API_KEY`.
-   **PostgreSQL**: Database for persistent storage.
-   **NPM Dependencies**: `express`, `cors`, `dotenv`, `zod`, `openai`, `kysely`, `pg` for runtime.
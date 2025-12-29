# Forex Decision Engine

## Overview

A trading decision engine for Forex and Cryptocurrency markets that generates actionable trade signals with clear entry zones, stop losses, and take profit targets. The system uses a deterministic strategy combining trend analysis (EMA 200, ADX) with entry triggers (EMA 20/50 pullbacks, RSI resets) to produce graded trade recommendations (A+/B grades). Built for prop firm trading with E8 Markets risk management rules and position sizing.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend (Express + TypeScript)
- **Framework**: Express.js with TypeScript, ES modules
- **Entry Point**: `src/server.ts` - REST API serving analysis endpoints
- **Build Tool**: tsx for development, tsc for production builds

### Decision Engine (`src/engine/`)
The core analysis pipeline processes market data through distinct stages:

1. **Indicator Factory** (`indicatorFactory.ts`) - Routes to correct indicator service based on asset class
2. **Indicator Service** (`indicatorService.ts`) - Fetches OHLCV and technical indicators from Alpha Vantage for Forex
3. **Crypto Indicator Service** (`cryptoIndicatorService.ts`) - Computes EMA/RSI/ATR/ADX locally using Wilder's smoothing (Alpha Vantage indicator endpoints don't support crypto)
4. **Trend Filter** (`trendFilter.ts`) - Higher timeframe trend direction using EMA 200 + ADX
5. **Entry Trigger** (`entryTrigger.ts`) - Pullback detection to EMA 20/50 zone with RSI confirmation
6. **Position Sizer** (`positionSizer.ts`) - Risk-based lot sizing with prop firm constraints
7. **Grader** (`grader.ts`) - Confluence scoring producing A+/B/no-trade grades
8. **Decision Engine** (`decisionEngine.ts`) - Orchestrates all components into final trade signals

### Configuration (`src/config/`)
- **Strategy parameters** are fixed and not user-configurable (v1 design decision)
- **Universe**: 28 Forex pairs + 8 Crypto pairs with metadata
- **Defaults**: E8 Markets prop firm rules (0.5% risk, 4% daily loss limit, 6% max drawdown)

### Services (`src/services/`)
- **Alpha Vantage Client** - API wrapper with caching and rate limiting
- **Cache** - In-memory TTL cache (no database dependency)
- **Rate Limiter** - Token bucket algorithm for API rate limiting (150 calls/min)
- **Signal Cooldown** - Prevents duplicate signals unless grade improves or direction flips
- **Volatility Gate** - Filters signals during extreme ATR conditions
- **Logger** - Structured logging with levels and colors

### Storage (`src/storage/`)
- **Signal Store** - In-memory signal storage with JSON file persistence (`data/signals.json`)
- Uses atomic writes (temp file + rename) to prevent data corruption
- No database required - signals persist to filesystem

### Frontend (Vanilla JS)
- **Location**: `public/` directory served statically
- **Architecture**: Single HTML page with modular JS files
- **State**: localStorage for settings, watchlist, and cached results
- **Design**: Mobile-first, dark theme CSS, 44px touch targets
- **Concurrency**: isScanning guard prevents duplicate scan requests
- **Error Display**: Shows ERROR badge for failed API calls instead of misleading "no-trade"

### API Endpoints
```
GET  /api/health     - Health check
GET  /api/universe   - Available trading symbols
GET  /api/status     - Cache and rate limiter status
POST /api/analyze    - Analyze single symbol
POST /api/scan       - Scan multiple symbols
GET  /api/signals    - Signal history
PUT  /api/signals/:id - Update signal result
```

## External Dependencies

### Alpha Vantage API (Required)
- **Purpose**: Market data and technical indicators for Forex and most Crypto
- **Configuration**: `ALPHAVANTAGE_API_KEY` environment variable
- **Rate Limit**: 150 calls/minute (Premium tier required for Forex/Crypto)
- **Endpoints Used**: FX_INTRADAY, CRYPTO_INTRADAY, EMA, RSI, ADX, ATR

### KuCoin API (Fallback for BNB/BCH)
- **Purpose**: OHLCV data for BNBUSD and BCHUSD (not supported by Alpha Vantage)
- **Configuration**: No API key required (public endpoints)
- **Symbol Mapping**: BNBUSD → BNB-USDT, BCHUSD → BCH-USDT
- **Rate Limit**: 100 requests per 10 seconds (very generous)

### Environment Variables
- `ALPHAVANTAGE_API_KEY` - API key for market data (required)
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging verbosity: debug/info/warn/error (default: info)

### NPM Dependencies
- **Runtime**: express, cors, dotenv
- **Development**: typescript, tsx, @types packages

## Recent Updates

### Multi-Strategy System (Phase 3 Complete) - 2025-12-29
- **8 Intraday Strategies** with varying win rates:
  1. RSI Oversold Bounce (72% WR) - Mean reversion from RSI extremes with Bollinger Band confirmation
  2. Stochastic Oversold (65% WR) - Stochastic crossover in extreme zones
  3. Bollinger Mean Reversion (65% WR) - Mean reversion from Bollinger Band touches
  4. Williams %R + EMA (58% WR) - Williams %R with EMA trend filter
  5. Triple EMA Crossover (56% WR) - EMA8/21/55 alignment with pullback entry
  6. Break & Retest (55% WR) - Enter on retest of broken levels
  7. CCI Zero-Line Cross (55% WR) - CCI crossing zero from extremes
  8. EMA Pullback (50% WR) - Original trend continuation strategy

- **Strategy Architecture** (`src/strategies/`):
  - `types.ts` - IStrategy interface, StrategyDecision, IndicatorData types
  - `utils.ts` - 10+ helpers: calculateGrade, buildDecision, validateOrder, atIndex, safeDiv, isRejectionCandle, normalizedSlope, clamp
  - `registry.ts` - Central strategy lookup with metadata (win rate, indicators, timeframes)
  - `index.ts` - Main exports

- **API Endpoints**:
  - `GET /api/strategies?style=intraday` - Returns available strategies for style
  - `POST /api/scan` - Now accepts `strategyId` parameter

- **Alpha Vantage Client Extensions**:
  - `getStochastic()` - SlowK/SlowD values
  - `getWilliamsR()` - Williams %R indicator
  - `getCCI()` - Commodity Channel Index
  - `getBBands()` - Bollinger Bands (upper/middle/lower)
  - `getSMA()` - Simple Moving Average

- **Frontend Updates**:
  - Strategy dropdown in Watchlist screen (persists to localStorage)
  - Decision cards show: strategy name, confidence %, reason codes
  - Extended grade display: A+, A, B+, B, C

- **Execution Model**: NEXT_OPEN - signal on bar-2, entry on bar-1 open
- **Confidence Scoring**: 0-100 scale converted to grades (A+ ≥90, A ≥80, B+ ≥70, B ≥60, C ≥50)
- **Reason Codes**: Machine-readable analytics (RSI_OVERSOLD, BB_TOUCH_LOWER, TREND_ALIGNED, etc.)

### Journal Feature (Phase 2 Complete)
- **Backend**: Full journal API with CRUD operations, P&L calculation, stats endpoint
- **Storage**: `data/journal.json` with atomic writes for persistence
- **Frontend**: 
  - "Took Trade", "Skipped", "Missed" action buttons on signal cards
  - Trade modal with pre-fill from signals (entry, SL, TP, lots)
  - Journal screen with stats (trades taken, win rate, avg R, total P&L)
  - Filter buttons: All, Taken, Running, Closed
  - Running trades highlighted with amber border
  - Quick close buttons (Hit TP / Hit SL) for running trades
  - CSV export at `/api/journal/export`
- **P&L Calculation**: Uses asset class detection - crypto uses direct price × lots, forex uses pip-based calculation
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
- **Universe**: 28 Forex pairs + 7 Crypto pairs + 2 Metal pairs with metadata
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
- **Purpose**: Market data and technical indicators
- **Configuration**: `ALPHAVANTAGE_API_KEY` environment variable
- **Rate Limit**: 150 calls/minute (Premium tier required for Forex/Crypto)
- **Endpoints Used**: FX_INTRADAY, CRYPTO_INTRADAY, EMA, RSI, ADX, ATR

### Environment Variables
- `ALPHAVANTAGE_API_KEY` - API key for market data (required)
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging verbosity: debug/info/warn/error (default: info)

### NPM Dependencies
- **Runtime**: express, cors, dotenv
- **Development**: typescript, tsx, @types packages
# Forex Decision Engine

## Overview

A trading decision engine for Forex, Cryptocurrency, and Metals markets that generates actionable trade signals with clear entry zones, stop losses, and take profit targets. The system uses a deterministic strategy combining trend analysis (EMA 200, ADX) with entry triggers (EMA 20/50 pullbacks, RSI resets) to produce graded trade recommendations (A+/B grades). Built for prop firm trading with E8 Markets risk management rules and position sizing.

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
2. **Indicator Calculations** (`indicatorCalculations.ts`) - Shared EMA/RSI/ATR/ADX calculations using Wilder's smoothing
3. **Indicator Service** (`indicatorService.ts`) - Fetches OHLCV and technical indicators from Alpha Vantage for Forex
4. **Crypto Indicator Service** (`cryptoIndicatorService.ts`) - Computes indicators locally for crypto (Alpha Vantage indicator endpoints don't support crypto)
5. **Twelve Data Indicator Service** (`twelveDataIndicatorService.ts`) - Computes indicators locally for metals using Twelve Data OHLCV
6. **Trend Filter** (`trendFilter.ts`) - Higher timeframe trend direction using EMA 200 + ADX
7. **Entry Trigger** (`entryTrigger.ts`) - Pullback detection to EMA 20/50 zone with RSI confirmation
8. **Position Sizer** (`positionSizer.ts`) - Risk-based lot sizing with prop firm constraints
9. **Grader** (`grader.ts`) - Confluence scoring producing A+/B/no-trade grades
10. **Decision Engine** (`decisionEngine.ts`) - Orchestrates all components into final trade signals

### Configuration (`src/config/`)
- **Strategy parameters** are fixed and not user-configurable (v1 design decision)
- **Universe**: 28 Forex pairs + 8 Crypto pairs + 2 Metals = 38 symbols total
- **Defaults**: E8 Markets prop firm rules (0.5% risk, 4% daily loss limit, 6% max drawdown)

### Services (`src/services/`)
- **Alpha Vantage Client** - API wrapper with caching and rate limiting
- **KuCoin Client** - Fallback OHLCV for BNBUSD/BCHUSD (no API key required)
- **Twelve Data Client** - OHLCV for metals with 15-min cache and dedicated rate limiter
- **Cache** - In-memory TTL cache (no database dependency)
- **Rate Limiter** - Token bucket algorithm for API rate limiting
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

### Twelve Data API (Metals)
- **Purpose**: OHLCV data for Gold (XAUUSD) and Silver (XAGUSD)
- **Configuration**: `TWELVE_DATA_API_KEY` environment variable
- **Rate Limit**: 8 calls/minute (free tier) with dedicated rate limiter
- **Cache TTL**: 15 minutes (longer due to rate limits)
- **Symbol Mapping**: XAUUSD → XAU/USD, XAGUSD → XAG/USD
- **Note**: Indices and energies require Twelve Data Grow plan ($29/month)

### Environment Variables
- `ALPHAVANTAGE_API_KEY` - API key for market data (required)
- `TWELVE_DATA_API_KEY` - API key for metals data (required for gold/silver)
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging verbosity: debug/info/warn/error (default: info)

### NPM Dependencies
- **Runtime**: express, cors, dotenv
- **Development**: typescript, tsx, @types packages

## Symbol Coverage

| Asset Class | Count | Data Source | Notes |
|-------------|-------|-------------|-------|
| Forex | 28 | Alpha Vantage | Full indicator support |
| Crypto | 8 | Alpha Vantage + KuCoin | Local indicator calculation |
| Metals | 2 | Twelve Data | XAU/USD, XAG/USD only |
| **Total** | **38** | | E8 MT5 compatible |

## Recent Changes

- **2025-12-28**: Added Twelve Data integration for Gold (XAUUSD) and Silver (XAGUSD)
- **2025-12-28**: Added KuCoin fallback for BNBUSD and BCHUSD
- **2025-12-28**: Extracted shared indicator calculations to `indicatorCalculations.ts`
- **2025-12-28**: Updated universe to 38 symbols (28 forex + 8 crypto + 2 metals)

# 🎯 Forex Decision Engine

Enterprise-grade trading decision engine for Forex and Crypto. Clear trade signals, not chart overload.

## Features

- **Decision Cards**: Entry zone, stop loss, take profit, position size
- **A+/B Grading**: Deterministic confluence scoring
- **28 Forex + 8 Crypto**: Complete coverage
- **E8 Markets Ready**: Position sizing for prop firm rules
- **Mobile First**: Responsive design

## Strategy

```
TREND FILTER (Higher Timeframe)
├── EMA 200 direction
├── EMA 200 slope (3-bar)
└── ADX 14 > 20

ENTRY TRIGGER (Lower Timeframe)
├── Pullback to EMA 20/50 zone
└── RSI 14 reset + turning

STOP LOSS
├── Recent swing high/low
└── Fallback: 1.5 × ATR

TAKE PROFIT
└── Minimum 2R
```

## Quick Start

### 1. Install Dependencies

```bash
cd forex-decision-engine
npm install
```

### 2. Configure API Key

```bash
cp .env.example .env
# Edit .env and add your Alpha Vantage API key
```

Get your Premium API key at: https://www.alphavantage.co/premium/

### 3. Run Development Server

```bash
npm run dev
```

### 4. Open Browser

Navigate to http://localhost:3000

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| GET | /api/universe | Get available symbols |
| GET | /api/status | Cache and rate limiter status |
| POST | /api/analyze | Analyze single symbol |
| POST | /api/scan | Scan multiple symbols |
| GET | /api/signals | Get signal history |
| PUT | /api/signals/:id | Update signal result |

## Risk Management (E8 Markets)

- **Account**: $10,000
- **Daily Loss Limit**: 4% ($400)
- **Max Drawdown**: 6% ($600)
- **Default Risk**: 0.5% per trade ($50)

---

Built with ❤️ for clear trading decisions.

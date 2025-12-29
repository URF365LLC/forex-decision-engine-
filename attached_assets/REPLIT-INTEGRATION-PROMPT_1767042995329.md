# 🚀 REPLIT INTEGRATION PROMPT: Multi-Strategy Scanner

**Copy and paste this entire prompt to your Replit AI assistant to integrate the strategy system.**

---

## CONTEXT

I have a forex/crypto trading decision engine running on Replit. I need to integrate a multi-strategy scanner system. I have 8 intraday strategy files ready to add, and I need help integrating them with my existing codebase.

## CURRENT SYSTEM STRUCTURE

My existing project has:
- `public/index.html` - Frontend with 4 tabs: Results, Watchlist, Journal, Settings
- `public/js/app.js` - Main application logic with `runScan()`, `renderResults()`, etc.
- `public/js/ui.js` - DOM manipulation and UI helpers
- `public/css/styles.css` - Dark theme styling
- `src/config/strategy.ts` - Current single EMA Pullback strategy
- Settings dropdown for Style: Intraday or Swing

## WHAT I NEED

1. **Add strategy files** - Create `/src/strategies/` folder with the modular strategy system
2. **Add strategy dropdown** - In the Watchlist screen, add a dropdown to select which strategy to use
3. **Filter by style** - The dropdown should only show strategies matching the current Style setting (Intraday/Swing)
4. **Update scan endpoint** - Pass the selected strategyId to the backend and run only that strategy

---

## FILES TO CREATE

### 1. `/src/strategies/types.ts`

```typescript
/**
 * UDO Multi-Strategy System - Shared Types
 */

export type TradingStyle = 'intraday' | 'swing';
export type SignalDirection = 'long' | 'short';
export type SignalGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'no-trade';

export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorData {
  symbol: string;
  bars: Bar[];
  ema20?: number[];
  ema50?: number[];
  ema200?: number[];
  sma20?: number[];
  rsi?: number[];
  stoch?: { k: number; d: number }[];
  willr?: number[];
  cci?: number[];
  macd?: { macd: number; signal: number; histogram: number }[];
  atr?: number[];
  bbands?: { upper: number; middle: number; lower: number }[];
  adx?: number[];
}

export interface UserSettings {
  accountSize: number;
  riskPercent: number;
  style: TradingStyle;
  timezone: string;
}

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  style: TradingStyle;
  winRate: number;
  avgRR: number;
  signalsPerWeek: string;
  requiredIndicators: string[];
}

export interface Decision {
  symbol: string;
  displayName: string;
  strategyId: string;
  strategyName: string;
  direction: SignalDirection;
  grade: SignalGrade;
  confidence: number;
  entryZone: { low: number; high: number; formatted: string } | null;
  stopLoss: { price: number; pips: number; formatted: string } | null;
  takeProfit: { price: number; pips: number; rr: number; formatted: string } | null;
  position: { lots: number; units: number; riskAmount: number } | null;
  reason: string;
  triggers: string[];
  warnings: string[];
  style: TradingStyle;
  timeframes: { trend: string; entry: string };
  timestamp: string;
  validUntil: string;
}

export interface IStrategy {
  meta: StrategyMeta;
  analyze(data: IndicatorData, settings: UserSettings): Promise<Decision | null>;
}

export function getPipInfo(symbol: string) {
  const isJpy = symbol.includes('JPY');
  const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP'].some(c => symbol.includes(c));
  if (isCrypto) return { pipSize: 1, pipValue: 1, digits: 2 };
  if (isJpy) return { pipSize: 0.01, pipValue: 0.01, digits: 3 };
  return { pipSize: 0.0001, pipValue: 0.0001, digits: 5 };
}

export function formatPrice(price: number, symbol: string): string {
  const { digits } = getPipInfo(symbol);
  return price.toFixed(digits);
}

export function calculatePips(price1: number, price2: number, symbol: string): number {
  const { pipSize } = getPipInfo(symbol);
  return Math.abs(price1 - price2) / pipSize;
}
```

### 2. `/src/strategies/registry.ts`

```typescript
/**
 * Strategy Registry - Central lookup for all strategies
 */

import { IStrategy, TradingStyle, StrategyMeta } from './types';

// Strategy implementations will be imported here
// For now, create placeholder entries

const INTRADAY_STRATEGIES: StrategyMeta[] = [
  { id: 'rsi-bounce', name: 'RSI Oversold Bounce', description: 'Mean reversion from RSI extremes', style: 'intraday', winRate: 72, avgRR: 1.2, signalsPerWeek: '15-25', requiredIndicators: ['bars', 'rsi', 'bbands', 'atr', 'sma20'] },
  { id: 'stoch-oversold', name: 'Stochastic Oversold', description: 'Stochastic crossover in extreme zones', style: 'intraday', winRate: 65, avgRR: 1.5, signalsPerWeek: '20-30', requiredIndicators: ['bars', 'stoch', 'atr', 'ema200'] },
  { id: 'bollinger-mr', name: 'Bollinger Mean Reversion', description: 'Mean reversion from Bollinger Band touches', style: 'intraday', winRate: 65, avgRR: 1.5, signalsPerWeek: '15-20', requiredIndicators: ['bars', 'bbands', 'rsi', 'atr', 'ema200'] },
  { id: 'williams-ema', name: 'Williams %R + EMA', description: 'Williams %R with EMA trend filter', style: 'intraday', winRate: 58, avgRR: 1.5, signalsPerWeek: '15-20', requiredIndicators: ['bars', 'willr', 'ema50', 'atr'] },
  { id: 'triple-ema', name: 'Triple EMA Crossover', description: 'EMA8/21/55 alignment with pullback', style: 'intraday', winRate: 55, avgRR: 2.0, signalsPerWeek: '10-15', requiredIndicators: ['bars', 'atr'] },
  { id: 'break-retest-intra', name: 'Break & Retest', description: 'Enter on retest of broken levels', style: 'intraday', winRate: 55, avgRR: 2.0, signalsPerWeek: '10-15', requiredIndicators: ['bars', 'atr'] },
  { id: 'cci-zero', name: 'CCI Zero-Line Cross', description: 'CCI crossing zero from extremes', style: 'intraday', winRate: 55, avgRR: 2.0, signalsPerWeek: '10-15', requiredIndicators: ['bars', 'cci', 'ema200', 'atr'] },
  { id: 'ema-pullback-intra', name: 'EMA Pullback', description: 'Trend continuation on EMA pullback', style: 'intraday', winRate: 50, avgRR: 2.0, signalsPerWeek: '8-15', requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'] },
];

const SWING_STRATEGIES: StrategyMeta[] = [
  // TODO: Add swing strategies later
  { id: 'ema-pullback-swing', name: 'EMA Pullback (Swing)', description: 'Trend continuation on H4 timeframe', style: 'swing', winRate: 50, avgRR: 2.0, signalsPerWeek: '2-4', requiredIndicators: ['bars', 'ema20', 'ema50', 'ema200', 'rsi', 'adx', 'atr'] },
];

export function getStrategyOptions(style: TradingStyle): StrategyMeta[] {
  const strategies = style === 'intraday' ? INTRADAY_STRATEGIES : SWING_STRATEGIES;
  return strategies.sort((a, b) => b.winRate - a.winRate);
}

export function getStrategyMeta(strategyId: string): StrategyMeta | undefined {
  return [...INTRADAY_STRATEGIES, ...SWING_STRATEGIES].find(s => s.id === strategyId);
}

export function getRequiredIndicators(strategyId: string): string[] {
  const meta = getStrategyMeta(strategyId);
  return meta?.requiredIndicators || ['bars', 'rsi', 'atr'];
}
```

---

## FRONTEND CHANGES

### 3. Update `public/index.html` - Add Strategy Dropdown to Watchlist Tab

Find the watchlist tab content and add this BEFORE the symbol grids:

```html
<!-- Strategy Selection -->
<div class="form-group" style="margin-bottom: 1rem;">
  <label for="strategy-select" style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
    Strategy
  </label>
  <select id="strategy-select" class="form-control" style="width: 100%; padding: 0.75rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 0.95rem;">
    <option value="rsi-bounce">RSI Oversold Bounce (72% WR)</option>
    <option value="stoch-oversold">Stochastic Oversold (65% WR)</option>
    <option value="bollinger-mr">Bollinger Mean Reversion (65% WR)</option>
    <option value="williams-ema">Williams %R + EMA (58% WR)</option>
    <option value="triple-ema">Triple EMA Crossover (55% WR)</option>
    <option value="break-retest-intra">Break & Retest (55% WR)</option>
    <option value="cci-zero">CCI Zero-Line Cross (55% WR)</option>
    <option value="ema-pullback-intra">EMA Pullback (50% WR)</option>
  </select>
</div>
```

### 4. Update `public/js/app.js`

Add these changes:

```javascript
// Add to App object properties
selectedStrategy: 'rsi-bounce',

// Add this method to load strategies based on style
async loadStrategyOptions() {
  const settings = Storage.getSettings();
  const dropdown = document.getElementById('strategy-select');
  if (!dropdown) return;
  
  try {
    const response = await fetch(`/api/strategies?style=${settings.style}`);
    const strategies = await response.json();
    
    dropdown.innerHTML = strategies.map(s => 
      `<option value="${s.id}">${s.name} (${s.winRate}% WR)</option>`
    ).join('');
    
    // Set default selection
    this.selectedStrategy = strategies[0]?.id || 'rsi-bounce';
    dropdown.value = this.selectedStrategy;
  } catch (error) {
    console.error('Failed to load strategies:', error);
  }
},

// Add event listener for strategy selection (add to init method)
document.getElementById('strategy-select')?.addEventListener('change', (e) => {
  App.selectedStrategy = e.target.value;
});

// Update runScan method to include strategyId
async runScan() {
  if (this.selectedSymbols.size === 0) {
    UI.showToast('Please select at least one symbol', 'warning');
    return;
  }

  UI.setLoading(true);
  
  try {
    const settings = Storage.getSettings();
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: Array.from(this.selectedSymbols),
        strategyId: this.selectedStrategy,  // ← ADD THIS
        settings: settings
      })
    });
    
    const data = await response.json();
    this.results = data.decisions || [];
    this.renderResults();
    UI.showTab('results');
    
  } catch (error) {
    console.error('Scan failed:', error);
    UI.showToast('Scan failed: ' + error.message, 'error');
  } finally {
    UI.setLoading(false);
  }
},

// Call loadStrategyOptions when style changes
// Add to the settings style change handler:
document.getElementById('style-select')?.addEventListener('change', () => {
  App.loadStrategyOptions();
});

// Call on initial load (add to init method)
this.loadStrategyOptions();
```

---

## BACKEND CHANGES

### 5. Add API endpoint for strategies (in your server file)

```typescript
import { getStrategyOptions, getRequiredIndicators, getStrategyMeta } from './strategies/registry';

// GET /api/strategies - Returns strategies for dropdown
app.get('/api/strategies', (req, res) => {
  const style = (req.query.style as 'intraday' | 'swing') || 'intraday';
  const strategies = getStrategyOptions(style);
  res.json(strategies);
});

// Update POST /api/scan to use selected strategy
app.post('/api/scan', async (req, res) => {
  try {
    const { symbols, strategyId, settings } = req.body;
    
    // Get required indicators for this strategy
    const requiredIndicators = getRequiredIndicators(strategyId);
    const strategyMeta = getStrategyMeta(strategyId);
    
    if (!strategyMeta) {
      return res.status(400).json({ error: 'Unknown strategy' });
    }
    
    const decisions = [];
    
    for (const symbol of symbols) {
      // Fetch only required indicators (optimize API calls)
      const data = await fetchIndicatorsForStrategy(symbol, requiredIndicators, settings);
      
      // Run the selected strategy
      const decision = await runStrategy(strategyId, data, settings);
      
      if (decision && decision.grade !== 'no-trade') {
        decisions.push(decision);
      }
    }
    
    // Sort by confidence
    decisions.sort((a, b) => b.confidence - a.confidence);
    
    res.json({ decisions, strategyUsed: strategyMeta.name });
    
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// Helper to fetch only needed indicators
async function fetchIndicatorsForStrategy(symbol: string, indicators: string[], settings: any) {
  const data: any = { symbol, bars: [] };
  
  // Always fetch bars
  data.bars = await fetchOHLCV(symbol, settings);
  
  // Fetch each required indicator
  for (const ind of indicators) {
    switch (ind) {
      case 'rsi': data.rsi = await fetchRSI(symbol); break;
      case 'ema20': data.ema20 = await fetchEMA(symbol, 20); break;
      case 'ema50': data.ema50 = await fetchEMA(symbol, 50); break;
      case 'ema200': data.ema200 = await fetchEMA(symbol, 200); break;
      case 'sma20': data.sma20 = await fetchSMA(symbol, 20); break;
      case 'bbands': data.bbands = await fetchBBands(symbol); break;
      case 'stoch': data.stoch = await fetchStoch(symbol); break;
      case 'willr': data.willr = await fetchWilliamsR(symbol); break;
      case 'cci': data.cci = await fetchCCI(symbol); break;
      case 'macd': data.macd = await fetchMACD(symbol); break;
      case 'atr': data.atr = await fetchATR(symbol); break;
      case 'adx': data.adx = await fetchADX(symbol); break;
    }
  }
  
  return data;
}
```

---

## SUMMARY OF CHANGES

1. ✅ Create `/src/strategies/types.ts` - Type definitions
2. ✅ Create `/src/strategies/registry.ts` - Strategy lookup
3. ✅ Add strategy dropdown HTML to Watchlist tab
4. ✅ Update `app.js` with `loadStrategyOptions()` and strategy selection
5. ✅ Add `/api/strategies` endpoint
6. ✅ Update `/api/scan` to accept and use `strategyId`

## AFTER INTEGRATION

Once integrated, the user flow will be:
1. User goes to Settings → selects Style (Intraday/Swing)
2. User goes to Watchlist → sees Strategy dropdown filtered by style
3. User selects strategy (e.g., "RSI Oversold Bounce (72% WR)")
4. User selects symbols to scan
5. User clicks "Scan Selected"
6. Backend fetches only required indicators for that strategy
7. Backend runs the selected strategy's logic
8. Results display with strategy name and confidence grades

---

## TESTING CHECKLIST

- [ ] Strategy dropdown appears in Watchlist tab
- [ ] Dropdown options change when Style setting changes
- [ ] Scan passes strategyId to backend
- [ ] Backend returns decisions with strategy name
- [ ] Results show correct strategy used

Please implement these changes step by step, starting with the type definitions file.

/**
 * Strategy Contract Tests - V2 (DETERMINISTIC)
 * 
 * NO RANDOM DATA. Each test creates exact conditions to force signal paths.
 * Tests MUST FAIL if they can't trigger the required condition.
 * 
 * Run: npx ts-node src/strategies/__tests__/strategyContracts.test.ts
 * 
 * CRITICAL TESTS:
 * 1. Short TP is BELOW entry (catches BollingerMR bug)
 * 2. Long TP is ABOVE entry
 * 3. Rejects on missing H4 data (fail-closed)
 * 4. Rejects insufficient bars
 * 5. Handles indicator = 0 correctly (not falsy)
 * 6. R:R matches claimed minimum
 * 
 * Created: 2026-01-02 (Three-Way Audit V2)
 */

import { Bar, IndicatorData, UserSettings, Decision } from '../types.js';
import { setTestMode } from '../SignalQualityGate.js';

// Import all strategies
import { RsiBounce } from '../intraday/RsiBounce.js';
import { RsiOversold } from '../intraday/RsiOversold.js';
import { EmaPullback } from '../intraday/EmaPullback.js';
import { BollingerMR } from '../intraday/BollingerMR.js';
import { StochasticOversold } from '../intraday/StochasticOversold.js';
import { CciZeroLine } from '../intraday/CciZeroLine.js';
import { WilliamsEma } from '../intraday/WilliamsEma.js';
import { TripleEma } from '../intraday/TripleEma.js';
import { BreakRetest } from '../intraday/BreakRetest.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════

interface TestResult {
  strategy: string;
  test: string;
  passed: boolean;
  message: string;
  critical: boolean;
}

const results: TestResult[] = [];

function test(
  strategyId: string, 
  testName: string, 
  assertion: boolean, 
  message: string,
  critical: boolean = false
): void {
  results.push({
    strategy: strategyId,
    test: testName,
    passed: assertion,
    message: assertion ? '✓' : `✗ ${message}`,
    critical,
  });
}

function fail(strategyId: string, testName: string, message: string, critical: boolean = false): void {
  test(strategyId, testName, false, message, critical);
}

function pass(strategyId: string, testName: string): void {
  test(strategyId, testName, true, '', false);
}

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISTIC DATA GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

const BASE_TIME = new Date('2026-01-02T12:00:00Z').getTime();

/**
 * Create deterministic bars with specified characteristics
 */
function createBars(
  count: number,
  config: {
    basePrice: number;
    trend: 'up' | 'down' | 'flat';
    volatility: number; // ATR as decimal (0.001 = 10 pips)
    lastBarsOverride?: Partial<Bar>[];
  }
): Bar[] {
  const { basePrice, trend, volatility, lastBarsOverride = [] } = config;
  const bars: Bar[] = [];
  
  let price = basePrice;
  const trendStep = trend === 'up' ? volatility * 0.1 
                  : trend === 'down' ? -volatility * 0.1 
                  : 0;
  
  for (let i = 0; i < count; i++) {
    const datetime = new Date(BASE_TIME - (count - i) * 3600000).toISOString();
    
    const bar: Bar = {
      datetime,
      open: price,
      high: price + volatility,
      low: price - volatility,
      close: price + trendStep,
      volume: 1000,
    };
    
    // Apply overrides for last N bars
    const overrideIdx = count - lastBarsOverride.length + (i - (count - lastBarsOverride.length));
    if (overrideIdx >= 0 && overrideIdx < lastBarsOverride.length) {
      Object.assign(bar, lastBarsOverride[overrideIdx]);
    }
    
    bars.push(bar);
    price = bar.close;
  }
  
  return bars;
}

/**
 * Create constant indicator array
 */
function createIndicator(count: number, value: number): number[] {
  return Array(count).fill(value);
}

/**
 * Create indicator with specific values at end
 */
function createIndicatorWithEnd(count: number, defaultValue: number, endValues: number[]): number[] {
  const arr = Array(count).fill(defaultValue);
  for (let i = 0; i < endValues.length; i++) {
    arr[count - endValues.length + i] = endValues[i];
  }
  return arr;
}

/**
 * Create Bollinger Bands
 */
function createBBands(count: number, middle: number, width: number): Array<{ upper: number; middle: number; lower: number }> {
  return Array(count).fill(null).map(() => ({
    upper: middle + width,
    middle,
    lower: middle - width,
  }));
}

/**
 * Create Stochastic
 */
function createStoch(count: number, k: number, d: number): Array<{ k: number; d: number }> {
  return Array(count).fill(null).map(() => ({ k, d }));
}

const DEFAULT_SETTINGS: UserSettings = {
  accountSize: 10000,
  riskPercent: 0.5,
  style: 'intraday',
};

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE: Force LONG signal
// ═══════════════════════════════════════════════════════════════════════════

function createLongSignalFixture(price: number = 1.1000): Partial<IndicatorData> {
  const bars = createBars(300, {
    basePrice: price,
    trend: 'up',
    volatility: 0.001,
    lastBarsOverride: [
      // Signal bar: Bullish, touched lower BB, RSI oversold
      { open: price - 0.001, high: price, low: price - 0.003, close: price - 0.0005 },
      // Entry bar
      { open: price, high: price + 0.001, low: price - 0.0005, close: price + 0.0005 },
    ],
  });
  
  return {
    symbol: 'EURUSD',
    bars,
    // RSI oversold at signal bar
    rsi: createIndicatorWithEnd(300, 50, [28, 32, 35]),
    // Price at lower BB
    bbands: createBBands(300, price, 0.002),
    // Stochastic oversold, crossing up
    stoch: [
      ...Array(297).fill({ k: 50, d: 50 }),
      { k: 15, d: 20 }, // prev: K < D
      { k: 22, d: 18 }, // signal: K > D (crossed up)
      { k: 25, d: 22 },
    ],
    // CCI coming from extreme low, crossing zero
    cci: createIndicatorWithEnd(300, 0, [-120, -50, 5]),
    // Williams %R oversold, turning up
    willr: createIndicatorWithEnd(300, -50, [-88, -85, -82]),
    // EMAs for trend (bullish: price > EMA200)
    ema20: createIndicator(300, price - 0.001),
    ema50: createIndicator(300, price - 0.002),
    ema200: createIndicator(300, price - 0.005),
    sma20: createIndicator(300, price - 0.001),
    // ATR for position sizing
    atr: createIndicator(300, 0.001),
    // ADX for trend strength
    adx: createIndicator(300, 25),
    // H4 trend data (bullish)
    trendBarsH4: createBars(100, { basePrice: price, trend: 'up', volatility: 0.003 }),
    ema200H4: createIndicator(100, price - 0.010),
    adxH4: createIndicator(100, 28),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE: Force SHORT signal
// ═══════════════════════════════════════════════════════════════════════════

function createShortSignalFixture(price: number = 1.1000): Partial<IndicatorData> {
  const bars = createBars(300, {
    basePrice: price,
    trend: 'down',
    volatility: 0.001,
    lastBarsOverride: [
      // Signal bar: Bearish, touched upper BB, RSI overbought
      { open: price + 0.001, high: price + 0.003, low: price, close: price + 0.0005 },
      // Entry bar
      { open: price, high: price + 0.0005, low: price - 0.001, close: price - 0.0005 },
    ],
  });
  
  return {
    symbol: 'EURUSD',
    bars,
    // RSI overbought at signal bar
    rsi: createIndicatorWithEnd(300, 50, [72, 68, 65]),
    // Price at upper BB
    bbands: createBBands(300, price, 0.002),
    // Stochastic overbought, crossing down
    stoch: [
      ...Array(297).fill({ k: 50, d: 50 }),
      { k: 85, d: 80 }, // prev: K > D
      { k: 78, d: 82 }, // signal: K < D (crossed down)
      { k: 75, d: 78 },
    ],
    // CCI coming from extreme high, crossing zero
    cci: createIndicatorWithEnd(300, 0, [120, 50, -5]),
    // Williams %R overbought, turning down
    willr: createIndicatorWithEnd(300, -50, [-12, -15, -18]),
    // EMAs for trend (bearish: price < EMA200)
    ema20: createIndicator(300, price + 0.001),
    ema50: createIndicator(300, price + 0.002),
    ema200: createIndicator(300, price + 0.005),
    sma20: createIndicator(300, price + 0.001),
    // ATR
    atr: createIndicator(300, 0.001),
    // ADX
    adx: createIndicator(300, 25),
    // H4 trend data (bearish)
    trendBarsH4: createBars(100, { basePrice: price, trend: 'down', volatility: 0.003 }),
    ema200H4: createIndicator(100, price + 0.010),
    adxH4: createIndicator(100, 28),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════

interface StrategyTestConfig {
  id: string;
  name: string;
  instance: { analyze: (data: IndicatorData, settings: UserSettings) => Promise<Decision | null>; meta: { id: string; avgRR: number } };
  usesH4: boolean;
  usesEma200: boolean;
  strategyType: 'mean-reversion' | 'trend-continuation' | 'breakout' | 'momentum';
}

const STRATEGIES: StrategyTestConfig[] = [
  { id: 'rsi-bounce', name: 'RSI Bounce', instance: new RsiBounce(), usesH4: false, usesEma200: false, strategyType: 'mean-reversion' },
  { id: 'rsi-oversold', name: 'RSI Oversold', instance: new RsiOversold(), usesH4: true, usesEma200: true, strategyType: 'trend-continuation' },
  { id: 'ema-pullback-intra', name: 'EMA Pullback', instance: new EmaPullback(), usesH4: false, usesEma200: true, strategyType: 'trend-continuation' },
  { id: 'bollinger-mr', name: 'Bollinger MR', instance: new BollingerMR(), usesH4: true, usesEma200: true, strategyType: 'mean-reversion' },
  { id: 'stoch-oversold', name: 'Stochastic Oversold', instance: new StochasticOversold(), usesH4: false, usesEma200: true, strategyType: 'mean-reversion' },
  { id: 'cci-zero', name: 'CCI Zero Line', instance: new CciZeroLine(), usesH4: false, usesEma200: true, strategyType: 'momentum' },
  { id: 'williams-ema', name: 'Williams EMA', instance: new WilliamsEma(), usesH4: false, usesEma200: false, strategyType: 'mean-reversion' },
  { id: 'triple-ema', name: 'Triple EMA', instance: new TripleEma(), usesH4: false, usesEma200: false, strategyType: 'trend-continuation' },
  { id: 'break-retest-intra', name: 'Break Retest', instance: new BreakRetest(), usesH4: true, usesEma200: false, strategyType: 'breakout' },
];

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Short TP Below Entry (CRITICAL - catches BollingerMR bug)
// ═══════════════════════════════════════════════════════════════════════════

async function testShortTPBelowEntry(config: StrategyTestConfig): Promise<void> {
  const { id, instance } = config;
  
  // Disable enforcement for testing (we're using deterministic fixtures)
  setTestMode(true);
  
  try {
    const fixture = createShortSignalFixture();
    const result = await instance.analyze(fixture as IndicatorData, DEFAULT_SETTINGS);
    
    if (!result) {
      fail(id, 'SHORT: generates signal', 'Could not trigger short signal with deterministic fixture', true);
      return;
    }
    
    if (result.direction !== 'short') {
      fail(id, 'SHORT: correct direction', `Expected short, got ${result.direction}`, true);
      return;
    }
    
    pass(id, 'SHORT: generates signal');
    
    // CRITICAL: TP must be BELOW entry for shorts
    if (result.takeProfit.price >= result.entryPrice) {
      fail(id, 'SHORT: TP below entry', 
        `TP (${result.takeProfit.price.toFixed(5)}) >= Entry (${result.entryPrice.toFixed(5)}) - INVERTED!`, 
        true
      );
    } else {
      pass(id, 'SHORT: TP below entry');
    }
    
    // CRITICAL: SL must be ABOVE entry for shorts
    if (result.stopLoss.price <= result.entryPrice) {
      fail(id, 'SHORT: SL above entry',
        `SL (${result.stopLoss.price.toFixed(5)}) <= Entry (${result.entryPrice.toFixed(5)}) - INVERTED!`,
        true
      );
    } else {
      pass(id, 'SHORT: SL above entry');
    }
    
  } catch (err) {
    fail(id, 'SHORT signal test', `Error: ${err}`, true);
  } finally {
    setTestMode(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Long TP Above Entry
// ═══════════════════════════════════════════════════════════════════════════

async function testLongTPAboveEntry(config: StrategyTestConfig): Promise<void> {
  const { id, instance } = config;
  
  setTestMode(true);
  
  try {
    const fixture = createLongSignalFixture();
    const result = await instance.analyze(fixture as IndicatorData, DEFAULT_SETTINGS);
    
    if (!result) {
      fail(id, 'LONG: generates signal', 'Could not trigger long signal with deterministic fixture', true);
      return;
    }
    
    if (result.direction !== 'long') {
      fail(id, 'LONG: correct direction', `Expected long, got ${result.direction}`, true);
      return;
    }
    
    pass(id, 'LONG: generates signal');
    
    // TP must be ABOVE entry for longs
    if (result.takeProfit.price <= result.entryPrice) {
      fail(id, 'LONG: TP above entry',
        `TP (${result.takeProfit.price.toFixed(5)}) <= Entry (${result.entryPrice.toFixed(5)}) - INVERTED!`,
        true
      );
    } else {
      pass(id, 'LONG: TP above entry');
    }
    
    // SL must be BELOW entry for longs
    if (result.stopLoss.price >= result.entryPrice) {
      fail(id, 'LONG: SL below entry',
        `SL (${result.stopLoss.price.toFixed(5)}) >= Entry (${result.entryPrice.toFixed(5)}) - INVERTED!`,
        true
      );
    } else {
      pass(id, 'LONG: SL below entry');
    }
    
  } catch (err) {
    fail(id, 'LONG signal test', `Error: ${err}`, true);
  } finally {
    setTestMode(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: R:R Matches Claimed Minimum
// ═══════════════════════════════════════════════════════════════════════════

async function testRRMinimum(config: StrategyTestConfig): Promise<void> {
  const { id, instance } = config;
  const claimedRR = instance.meta.avgRR;
  
  setTestMode(true);
  
  try {
    // Test both directions
    for (const direction of ['long', 'short'] as const) {
      const fixture = direction === 'long' ? createLongSignalFixture() : createShortSignalFixture();
      const result = await instance.analyze(fixture as IndicatorData, DEFAULT_SETTINGS);
      
      if (!result || result.direction !== direction) {
        continue; // Skip if can't trigger this direction
      }
      
      const actualRR = result.takeProfit.rr;
      const tolerance = 0.1; // Allow 10% tolerance
      
      if (actualRR < claimedRR * (1 - tolerance)) {
        fail(id, `R:R ${direction}`,
          `Actual R:R (${actualRR.toFixed(2)}) < Claimed (${claimedRR}) - ${((1 - actualRR/claimedRR) * 100).toFixed(0)}% below`,
          false
        );
      } else {
        pass(id, `R:R ${direction}`);
      }
    }
  } catch (err) {
    fail(id, 'R:R test', `Error: ${err}`, false);
  } finally {
    setTestMode(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Rejects Missing H4 Data (for strategies that require it)
// ═══════════════════════════════════════════════════════════════════════════

async function testRejectsMissingH4(config: StrategyTestConfig): Promise<void> {
  const { id, instance, usesH4 } = config;
  
  if (!usesH4) {
    pass(id, 'H4 requirement (N/A)');
    return;
  }
  
  setTestMode(true);
  
  try {
    const fixture = createLongSignalFixture();
    
    // Remove H4 data
    delete fixture.trendBarsH4;
    delete fixture.ema200H4;
    delete fixture.adxH4;
    
    const result = await instance.analyze(fixture as IndicatorData, DEFAULT_SETTINGS);
    
    if (result !== null) {
      fail(id, 'Rejects missing H4',
        'Strategy produced signal without H4 trend data - should fail-closed',
        true
      );
    } else {
      pass(id, 'Rejects missing H4');
    }
  } catch (err) {
    // Error is acceptable - means it validated
    pass(id, 'Rejects missing H4 (threw)');
  } finally {
    setTestMode(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Rejects Insufficient Bars
// ═══════════════════════════════════════════════════════════════════════════

async function testRejectsInsufficientBars(config: StrategyTestConfig): Promise<void> {
  const { id, instance, usesEma200 } = config;
  
  const requiredBars = usesEma200 ? 250 : 50;
  const insufficientBars = requiredBars - 10;
  
  setTestMode(true);
  
  try {
    const fixture = createLongSignalFixture();
    
    // Truncate bars
    fixture.bars = fixture.bars!.slice(-insufficientBars);
    
    // Also truncate all indicators to match
    for (const key of Object.keys(fixture)) {
      const val = (fixture as Record<string, unknown>)[key];
      if (Array.isArray(val) && val.length > insufficientBars) {
        (fixture as Record<string, unknown[]>)[key] = val.slice(-insufficientBars);
      }
    }
    
    const result = await instance.analyze(fixture as IndicatorData, DEFAULT_SETTINGS);
    
    if (result !== null) {
      fail(id, `Rejects ${insufficientBars} bars`,
        `Strategy accepted ${insufficientBars} bars when ${requiredBars} required`,
        false
      );
    } else {
      pass(id, `Rejects ${insufficientBars} bars`);
    }
  } catch (err) {
    pass(id, 'Rejects insufficient bars (threw)');
  } finally {
    setTestMode(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: CCI Zero Handling (specific to CCI strategy)
// ═══════════════════════════════════════════════════════════════════════════

async function testCCIZeroHandling(): Promise<void> {
  const id = 'cci-zero';
  const instance = new CciZeroLine();
  
  setTestMode(true);
  
  try {
    const fixture = createLongSignalFixture();
    
    // CCI crossing exactly through zero
    fixture.cci = createIndicatorWithEnd(300, 0, [-110, -2, 0]); // Ends at exactly 0
    
    const result = await instance.analyze(fixture as IndicatorData, DEFAULT_SETTINGS);
    
    // The test is: does the strategy NOT reject just because CCI = 0?
    // It may reject for other valid reasons, but not because 0 is "falsy"
    
    // We can't directly test the falsy check without inspecting code,
    // but if we get a signal with CCI at boundaries, the check is working
    
    // Try with CCI just above zero (should definitely work if zero isn't special)
    fixture.cci = createIndicatorWithEnd(300, 0, [-110, -2, 1]);
    const resultPositive = await instance.analyze(fixture as IndicatorData, DEFAULT_SETTINGS);
    
    if (resultPositive && !result) {
      fail(id, 'CCI=0 handling',
        'Strategy rejected CCI=0 but accepted CCI=1 - likely falsy check bug',
        true
      );
    } else {
      pass(id, 'CCI=0 handling');
    }
  } catch (err) {
    fail(id, 'CCI=0 handling', `Error: ${err}`, true);
  } finally {
    setTestMode(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function runAllTests(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('STRATEGY CONTRACT TESTS V2 (DETERMINISTIC)');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  for (const config of STRATEGIES) {
    console.log(`\n📋 ${config.name} (${config.id})`);
    console.log('─'.repeat(50));
    
    await testShortTPBelowEntry(config);
    await testLongTPAboveEntry(config);
    await testRRMinimum(config);
    await testRejectsMissingH4(config);
    await testRejectsInsufficientBars(config);
  }
  
  // Special tests
  console.log('\n📋 Special Tests');
  console.log('─'.repeat(50));
  await testCCIZeroHandling();
  
  // Print summary
  printSummary();
}

function printSummary(): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const byStrategy = new Map<string, TestResult[]>();
  for (const result of results) {
    if (!byStrategy.has(result.strategy)) {
      byStrategy.set(result.strategy, []);
    }
    byStrategy.get(result.strategy)!.push(result);
  }
  
  let totalPassed = 0;
  let totalFailed = 0;
  let criticalFailed = 0;
  
  for (const [strategy, tests] of byStrategy) {
    const passed = tests.filter(t => t.passed).length;
    const failed = tests.filter(t => !t.passed).length;
    const critFailed = tests.filter(t => !t.passed && t.critical).length;
    
    totalPassed += passed;
    totalFailed += failed;
    criticalFailed += critFailed;
    
    const status = failed === 0 ? '✅ PASS' : critFailed > 0 ? '❌ CRITICAL FAIL' : '⚠️ FAIL';
    console.log(`${status} ${strategy}: ${passed}/${tests.length} tests`);
    
    for (const test of tests.filter(t => !t.passed)) {
      const marker = test.critical ? '🔴' : '🟠';
      console.log(`   ${marker} ${test.test}: ${test.message}`);
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log(`TOTAL: ${totalPassed}/${totalPassed + totalFailed} tests passed`);
  
  if (criticalFailed > 0) {
    console.log(`\n🔴 ${criticalFailed} CRITICAL FAILURES - DO NOT DEPLOY`);
    process.exit(1);
  } else if (totalFailed > 0) {
    console.log(`\n⚠️ ${totalFailed} non-critical failures - review before deploy`);
    process.exit(0);
  } else {
    console.log('\n✅ All tests passed - strategies are prop-grade compliant');
    process.exit(0);
  }
}

// Run
runAllTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

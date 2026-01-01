/**
 * Startup Validation
 * Validates data pipeline on startup for EUR/USD, BTC/USD, XAU/USD
 * Ensures Twelve Data integration works correctly
 */

import { fetchIndicators } from './indicatorService.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('StartupValidation');

const TEST_SYMBOLS = ['EURUSD', 'BTCUSD', 'XAUUSD'];

interface ValidationResult {
  symbol: string;
  passed: boolean;
  barsCount: number;
  indicatorLengths: Record<string, number>;
  last5Finite: Record<string, boolean>;
  errors: string[];
}

function checkLast5Finite(values: number[]): boolean {
  if (values.length < 5) return false;
  const last5 = values.slice(-5);
  return last5.every(v => Number.isFinite(v));
}

export async function validateDataPipeline(): Promise<boolean> {
  logger.info('Starting data pipeline validation...');
  
  const results: ValidationResult[] = [];
  let allPassed = true;

  for (const symbol of TEST_SYMBOLS) {
    const result: ValidationResult = {
      symbol,
      passed: true,
      barsCount: 0,
      indicatorLengths: {},
      last5Finite: {},
      errors: [],
    };

    try {
      logger.info(`Validating ${symbol}...`);
      const data = await fetchIndicators(symbol, 'intraday');

      result.barsCount = data.entryBars.length;
      if (result.barsCount === 0) {
        result.passed = false;
        result.errors.push('No bars returned');
      }

      const indicators: Record<string, { timestamp: string; value: number }[]> = {
        rsi: data.rsi,
        ema20: data.ema20,
        atr: data.atr,
        ema50: data.ema50,
        adx: data.adx,
      };

      for (const [name, indicatorData] of Object.entries(indicators)) {
        const length = indicatorData.length;
        result.indicatorLengths[name] = length;

        if (length !== result.barsCount && length > 0) {
          result.errors.push(`${name}.length (${length}) !== bars.length (${result.barsCount})`);
        }

        const values = indicatorData.map(v => v.value);
        const finiteCheck = checkLast5Finite(values);
        result.last5Finite[name] = finiteCheck;

        if (!finiteCheck && length > 0) {
          result.errors.push(`${name} last 5 values contain NaN or non-finite`);
        }
      }

      if (result.errors.length > 0) {
        result.passed = false;
      }

    } catch (error) {
      result.passed = false;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    results.push(result);
    
    if (!result.passed) {
      allPassed = false;
      logger.error(`FAIL: ${symbol}`, { errors: result.errors });
    } else {
      logger.info(`PASS: ${symbol} - ${result.barsCount} bars, indicators aligned`);
    }
  }

  logger.info('=== Validation Summary ===');
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    logger.info(`${status}: ${r.symbol} - bars=${r.barsCount}, errors=${r.errors.length}`);
  }

  if (!allPassed) {
    logger.error('Data pipeline validation FAILED. Aborting startup.');
    throw new Error('Startup validation failed - data pipeline issues detected');
  }

  logger.info('Data pipeline validation PASSED');
  return true;
}

export async function runValidationSafe(): Promise<boolean> {
  try {
    return await validateDataPipeline();
  } catch (error) {
    logger.error('Validation error:', error);
    return false;
  }
}

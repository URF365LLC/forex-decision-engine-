/**
 * Backtest Service
 * Validates historical signals against actual price data
 * Determines if TP1/TP2 or SL was hit first
 */

import { createLogger } from './logger.js';
import { signalStore, StoredSignal, SignalResult } from '../storage/signalStore.js';
import { toDataSymbol, getInstrumentSpec } from '../config/e8InstrumentSpecs.js';
import { rateLimiter } from './rateLimiter.js';

const logger = createLogger('Backtest');

const API_KEY = process.env.TWELVE_DATA_API_KEY || '';
const DEFAULT_CRYPTO_EXCHANGE = process.env.TWELVE_DATA_CRYPTO_EXCHANGE || 'Binance';

interface BacktestResult {
  signalId: string;
  symbol: string;
  direction: string;
  grade: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  result: SignalResult;
  exitPrice: number | null;
  exitTime: string | null;
  pnlPips: number | null;
  rMultiple: number | null;
  barsToExit: number | null;
  reason: string;
}

interface BacktestSummary {
  total: number;
  wins: number;
  losses: number;
  breakeven: number;
  pending: number;
  winRate: number;
  avgRMultiple: number;
  byGrade: Record<string, { wins: number; losses: number; winRate: number }>;
  results: BacktestResult[];
}

interface OHLCBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

async function fetchHistoricalBars(
  symbol: string,
  startDate: string,
  endDate: string,
  interval: string = '1h'
): Promise<OHLCBar[]> {
  const spec = getInstrumentSpec(symbol);
  const dataSymbol = toDataSymbol(symbol);
  
  let url = `https://api.twelvedata.com/time_series?symbol=${dataSymbol}&interval=${interval}&start_date=${startDate}&end_date=${endDate}&apikey=${API_KEY}&outputsize=500`;
  
  if (spec?.type === 'crypto') {
    url += `&exchange=${DEFAULT_CRYPTO_EXCHANGE}`;
  }
  
  await rateLimiter.acquire();
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status === 'error') {
    throw new Error(data.message || 'Failed to fetch historical data');
  }
  
  if (!data.values || !Array.isArray(data.values)) {
    return [];
  }
  
  return data.values.map((bar: Record<string, string>) => ({
    datetime: bar.datetime,
    open: parseFloat(bar.open),
    high: parseFloat(bar.high),
    low: parseFloat(bar.low),
    close: parseFloat(bar.close),
  })).reverse();
}

function simulateTrade(
  bars: OHLCBar[],
  entry: number,
  stopLoss: number,
  takeProfit: number,
  direction: string
): { result: SignalResult; exitPrice: number | null; exitTime: string | null; barsToExit: number | null; reason: string } {
  const isLong = direction === 'long';
  
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    
    if (isLong) {
      if (bar.low <= stopLoss) {
        return {
          result: 'loss',
          exitPrice: stopLoss,
          exitTime: bar.datetime,
          barsToExit: i + 1,
          reason: 'Stop loss hit',
        };
      }
      if (bar.high >= takeProfit) {
        return {
          result: 'win',
          exitPrice: takeProfit,
          exitTime: bar.datetime,
          barsToExit: i + 1,
          reason: 'Take profit hit',
        };
      }
    } else {
      if (bar.high >= stopLoss) {
        return {
          result: 'loss',
          exitPrice: stopLoss,
          exitTime: bar.datetime,
          barsToExit: i + 1,
          reason: 'Stop loss hit',
        };
      }
      if (bar.low <= takeProfit) {
        return {
          result: 'win',
          exitPrice: takeProfit,
          exitTime: bar.datetime,
          barsToExit: i + 1,
          reason: 'Take profit hit',
        };
      }
    }
  }
  
  return {
    result: null,
    exitPrice: null,
    exitTime: null,
    barsToExit: null,
    reason: 'Trade still open or data insufficient',
  };
}

function calculatePnlPips(entry: number, exit: number, direction: string, symbol: string): number {
  const spec = getInstrumentSpec(symbol);
  const pipSize = spec?.pipSize || 0.0001;
  const diff = direction === 'long' ? exit - entry : entry - exit;
  return Math.round(diff / pipSize);
}

function calculateRMultiple(entry: number, exit: number, stopLoss: number, direction: string): number {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return 0;
  const reward = direction === 'long' ? exit - entry : entry - exit;
  return Math.round((reward / risk) * 100) / 100;
}

export async function backtestSignal(signal: StoredSignal): Promise<BacktestResult | null> {
  if (!signal.entry_low || !signal.stop_loss || !signal.take_profit) {
    logger.warn(`Signal ${signal.uuid} missing entry/SL/TP data`);
    return null;
  }
  
  const signalTime = new Date(signal.created_at);
  const now = new Date();
  const lookAheadHours = 48;
  const endTime = new Date(signalTime.getTime() + lookAheadHours * 60 * 60 * 1000);
  
  if (endTime > now) {
    logger.debug(`Signal ${signal.uuid} too recent for complete backtest`);
  }
  
  const startDate = signalTime.toISOString().split('T')[0] + ' ' + signalTime.toISOString().split('T')[1].substring(0, 5);
  const effectiveEnd = endTime > now ? now : endTime;
  const endDate = effectiveEnd.toISOString().split('T')[0] + ' ' + effectiveEnd.toISOString().split('T')[1].substring(0, 5);
  
  try {
    const bars = await fetchHistoricalBars(signal.symbol, startDate, endDate, '15min');
    
    if (bars.length === 0) {
      logger.warn(`No historical data for ${signal.symbol} from ${startDate}`);
      return {
        signalId: signal.uuid || String(signal.id),
        symbol: signal.symbol,
        direction: signal.direction,
        grade: signal.grade,
        entry: signal.entry_low,
        stopLoss: signal.stop_loss,
        takeProfit: signal.take_profit,
        result: null,
        exitPrice: null,
        exitTime: null,
        pnlPips: null,
        rMultiple: null,
        barsToExit: null,
        reason: 'No historical data available',
      };
    }
    
    const simulation = simulateTrade(
      bars,
      signal.entry_low,
      signal.stop_loss,
      signal.take_profit,
      signal.direction
    );
    
    let pnlPips: number | null = null;
    let rMultiple: number | null = null;
    
    if (simulation.exitPrice !== null) {
      pnlPips = calculatePnlPips(signal.entry_low, simulation.exitPrice, signal.direction, signal.symbol);
      rMultiple = calculateRMultiple(signal.entry_low, simulation.exitPrice, signal.stop_loss, signal.direction);
    }
    
    return {
      signalId: signal.uuid || String(signal.id),
      symbol: signal.symbol,
      direction: signal.direction,
      grade: signal.grade,
      entry: signal.entry_low,
      stopLoss: signal.stop_loss,
      takeProfit: signal.take_profit,
      result: simulation.result,
      exitPrice: simulation.exitPrice,
      exitTime: simulation.exitTime,
      pnlPips,
      rMultiple,
      barsToExit: simulation.barsToExit,
      reason: simulation.reason,
    };
  } catch (error) {
    logger.error(`Failed to backtest signal ${signal.uuid}`, { error });
    return null;
  }
}

export async function runBacktest(options: {
  grade?: string;
  symbol?: string;
  limit?: number;
  updateResults?: boolean;
}): Promise<BacktestSummary> {
  const { grade, symbol, limit = 50, updateResults = false } = options;
  
  logger.info(`Starting backtest`, { grade, symbol, limit, updateResults });
  
  let signals: StoredSignal[];
  
  if (grade) {
    signals = await signalStore.getByGrade(grade, limit);
  } else if (symbol) {
    signals = await signalStore.getBySymbol(symbol, limit);
  } else {
    signals = await signalStore.getRecent(limit);
  }
  
  signals = signals.filter(s => 
    s.entry_low && s.stop_loss && s.take_profit && 
    new Date(s.created_at) < new Date(Date.now() - 4 * 60 * 60 * 1000)
  );
  
  logger.info(`Backtesting ${signals.length} signals`);
  
  const results: BacktestResult[] = [];
  const byGrade: Record<string, { wins: number; losses: number; total: number }> = {};
  
  for (const signal of signals) {
    const result = await backtestSignal(signal);
    if (result) {
      results.push(result);
      
      if (!byGrade[result.grade]) {
        byGrade[result.grade] = { wins: 0, losses: 0, total: 0 };
      }
      byGrade[result.grade].total++;
      
      if (result.result === 'win') {
        byGrade[result.grade].wins++;
      } else if (result.result === 'loss') {
        byGrade[result.grade].losses++;
      }
      
      if (updateResults && result.result && signal.uuid) {
        await signalStore.updateResult(signal.uuid, result.result, result.reason);
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  const wins = results.filter(r => r.result === 'win').length;
  const losses = results.filter(r => r.result === 'loss').length;
  const breakeven = results.filter(r => r.result === 'breakeven').length;
  const pending = results.filter(r => r.result === null).length;
  
  const rMultiples = results.filter(r => r.rMultiple !== null).map(r => r.rMultiple as number);
  const avgRMultiple = rMultiples.length > 0 
    ? Math.round((rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length) * 100) / 100
    : 0;
  
  const gradeStats: Record<string, { wins: number; losses: number; winRate: number }> = {};
  for (const [g, stats] of Object.entries(byGrade)) {
    const total = stats.wins + stats.losses;
    gradeStats[g] = {
      wins: stats.wins,
      losses: stats.losses,
      winRate: total > 0 ? Math.round((stats.wins / total) * 100) : 0,
    };
  }
  
  const summary: BacktestSummary = {
    total: results.length,
    wins,
    losses,
    breakeven,
    pending,
    winRate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
    avgRMultiple,
    byGrade: gradeStats,
    results,
  };
  
  logger.info(`Backtest complete`, { 
    total: summary.total, 
    wins: summary.wins, 
    losses: summary.losses,
    winRate: summary.winRate,
  });
  
  return summary;
}

export default { runBacktest, backtestSignal };

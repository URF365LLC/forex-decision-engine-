import { z } from 'zod';

export const SettingsSchema = z.object({
  accountSize: z.number().min(100).max(10000000).optional(),
  accountBalance: z.number().min(100).max(10000000).optional(),
  equity: z.number().min(100).max(10000000).optional(),
  riskPercent: z.number().min(0.1).max(5).optional(),
  riskPerTrade: z.number().min(0.1).max(5).optional(),
  style: z.enum(['conservative', 'moderate', 'aggressive', 'intraday', 'swing']).optional(),
  paperTrading: z.boolean().optional(),
  accountId: z.string().optional(),
  startOfDayEquity: z.number().optional(),
  peakEquity: z.number().optional(),
  dailyLossLimitPct: z.number().optional(),
  maxDrawdownPct: z.number().optional(),
}).passthrough();

export const ScanRequestSchema = z.object({
  symbols: z.array(z.string().min(1).max(20)).min(1).max(46),
  strategyId: z.string().min(1),
  settings: SettingsSchema.optional(),
  force: z.boolean().optional(),
});

export const AutoScanStartSchema = z.object({
  minGrade: z.enum(['A+', 'A', 'B+', 'B', 'C']).optional().default('B'),
  email: z.string().email().optional().or(z.literal('')),
  intervalMs: z.number().min(60000).max(3600000).optional(),
  symbols: z.array(z.string()).optional(),
  strategies: z.array(z.string()).optional(),
  watchlistPreset: z.enum(['majors', 'majors-gold', 'crypto', 'metals', 'indices', 'commodities', 'minors', 'all', 'custom']).optional(),
  customSymbols: z.array(z.string()).optional(),
  respectMarketHours: z.boolean().optional(),
});

export const AutoScanConfigSchema = z.object({
  minGrade: z.enum(['A+', 'A', 'B+', 'B', 'C']).optional(),
  email: z.string().email().optional().or(z.literal('')),
  intervalMs: z.number().min(60000).max(3600000).optional(),
  symbols: z.array(z.string()).optional(),
  strategies: z.array(z.string()).optional(),
  watchlistPreset: z.enum(['majors', 'majors-gold', 'crypto', 'metals', 'indices', 'commodities', 'minors', 'all', 'custom']).optional(),
  customSymbols: z.array(z.string()).optional(),
  respectMarketHours: z.boolean().optional(),
});

export const JournalEntrySchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short']),
  action: z.enum(['taken', 'skipped', 'missed']),
  source: z.enum(['signal', 'manual']).optional(),
  style: z.string().optional(),
  grade: z.string().optional(),
  strategyId: z.string().optional(),
  strategyName: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  reasonCodes: z.array(z.string()).optional(),
  entry: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit1: z.number().positive().optional(),
  takeProfit2: z.number().positive().optional(),
  lotSize: z.number().positive().optional(),
  positionRisk: z.number().optional(),
  notes: z.string().max(2000).optional(),
}).passthrough();

export const BatchSentimentSchema = z.object({
  symbols: z.array(z.string().min(1).max(20)).min(1).max(10),
});

export const JournalUpdateSchema = z.object({
  status: z.enum(['pending', 'running', 'closed']).optional(),
  actualEntry: z.number().positive().optional(),
  actualExit: z.number().positive().optional(),
  exitPrice: z.number().positive().optional(),
  entryPrice: z.number().positive().optional(),
  result: z.enum(['win', 'loss', 'breakeven']).optional(),
  rMultiple: z.number().optional(),
  pnlDollars: z.number().optional(),
  pnlPips: z.number().optional(),
  notes: z.string().max(2000).optional(),
  closedAt: z.string().optional(),
}).passthrough();

export const SignalUpdateSchema = z.object({
  result: z.enum(['win', 'loss', 'breakeven']),
  notes: z.string().max(500).optional(),
});


export const SentimentRequestSchema = z.object({
  symbol: z.string().min(1).max(20),
  style: z.enum(['conservative', 'moderate', 'aggressive', 'intraday', 'swing']).optional(),
});

export const JournalExportSchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const PaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().min(0).optional().default(0),
});

// ═══════════════════════════════════════════════════════════════
// QUERY PARAMETER SCHEMAS
// ═══════════════════════════════════════════════════════════════

export const StrategiesQuerySchema = z.object({
  style: z.enum(['intraday', 'swing']).optional().default('intraday'),
});

export const SignalsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  grade: z.enum(['A+', 'A', 'B+', 'B', 'C', 'no-trade']).optional(),
  symbol: z.string().min(1).max(20).optional(),
});

export const JournalQuerySchema = z.object({
  symbol: z.string().min(1).max(20).optional(),
  status: z.enum(['pending', 'running', 'closed']).optional(),
  result: z.enum(['win', 'loss', 'breakeven']).optional(),
  action: z.enum(['taken', 'skipped', 'missed']).optional(),
  tradeType: z.enum(['pullback', 'counter-trend', 'liquidity-grab', 'exhaustion', 'other']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const JournalStatsQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const UpgradesQuerySchema = z.object({
  minutes: z.coerce.number().min(1).max(1440).optional().default(60),
});

export const AggregatedSentimentQuerySchema = z.object({
  samples: z.coerce.number().min(2).max(5).optional().default(3),
});

export const DetectionsQuerySchema = z.object({
  status: z.string().optional(),
  strategyId: z.string().optional(),
  symbol: z.string().min(1).max(20).optional(),
  grade: z.enum(['A+', 'A', 'B+', 'B', 'C']).optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

export const DetectionExecuteSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const DetectionDismissSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const SymbolParamSchema = z.object({
  symbol: z.string().min(1).max(20).transform(s => s.toUpperCase()),
});

export const IdParamSchema = z.object({
  id: z.string().min(1).max(50),
});

export const EnvSchema = z.object({
  TWELVE_DATA_API_KEY: z.string().min(1, 'TWELVE_DATA_API_KEY is required'),
  PORT: z.coerce.number().min(1).max(65535).optional().default(5000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
  TWELVE_DATA_CRYPTO_EXCHANGE: z.string().optional().default('Binance'),
  RESEND_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
});

export type ScanRequest = z.infer<typeof ScanRequestSchema>;
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
export type JournalUpdate = z.infer<typeof JournalUpdateSchema>;
export type SignalUpdate = z.infer<typeof SignalUpdateSchema>;
export type AutoScanConfig = z.infer<typeof AutoScanConfigSchema>;
export type AutoScanStart = z.infer<typeof AutoScanStartSchema>;
export type SentimentRequest = z.infer<typeof SentimentRequestSchema>;

/**
 * Detection Types
 * Types for the auto-scan detected trades cache and cooldown workflow
 */

import { Decision as StrategyDecision } from '../strategies/types.js';

// ═══════════════════════════════════════════════════════════════
// DETECTION STATUS
// ═══════════════════════════════════════════════════════════════

export type DetectionStatus =
  | 'cooling_down'   // Just detected, in 60-minute cooldown period
  | 'eligible'       // Cooldown complete, ready for action
  | 'executed'       // User took the trade
  | 'dismissed'      // User explicitly dismissed
  | 'expired'        // Signal validity window passed
  | 'invalidated';   // Market conditions changed (e.g., direction flip)

// ═══════════════════════════════════════════════════════════════
// DETECTED TRADE (for UI/API)
// ═══════════════════════════════════════════════════════════════

export interface TieredExitInfo {
  level: number;
  price: number;
  pips: number;
  rr: number;
  formatted: string;
  action: string;
  description: string;
}

export interface DetectedTrade {
  id: string;
  symbol: string;
  strategyId: string;
  strategyName: string;
  grade: string;
  direction: 'long' | 'short';
  confidence: number;

  // Prices
  entry: {
    price: number;
    formatted: string;
  };
  stopLoss: {
    price: number;
    formatted: string;
  } | null;
  takeProfit: {
    price: number;
    formatted: string;
  } | null;

  // Position sizing
  lotSize: number | null;
  riskAmount: number | null;  // Dollar risk

  // Tiered exit management (TP1, TP2, runner)
  tieredExits: TieredExitInfo[] | null;

  // Detection lifecycle
  firstDetectedAt: string;  // ISO timestamp
  lastDetectedAt: string;   // ISO timestamp
  detectionCount: number;   // How many scans confirmed this signal
  cooldownEndsAt: string;   // ISO timestamp

  // Data freshness - when the current bar closes
  barExpiresAt: string | null;  // ISO timestamp of current candle close

  // Status
  status: DetectionStatus;
  statusChangedAt?: string;
  statusReason?: string;

  // Original decision (frozen at first detection)
  reason: string;
  triggers: string[];

  // Metadata
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// INPUT TYPES
// ═══════════════════════════════════════════════════════════════

export interface CreateDetectionInput {
  symbol: string;
  strategyId: string;
  strategyName: string;
  grade: string;
  direction: 'long' | 'short';
  confidence: number;
  entryPrice: number;
  entryFormatted: string;
  stopLoss: number | null;
  stopLossFormatted: string | null;
  takeProfit: number | null;
  takeProfitFormatted: string | null;
  reason: string;
  triggers: string[];
  cooldownMinutes?: number;  // Default: 60
  // Position sizing
  lotSize?: number | null;
  riskAmount?: number | null;
  // Tiered exits
  tieredExits?: TieredExitInfo[] | null;
  // Data freshness
  barExpiresAt?: string | null;
}

export interface UpdateDetectionInput {
  lastDetectedAt?: string;
  detectionCount?: number;
  status?: DetectionStatus;
  statusReason?: string;
  grade?: string;
  confidence?: number;
}

// ═══════════════════════════════════════════════════════════════
// QUERY FILTERS
// ═══════════════════════════════════════════════════════════════

export interface DetectionFilters {
  status?: DetectionStatus | DetectionStatus[];
  strategyId?: string;
  symbol?: string;
  grade?: string;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════
// CONVERSION HELPERS
// ═══════════════════════════════════════════════════════════════

export function convertDecisionToDetection(
  decision: StrategyDecision,
  cooldownMinutes: number = 60
): CreateDetectionInput {
  const now = new Date();
  const cooldownEndsAt = new Date(now.getTime() + cooldownMinutes * 60 * 1000);

  // Extract tiered exits from exit management
  const tieredExits: TieredExitInfo[] | null = decision.exitManagement?.tieredExits?.map(te => ({
    level: te.level,
    price: te.price,
    pips: te.pips,
    rr: te.rr,
    formatted: te.formatted,
    action: te.action,
    description: te.description,
  })) ?? null;

  // Calculate bar expiration (next hour boundary for H1 timeframe)
  const barExpiresAt = calculateBarExpiration('1h');

  return {
    symbol: decision.symbol,
    strategyId: decision.strategyId,
    strategyName: decision.strategyName,
    grade: decision.grade,
    direction: decision.direction,
    confidence: decision.confidence,
    entryPrice: decision.entry?.price ?? decision.entryPrice ?? 0,
    entryFormatted: decision.entry?.formatted ?? String(decision.entryPrice),
    stopLoss: decision.stopLoss?.price ?? null,
    stopLossFormatted: decision.stopLoss?.formatted ?? null,
    takeProfit: decision.takeProfit?.price ?? null,
    takeProfitFormatted: decision.takeProfit?.formatted ?? null,
    reason: decision.reason,
    triggers: decision.triggers,
    cooldownMinutes,
    // Position sizing from decision
    lotSize: decision.position?.lots ?? null,
    riskAmount: decision.position?.riskAmount ?? null,
    // Tiered exits
    tieredExits,
    // Bar expiration for data freshness
    barExpiresAt,
  };
}

function calculateBarExpiration(timeframe: string): string {
  const now = new Date();
  
  switch (timeframe) {
    case '1h':
      // Next hour boundary
      const nextHour = new Date(now);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      return nextHour.toISOString();
    case '4h':
      // Next 4-hour boundary (0, 4, 8, 12, 16, 20)
      const next4h = new Date(now);
      next4h.setMinutes(0, 0, 0);
      const currentHour = next4h.getHours();
      const next4hHour = Math.ceil((currentHour + 1) / 4) * 4;
      next4h.setHours(next4hHour);
      return next4h.toISOString();
    default:
      // Default to next hour
      const defaultNext = new Date(now);
      defaultNext.setMinutes(0, 0, 0);
      defaultNext.setHours(defaultNext.getHours() + 1);
      return defaultNext.toISOString();
  }
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY TYPES
// ═══════════════════════════════════════════════════════════════

export interface DetectionSummary {
  total: number;
  byStatus: Record<DetectionStatus, number>;
  byStrategy: Record<string, number>;
  coolingDown: number;
  eligible: number;
}

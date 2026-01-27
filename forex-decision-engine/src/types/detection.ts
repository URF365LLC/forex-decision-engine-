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
  | 'taken'          // User took the trade (unified terminology)
  | 'executed'       // DEPRECATED: Use 'taken' - kept for backwards compatibility
  | 'dismissed'      // User explicitly dismissed
  | 'expired'        // Signal validity window passed
  | 'invalidated';   // Market conditions changed (e.g., direction flip)

// Terminal statuses (trade lifecycle complete)
export const TERMINAL_STATUSES: DetectionStatus[] = ['taken', 'executed', 'dismissed', 'expired', 'invalidated'];

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
  
  // Give signals a minimum 2-hour validity window from detection time
  // This ensures signals stay visible long enough for traders to act on them
  switch (timeframe) {
    case '1h':
      // Minimum 2 hours from now
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      return twoHoursLater.toISOString();
    case '4h':
      // Minimum 4 hours from now for 4h signals
      const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      return fourHoursLater.toISOString();
    default:
      // Default to 2 hours from now
      const defaultExpiry = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      return defaultExpiry.toISOString();
  }
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY TYPES
// ═══════════════════════════════════════════════════════════════

export interface DetectionSummary {
  total: number;
  byStatus: {
    cooling_down: number;
    eligible: number;
    taken: number;
    executed: number;  // Backwards compat
    dismissed: number;
    expired: number;
    invalidated: number;
  };
  byStrategy: Record<string, number>;
  coolingDown: number;
  eligible: number;
}

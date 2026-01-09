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

  // Detection lifecycle
  firstDetectedAt: string;  // ISO timestamp
  lastDetectedAt: string;   // ISO timestamp
  detectionCount: number;   // How many scans confirmed this signal
  cooldownEndsAt: string;   // ISO timestamp

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
  };
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

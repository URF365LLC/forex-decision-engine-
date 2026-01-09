/**
 * Detection Service
 * Manages the detection lifecycle for auto-scanned signals
 * Handles cooldown workflow and status transitions
 */

import { Decision as StrategyDecision } from '../strategies/types.js';
import {
  DetectedTrade,
  DetectionStatus,
  convertDecisionToDetection,
  DetectionFilters,
  DetectionSummary,
} from '../types/detection.js';
import * as detectionStore from '../storage/detectionStore.js';
import { createLogger } from './logger.js';

const logger = createLogger('DetectionService');

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const DETECTION_CONFIG = {
  // Default cooldown period in minutes
  cooldownMinutes: 60,

  // Minimum grade to create detection
  minGrade: 'B',

  // Grade hierarchy for comparison
  gradeRank: {
    'no-trade': 0,
    C: 1,
    B: 2,
    'B+': 3,
    A: 4,
    'A+': 5,
  } as Record<string, number>,
};

// ═══════════════════════════════════════════════════════════════
// CORE OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Process a decision from auto-scan
 * Creates new detection or updates existing one
 */
export async function processAutoScanDecision(
  decision: StrategyDecision
): Promise<DetectedTrade | null> {
  // Skip no-trade and low-grade signals
  const gradeRank = DETECTION_CONFIG.gradeRank[decision.grade] || 0;
  const minRank = DETECTION_CONFIG.gradeRank[DETECTION_CONFIG.minGrade];

  if (gradeRank < minRank) {
    logger.debug(`Skipping low-grade signal: ${decision.symbol} ${decision.strategyId} ${decision.grade}`);
    return null;
  }

  // Check for existing active detection
  const existing = await detectionStore.findActiveDetection(
    decision.strategyId,
    decision.symbol,
    decision.direction
  );

  if (existing) {
    // Update existing detection
    logger.debug(`Updating existing detection: ${existing.id}`);

    const newGradeRank = DETECTION_CONFIG.gradeRank[decision.grade] || 0;
    const existingGradeRank = DETECTION_CONFIG.gradeRank[existing.grade] || 0;

    const updates: Parameters<typeof detectionStore.updateDetection>[1] = {
      lastDetectedAt: new Date().toISOString(),
      detectionCount: existing.detectionCount + 1,
    };

    // Upgrade grade if better
    if (newGradeRank > existingGradeRank) {
      updates.grade = decision.grade;
      updates.confidence = decision.confidence;
      logger.info(`Grade upgrade for ${existing.id}: ${existing.grade} → ${decision.grade}`);
    }

    return detectionStore.updateDetection(existing.id, updates);
  }

  // Create new detection
  logger.info(`Creating new detection: ${decision.symbol} ${decision.strategyId} ${decision.grade}`);

  const input = convertDecisionToDetection(decision, DETECTION_CONFIG.cooldownMinutes);
  return detectionStore.createDetection(input);
}

/**
 * Check if a detection exists and should block a new signal
 */
export async function checkDetectionCooldown(
  strategyId: string,
  symbol: string,
  direction: string
): Promise<{ blocked: boolean; detection?: DetectedTrade; reason?: string }> {
  const existing = await detectionStore.findActiveDetection(strategyId, symbol, direction);

  if (!existing) {
    return { blocked: false };
  }

  if (existing.status === 'cooling_down') {
    const remainingMs = new Date(existing.cooldownEndsAt).getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);

    return {
      blocked: true,
      detection: existing,
      reason: `Signal in cooldown: ${remainingMin}min remaining`,
    };
  }

  return { blocked: false, detection: existing };
}

/**
 * Invalidate detection if market conditions changed (e.g., direction flip)
 */
export async function invalidateOnConditionChange(
  strategyId: string,
  symbol: string,
  newDirection: 'long' | 'short'
): Promise<DetectedTrade | null> {
  // Find opposite direction detection
  const oppositeDirection = newDirection === 'long' ? 'short' : 'long';
  const existing = await detectionStore.findActiveDetection(
    strategyId,
    symbol,
    oppositeDirection
  );

  if (existing) {
    logger.info(`Invalidating detection ${existing.id} due to direction flip: ${oppositeDirection} → ${newDirection}`);
    return detectionStore.markAsInvalidated(existing.id, `Direction flipped to ${newDirection}`);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// STATUS MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Execute a detection (user took the trade)
 * Allows execution from both 'cooling_down' and 'eligible' status
 */
export async function executeDetection(
  id: string,
  notes?: string
): Promise<DetectedTrade | null> {
  const detection = await detectionStore.getDetection(id);

  if (!detection) {
    logger.warn(`Detection not found: ${id}`);
    return null;
  }

  // Allow execution from both cooling_down and eligible
  if (!['cooling_down', 'eligible'].includes(detection.status)) {
    logger.warn(`Cannot execute detection in status: ${detection.status}`);
    return null;
  }

  logger.info(`Executing detection: ${id}`);
  return detectionStore.markAsExecuted(id, notes);
}

/**
 * Dismiss a detection (user decided not to take it)
 */
export async function dismissDetection(
  id: string,
  reason?: string
): Promise<DetectedTrade | null> {
  const detection = await detectionStore.getDetection(id);

  if (!detection) {
    logger.warn(`Detection not found: ${id}`);
    return null;
  }

  if (!['cooling_down', 'eligible'].includes(detection.status)) {
    logger.warn(`Cannot dismiss detection in status: ${detection.status}`);
    return null;
  }

  logger.info(`Dismissing detection: ${id}`);
  return detectionStore.markAsDismissed(id, reason);
}

// ═══════════════════════════════════════════════════════════════
// QUERY OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * List detections with optional filtering
 */
export async function listDetections(filters?: DetectionFilters): Promise<DetectedTrade[]> {
  return detectionStore.listDetections(filters);
}

/**
 * Get detection by ID
 */
export async function getDetection(id: string): Promise<DetectedTrade | null> {
  return detectionStore.getDetection(id);
}

/**
 * Get summary statistics
 */
export async function getSummary(): Promise<DetectionSummary> {
  return detectionStore.getDetectionSummary();
}

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Process cooldown expirations
 * Should be called periodically (e.g., every minute)
 */
export async function processCooldownExpirations(): Promise<number> {
  return detectionStore.checkAndUpdateCooldowns();
}

/**
 * Start the cooldown check interval
 */
let cooldownCheckInterval: NodeJS.Timeout | null = null;

export function startCooldownChecker(intervalMs: number = 60000): void {
  if (cooldownCheckInterval) {
    logger.warn('Cooldown checker already running');
    return;
  }

  logger.info(`Starting cooldown checker (interval: ${intervalMs}ms)`);

  cooldownCheckInterval = setInterval(async () => {
    try {
      const updated = await processCooldownExpirations();
      if (updated > 0) {
        logger.info(`Cooldown check: ${updated} detections became eligible`);
      }
    } catch (error) {
      logger.error('Cooldown check failed', { error });
    }
  }, intervalMs);
}

export function stopCooldownChecker(): void {
  if (cooldownCheckInterval) {
    clearInterval(cooldownCheckInterval);
    cooldownCheckInterval = null;
    logger.info('Cooldown checker stopped');
  }
}

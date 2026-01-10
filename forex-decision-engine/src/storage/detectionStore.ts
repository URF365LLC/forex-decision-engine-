/**
 * Detection Store
 * Manages detected trades from auto-scan with cooldown tracking
 * Supports both PostgreSQL (when available) and in-memory fallback
 */

import { getDb, isDbAvailable } from '../db/client.js';
import { createLogger } from '../services/logger.js';
import {
  DetectedTrade,
  DetectionStatus,
  CreateDetectionInput,
  UpdateDetectionInput,
  DetectionFilters,
  DetectionSummary,
} from '../types/detection.js';
import { randomUUID } from 'crypto';

const logger = createLogger('DetectionStore');

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY FALLBACK CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const IN_MEMORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;  // 24 hours
const IN_MEMORY_MAX_ENTRIES = 1000;

const inMemoryStore = new Map<string, DetectedTrade>();
let inMemoryCleanupIntervalId: NodeJS.Timeout | null = null;

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function generateId(): string {
  return randomUUID();
}

function makeActiveKey(strategyId: string, symbol: string, direction: string): string {
  return `${strategyId}:${symbol}:${direction}`;
}

// ═══════════════════════════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function createDetection(input: CreateDetectionInput): Promise<DetectedTrade> {
  const now = new Date().toISOString();
  const cooldownMs = (input.cooldownMinutes ?? 60) * 60 * 1000;
  const cooldownEndsAt = new Date(Date.now() + cooldownMs).toISOString();

  const detection: DetectedTrade = {
    id: generateId(),
    symbol: input.symbol,
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    grade: input.grade,
    direction: input.direction,
    confidence: input.confidence,
    entry: {
      price: input.entryPrice,
      formatted: input.entryFormatted,
    },
    stopLoss: input.stopLoss
      ? { price: input.stopLoss, formatted: input.stopLossFormatted || String(input.stopLoss) }
      : null,
    takeProfit: input.takeProfit
      ? { price: input.takeProfit, formatted: input.takeProfitFormatted || String(input.takeProfit) }
      : null,
    lotSize: input.lotSize ?? null,
    riskAmount: input.riskAmount ?? null,
    tieredExits: input.tieredExits ?? null,
    firstDetectedAt: now,
    lastDetectedAt: now,
    detectionCount: 1,
    cooldownEndsAt,
    barExpiresAt: input.barExpiresAt ?? null,
    status: 'cooling_down',
    reason: input.reason,
    triggers: input.triggers,
    createdAt: now,
    updatedAt: now,
  };

  if (isDbAvailable()) {
    try {
      const db = getDb();
      await db
        .insertInto('detections')
        .values({
          id: detection.id,
          symbol: detection.symbol,
          strategy_id: detection.strategyId,
          strategy_name: detection.strategyName,
          grade: detection.grade,
          direction: detection.direction,
          confidence: detection.confidence,
          entry_price: detection.entry.price,
          stop_loss: detection.stopLoss?.price ?? null,
          take_profit: detection.takeProfit?.price ?? null,
          lot_size: detection.lotSize,
          risk_amount: detection.riskAmount,
          tiered_exits: detection.tieredExits ? JSON.stringify(detection.tieredExits) : null,
          reason: detection.reason,
          triggers: JSON.stringify(detection.triggers),
          first_detected_at: detection.firstDetectedAt,
          last_detected_at: detection.lastDetectedAt,
          detection_count: detection.detectionCount,
          cooldown_ends_at: detection.cooldownEndsAt,
          bar_expires_at: detection.barExpiresAt,
          status: detection.status,
        })
        .execute();

      logger.debug(`Detection created in DB: ${detection.id}`);
    } catch (error) {
      logger.error('Failed to create detection in DB, using in-memory', { error });
      inMemoryStore.set(detection.id, detection);
    }
  } else {
    inMemoryStore.set(detection.id, detection);
    logger.debug(`Detection created in-memory: ${detection.id}`);
  }

  return detection;
}

export async function getDetection(id: string): Promise<DetectedTrade | null> {
  if (isDbAvailable()) {
    try {
      const db = getDb();
      const row = await db
        .selectFrom('detections')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();

      if (!row) return null;
      return rowToDetection(row);
    } catch (error) {
      logger.error('Failed to get detection from DB', { error });
    }
  }

  return inMemoryStore.get(id) || null;
}

export async function findActiveDetection(
  strategyId: string,
  symbol: string,
  direction: string
): Promise<DetectedTrade | null> {
  if (isDbAvailable()) {
    try {
      const db = getDb();
      const row = await db
        .selectFrom('detections')
        .selectAll()
        .where('strategy_id', '=', strategyId)
        .where('symbol', '=', symbol)
        .where('direction', '=', direction)
        .where('status', 'in', ['cooling_down', 'eligible'])
        .executeTakeFirst();

      if (row) return rowToDetection(row);
    } catch (error) {
      logger.error('Failed to find active detection from DB', { error });
    }
  }

  // Fallback to in-memory
  for (const detection of inMemoryStore.values()) {
    if (
      detection.strategyId === strategyId &&
      detection.symbol === symbol &&
      detection.direction === direction &&
      (detection.status === 'cooling_down' || detection.status === 'eligible')
    ) {
      return detection;
    }
  }

  return null;
}

export async function updateDetection(
  id: string,
  updates: UpdateDetectionInput
): Promise<DetectedTrade | null> {
  const now = new Date().toISOString();

  if (isDbAvailable()) {
    try {
      const db = getDb();
      const updateData: Record<string, unknown> = { updated_at: now };

      if (updates.lastDetectedAt) updateData.last_detected_at = updates.lastDetectedAt;
      if (updates.detectionCount !== undefined) updateData.detection_count = updates.detectionCount;
      if (updates.status) {
        updateData.status = updates.status;
        if (updates.statusReason) {
          // Append status reason to existing reason for audit trail
          updateData.reason = updates.statusReason;
        }
      }
      if (updates.grade) updateData.grade = updates.grade;
      if (updates.confidence !== undefined) updateData.confidence = updates.confidence;

      await db
        .updateTable('detections')
        .set(updateData)
        .where('id', '=', id)
        .execute();

      return getDetection(id);
    } catch (error) {
      logger.error('Failed to update detection in DB', { error });
    }
  }

  // Fallback to in-memory
  const detection = inMemoryStore.get(id);
  if (detection) {
    const updated = {
      ...detection,
      ...updates,
      updatedAt: now,
      statusChangedAt: updates.status ? now : detection.statusChangedAt,
    };
    inMemoryStore.set(id, updated);
    return updated;
  }

  return null;
}

export async function listDetections(filters: DetectionFilters = {}): Promise<DetectedTrade[]> {
  const { status, strategyId, symbol, grade, limit = 100, offset = 0 } = filters;

  if (isDbAvailable()) {
    try {
      const db = getDb();
      let query = db
        .selectFrom('detections')
        .selectAll()
        .orderBy('first_detected_at', 'desc')
        .limit(limit)
        .offset(offset);

      if (status) {
        if (Array.isArray(status)) {
          query = query.where('status', 'in', status);
        } else {
          query = query.where('status', '=', status);
        }
      }
      if (strategyId) query = query.where('strategy_id', '=', strategyId);
      if (symbol) query = query.where('symbol', '=', symbol);
      if (grade) query = query.where('grade', '=', grade);

      const rows = await query.execute();
      return rows.map(rowToDetection);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to list detections from DB', { error: errorMessage });
    }
  }

  // Fallback to in-memory
  let detections = Array.from(inMemoryStore.values());

  if (status) {
    const statusArray = Array.isArray(status) ? status : [status];
    detections = detections.filter((d) => statusArray.includes(d.status));
  }
  if (strategyId) detections = detections.filter((d) => d.strategyId === strategyId);
  if (symbol) detections = detections.filter((d) => d.symbol === symbol);
  if (grade) detections = detections.filter((d) => d.grade === grade);

  detections.sort(
    (a, b) => new Date(b.firstDetectedAt).getTime() - new Date(a.firstDetectedAt).getTime()
  );

  return detections.slice(offset, offset + limit);
}

export async function deleteDetection(id: string): Promise<boolean> {
  if (isDbAvailable()) {
    try {
      const db = getDb();
      const result = await db
        .deleteFrom('detections')
        .where('id', '=', id)
        .executeTakeFirst();

      return (result.numDeletedRows ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to delete detection from DB', { error });
    }
  }

  return inMemoryStore.delete(id);
}

// ═══════════════════════════════════════════════════════════════
// STATUS MANAGEMENT
// ═══════════════════════════════════════════════════════════════

export async function markAsExecuted(id: string, reason?: string): Promise<DetectedTrade | null> {
  return updateDetection(id, {
    status: 'executed',
    statusReason: reason || 'User executed trade',
  });
}

export async function markAsDismissed(id: string, reason?: string): Promise<DetectedTrade | null> {
  return updateDetection(id, {
    status: 'dismissed',
    statusReason: reason || 'User dismissed',
  });
}

export async function markAsExpired(id: string): Promise<DetectedTrade | null> {
  return updateDetection(id, {
    status: 'expired',
    statusReason: 'Signal validity expired',
  });
}

export async function markAsInvalidated(id: string, reason: string): Promise<DetectedTrade | null> {
  return updateDetection(id, {
    status: 'invalidated',
    statusReason: reason,
  });
}

// ═══════════════════════════════════════════════════════════════
// COOLDOWN LIFECYCLE
// ═══════════════════════════════════════════════════════════════

export async function checkAndUpdateCooldowns(): Promise<number> {
  const now = new Date();
  let updated = 0;

  if (isDbAvailable()) {
    try {
      const db = getDb();

      // Find all cooling_down detections where cooldown has expired
      const result = await db
        .updateTable('detections')
        .set({ status: 'eligible', updated_at: now.toISOString() })
        .where('status', '=', 'cooling_down')
        .where('cooldown_ends_at', '<=', now.toISOString())
        .executeTakeFirst();

      updated = Number(result.numUpdatedRows ?? 0);

      if (updated > 0) {
        logger.info(`${updated} detections transitioned to eligible`);
      }

      return updated;
    } catch (error) {
      logger.error('Failed to update cooldowns in DB', { error });
    }
  }

  // Fallback to in-memory
  for (const [id, detection] of inMemoryStore) {
    if (
      detection.status === 'cooling_down' &&
      new Date(detection.cooldownEndsAt) <= now
    ) {
      detection.status = 'eligible';
      detection.statusChangedAt = now.toISOString();
      detection.updatedAt = now.toISOString();
      inMemoryStore.set(id, detection);
      updated++;
    }
  }

  if (updated > 0) {
    logger.info(`${updated} detections transitioned to eligible (in-memory)`);
  }

  return updated;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export async function getDetectionSummary(): Promise<DetectionSummary> {
  const detections = await listDetections({ limit: 10000 });

  const summary: DetectionSummary = {
    total: detections.length,
    byStatus: {
      cooling_down: 0,
      eligible: 0,
      executed: 0,
      dismissed: 0,
      expired: 0,
      invalidated: 0,
    },
    byStrategy: {},
    coolingDown: 0,
    eligible: 0,
  };

  for (const detection of detections) {
    summary.byStatus[detection.status]++;
    summary.byStrategy[detection.strategyId] = (summary.byStrategy[detection.strategyId] || 0) + 1;
  }

  summary.coolingDown = summary.byStatus.cooling_down;
  summary.eligible = summary.byStatus.eligible;

  return summary;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Safe JSON parse (handles already-parsed objects)
// ═══════════════════════════════════════════════════════════════

function safeJsonParse<T>(value: unknown, defaultValue: T): T {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Row to Detection
// ═══════════════════════════════════════════════════════════════

function rowToDetection(row: Record<string, unknown>): DetectedTrade {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    strategyId: String(row.strategy_id),
    strategyName: String(row.strategy_name || ''),
    grade: String(row.grade),
    direction: row.direction as 'long' | 'short',
    confidence: Number(row.confidence || 0),
    entry: {
      price: Number(row.entry_price || 0),
      formatted: String(row.entry_price || '0'),
    },
    stopLoss: row.stop_loss
      ? { price: Number(row.stop_loss), formatted: String(row.stop_loss) }
      : null,
    takeProfit: row.take_profit
      ? { price: Number(row.take_profit), formatted: String(row.take_profit) }
      : null,
    lotSize: row.lot_size != null ? Number(row.lot_size) : null,
    riskAmount: row.risk_amount != null ? Number(row.risk_amount) : null,
    tieredExits: safeJsonParse(row.tiered_exits, null),
    firstDetectedAt: String(row.first_detected_at),
    lastDetectedAt: String(row.last_detected_at),
    detectionCount: Number(row.detection_count || 1),
    cooldownEndsAt: String(row.cooldown_ends_at || ''),
    barExpiresAt: row.bar_expires_at ? String(row.bar_expires_at) : null,
    status: row.status as DetectionStatus,
    reason: String(row.reason || ''),
    triggers: safeJsonParse(row.triggers, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP & MEMORY MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Clean up in-memory store to prevent unbounded memory growth.
 * Removes:
 * - Entries older than 24 hours
 * - Terminal status entries (dismissed, taken, expired)
 * - Excess entries beyond max limit (FIFO)
 */
export function cleanupInMemoryStore(): number {
  const now = Date.now();
  let cleaned = 0;

  // Clean by age and terminal status
  for (const [id, detection] of inMemoryStore.entries()) {
    if (!detection.createdAt) {
      inMemoryStore.delete(id);
      cleaned++;
      continue;
    }

    const age = now - new Date(detection.createdAt).getTime();
    const isTerminal = ['dismissed', 'executed', 'expired', 'invalidated'].includes(detection.status);

    // Remove old entries or terminal entries older than 1 hour
    if (age > IN_MEMORY_MAX_AGE_MS || (isTerminal && age > 60 * 60 * 1000)) {
      inMemoryStore.delete(id);
      cleaned++;
    }
  }

  // Enforce max entries (FIFO - remove oldest first)
  if (inMemoryStore.size > IN_MEMORY_MAX_ENTRIES) {
    const entries = Array.from(inMemoryStore.entries())
      .sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime());

    const toRemove = entries.slice(0, entries.length - IN_MEMORY_MAX_ENTRIES);
    for (const [id] of toRemove) {
      inMemoryStore.delete(id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`Cleaned ${cleaned} detections from in-memory store (remaining: ${inMemoryStore.size})`);
  }
  return cleaned;
}

/**
 * Start automatic in-memory cleanup interval
 */
export function startInMemoryCleanup(): void {
  if (inMemoryCleanupIntervalId) {
    logger.debug('In-memory detection cleanup already running');
    return;
  }
  inMemoryCleanupIntervalId = setInterval(cleanupInMemoryStore, 60 * 60 * 1000); // Every hour
  logger.debug('In-memory detection cleanup interval started');
}

/**
 * Stop automatic in-memory cleanup interval (for clean shutdown)
 */
export function stopInMemoryCleanup(): void {
  if (inMemoryCleanupIntervalId) {
    clearInterval(inMemoryCleanupIntervalId);
    inMemoryCleanupIntervalId = null;
    logger.debug('In-memory detection cleanup interval stopped');
  }
}

export function clearInMemoryStore(): void {
  inMemoryStore.clear();
  logger.info('In-memory detection store cleared');
}

// Auto-start cleanup on module load
startInMemoryCleanup();

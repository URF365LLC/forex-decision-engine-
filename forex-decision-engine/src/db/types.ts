/**
 * Database Type Definitions
 * Kysely schema types for the forex decision engine
 */

import { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ═══════════════════════════════════════════════════════════════
// DETECTION STATUS
// ═══════════════════════════════════════════════════════════════

export type DetectionStatus =
  | 'cooling_down'   // Just detected, in cooldown period
  | 'eligible'       // Cooldown complete, ready for action
  | 'executed'       // User took the trade
  | 'dismissed'      // User dismissed
  | 'expired'        // Signal validity passed
  | 'invalidated';   // Market conditions changed

// ═══════════════════════════════════════════════════════════════
// TABLE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export interface DetectionsTable {
  id: Generated<string>;
  symbol: string;
  strategy_id: string;
  strategy_name: string | null;
  grade: string;
  direction: string;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: number | null;
  reason: string | null;
  triggers: string | null;  // JSON string array

  // Detection lifecycle
  first_detected_at: string;
  last_detected_at: string;
  detection_count: Generated<number>;
  cooldown_ends_at: string | null;
  status: Generated<string>;

  // Metadata
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface SignalsTable {
  id: Generated<string>;
  detection_id: string | null;  // Links to detection if from auto-scan
  symbol: string;
  strategy_id: string;
  strategy_name: string | null;
  grade: string;
  direction: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: number | null;
  reason: string | null;
  decision_data: string | null;  // Full decision JSON
  source: string;  // 'auto_scan' | 'manual_scan'
  created_at: Generated<string>;
}

export interface JournalEntriesTable {
  id: Generated<string>;
  signal_id: string | null;
  detection_id: string | null;
  symbol: string;
  strategy_id: string | null;
  strategy_name: string | null;
  direction: string | null;
  entry_price: number | null;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  lot_size: number | null;
  status: string | null;  // 'pending' | 'open' | 'closed' | 'cancelled'
  outcome: string | null;  // 'win' | 'loss' | 'breakeven'
  pnl_pips: number | null;
  pnl_usd: number | null;
  notes: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface CooldownsTable {
  id: Generated<string>;
  cooldown_key: string;  // symbol:style:strategyId
  symbol: string;
  style: string;
  strategy_id: string;
  direction: string;
  grade: string;
  started_at: string;
  expires_at: string;
  created_at: Generated<string>;
}

export interface AlertHistoryTable {
  id: Generated<string>;
  alert_key: string;  // symbol:strategy:direction
  signal_id: string | null;
  grade: string;
  sent_to: string;
  sent_at: string;
  expires_at: string;
  created_at: Generated<string>;
}

// ═══════════════════════════════════════════════════════════════
// DATABASE SCHEMA
// ═══════════════════════════════════════════════════════════════

export interface Database {
  detections: DetectionsTable;
  signals: SignalsTable;
  journal_entries: JournalEntriesTable;
  cooldowns: CooldownsTable;
  alert_history: AlertHistoryTable;
}

// ═══════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════

export type Detection = Selectable<DetectionsTable>;
export type NewDetection = Insertable<DetectionsTable>;
export type DetectionUpdate = Updateable<DetectionsTable>;

export type Signal = Selectable<SignalsTable>;
export type NewSignal = Insertable<SignalsTable>;

export type JournalEntry = Selectable<JournalEntriesTable>;
export type NewJournalEntry = Insertable<JournalEntriesTable>;
export type JournalEntryUpdate = Updateable<JournalEntriesTable>;

export type Cooldown = Selectable<CooldownsTable>;
export type NewCooldown = Insertable<CooldownsTable>;

export type AlertHistory = Selectable<AlertHistoryTable>;
export type NewAlertHistory = Insertable<AlertHistoryTable>;

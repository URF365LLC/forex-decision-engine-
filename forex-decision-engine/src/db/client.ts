/**
 * Database Client
 * Kysely PostgreSQL connection with connection pooling
 */

import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { Database } from './types.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('Database');

// ═══════════════════════════════════════════════════════════════
// DATABASE INSTANCE
// ═══════════════════════════════════════════════════════════════

let db: Kysely<Database> | null = null;

/**
 * Get or create the database connection
 */
export function getDb(): Kysely<Database> {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Initialize the database connection
 */
export async function initDb(): Promise<Kysely<Database>> {
  if (db) {
    logger.info('Database already initialized');
    return db;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    logger.warn('DATABASE_URL not set - database features disabled');
    throw new Error('DATABASE_URL environment variable is required');
  }

  logger.info('Initializing database connection...');

  const dialect = new PostgresDialect({
    pool: new pg.Pool({
      connectionString,
      max: 10,  // Maximum connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }),
  });

  db = new Kysely<Database>({ dialect });

  // Test connection
  try {
    await sql`SELECT 1`.execute(db);
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error('Failed to connect to database', { error });
    throw error;
  }

  return db;
}

/**
 * Close the database connection
 */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    logger.info('Database connection closed');
  }
}

/**
 * Check if database is available
 */
export function isDbAvailable(): boolean {
  return db !== null;
}

/**
 * Run database migrations
 */
export async function runMigrations(): Promise<void> {
  const database = getDb();

  logger.info('Running database migrations...');

  // Create detections table
  await database.schema
    .createTable('detections')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('symbol', 'varchar(20)', (col) => col.notNull())
    .addColumn('strategy_id', 'varchar(50)', (col) => col.notNull())
    .addColumn('strategy_name', 'varchar(100)')
    .addColumn('grade', 'varchar(10)', (col) => col.notNull())
    .addColumn('direction', 'varchar(10)', (col) => col.notNull())
    .addColumn('entry_price', 'numeric')
    .addColumn('stop_loss', 'numeric')
    .addColumn('take_profit', 'numeric')
    .addColumn('confidence', 'integer')
    .addColumn('reason', 'text')
    .addColumn('triggers', 'jsonb')
    .addColumn('first_detected_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .addColumn('last_detected_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .addColumn('detection_count', 'integer', (col) => col.defaultTo(1))
    .addColumn('cooldown_ends_at', 'timestamptz')
    .addColumn('status', 'varchar(20)', (col) => col.defaultTo('cooling_down'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute();

  // Create signals table
  await database.schema
    .createTable('signals')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('detection_id', 'uuid', (col) =>
      col.references('detections.id')
    )
    .addColumn('symbol', 'varchar(20)', (col) => col.notNull())
    .addColumn('strategy_id', 'varchar(50)', (col) => col.notNull())
    .addColumn('strategy_name', 'varchar(100)')
    .addColumn('grade', 'varchar(10)', (col) => col.notNull())
    .addColumn('direction', 'varchar(10)')
    .addColumn('entry_price', 'numeric')
    .addColumn('stop_loss', 'numeric')
    .addColumn('take_profit', 'numeric')
    .addColumn('confidence', 'integer')
    .addColumn('reason', 'text')
    .addColumn('decision_data', 'jsonb')
    .addColumn('source', 'varchar(20)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute();

  // Create journal_entries table
  await database.schema
    .createTable('journal_entries')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('signal_id', 'uuid', (col) => col.references('signals.id'))
    .addColumn('detection_id', 'uuid', (col) => col.references('detections.id'))
    .addColumn('symbol', 'varchar(20)', (col) => col.notNull())
    .addColumn('strategy_id', 'varchar(50)')
    .addColumn('strategy_name', 'varchar(100)')
    .addColumn('direction', 'varchar(10)')
    .addColumn('entry_price', 'numeric')
    .addColumn('exit_price', 'numeric')
    .addColumn('stop_loss', 'numeric')
    .addColumn('take_profit', 'numeric')
    .addColumn('lot_size', 'numeric')
    .addColumn('status', 'varchar(20)')
    .addColumn('outcome', 'varchar(20)')
    .addColumn('pnl_pips', 'numeric')
    .addColumn('pnl_usd', 'numeric')
    .addColumn('notes', 'text')
    .addColumn('opened_at', 'timestamptz')
    .addColumn('closed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute();

  // Create cooldowns table
  await database.schema
    .createTable('cooldowns')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('cooldown_key', 'varchar(200)', (col) => col.notNull().unique())
    .addColumn('symbol', 'varchar(20)', (col) => col.notNull())
    .addColumn('style', 'varchar(20)', (col) => col.notNull())
    .addColumn('strategy_id', 'varchar(50)', (col) => col.notNull())
    .addColumn('direction', 'varchar(10)', (col) => col.notNull())
    .addColumn('grade', 'varchar(10)', (col) => col.notNull())
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute();

  // Create alert_history table
  await database.schema
    .createTable('alert_history')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('alert_key', 'varchar(200)', (col) => col.notNull())
    .addColumn('signal_id', 'uuid', (col) => col.references('signals.id'))
    .addColumn('grade', 'varchar(10)', (col) => col.notNull())
    .addColumn('sent_to', 'varchar(255)', (col) => col.notNull())
    .addColumn('sent_at', 'timestamptz', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute();

  // Create indexes
  logger.info('Creating indexes...');

  await sql`CREATE INDEX IF NOT EXISTS idx_detections_status ON detections(status)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_detections_symbol ON detections(symbol)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_detections_strategy ON detections(strategy_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_detections_cooldown ON detections(cooldown_ends_at) WHERE status = 'cooling_down'`.execute(database);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_detections_active ON detections(strategy_id, symbol, direction) WHERE status IN ('cooling_down', 'eligible')`.execute(database);

  await sql`CREATE INDEX IF NOT EXISTS idx_signals_symbol_strategy ON signals(symbol, strategy_id)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at DESC)`.execute(database);

  await sql`CREATE INDEX IF NOT EXISTS idx_journal_symbol ON journal_entries(symbol)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_journal_dates ON journal_entries(opened_at, closed_at)`.execute(database);

  await sql`CREATE INDEX IF NOT EXISTS idx_cooldowns_expires ON cooldowns(expires_at)`.execute(database);

  await sql`CREATE INDEX IF NOT EXISTS idx_alerts_key ON alert_history(alert_key)`.execute(database);
  await sql`CREATE INDEX IF NOT EXISTS idx_alerts_expires ON alert_history(expires_at)`.execute(database);

  logger.info('Database migrations completed successfully');
}

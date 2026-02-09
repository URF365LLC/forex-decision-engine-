import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface JsonSignal {
  id: number;
  symbol: string;
  style: string;
  direction: string;
  grade: string;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_lots: number | null;
  risk_amount: number | null;
  reason: string;
  created_at: string;
  valid_until: string;
  result: string | null;
  result_notes: string | null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const signalsPath = path.join(__dirname, '../../data/signals.json');
  console.log(`Reading signals from ${signalsPath}...`);

  const raw = fs.readFileSync(signalsPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const signals: JsonSignal[] = parsed.signals || parsed;
  console.log(`Found ${signals.length} signals in JSON file`);

  const dialect = new PostgresDialect({
    pool: new pg.Pool({ connectionString, max: 5 }),
  });
  const db = new Kysely<any>({ dialect });

  await sql`SELECT 1`.execute(db);
  console.log('Database connected');

  const existingRows = await db
    .selectFrom('signals')
    .select(['symbol', 'strategy_id', 'direction', 'created_at'])
    .execute();

  const existingKeys = new Set(
    existingRows.map((r: any) => {
      const createdAt = r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at);
      return `${r.symbol}|${r.strategy_id}|${r.direction}|${createdAt}`;
    })
  );
  console.log(`Found ${existingKeys.size} existing signals in DB`);

  let inserted = 0;
  let skipped = 0;

  for (const signal of signals) {
    const key = `${signal.symbol}|${signal.style}|${signal.direction}|${signal.created_at}`;

    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    try {
      await db
        .insertInto('signals')
        .values({
          id: randomUUID(),
          detection_id: null,
          symbol: signal.symbol,
          strategy_id: signal.style,
          strategy_name: null,
          grade: signal.grade,
          direction: signal.direction,
          entry_price: signal.entry_low,
          stop_loss: signal.stop_loss,
          take_profit: signal.take_profit,
          confidence: null,
          reason: signal.reason,
          decision_data: null,
          source: 'legacy_restore',
          created_at: signal.created_at,
        })
        .execute();

      inserted++;
      if (inserted % 50 === 0) {
        console.log(`Progress: ${inserted} inserted, ${skipped} skipped`);
      }
    } catch (err) {
      console.error(`Failed to insert signal #${signal.id}: ${err}`);
    }
  }

  console.log(`\nRestore complete:`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicates): ${skipped}`);
  console.log(`  Total processed: ${signals.length}`);

  await db.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exit(1);
});

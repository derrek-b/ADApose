/**
 * Loads a flat snapshot CSV (as produced by automation/sqrtk/fetch_snapshots.py
 * or migrate_snapshots_gap.py) into the `pool_snapshots` table. Safe to
 * re-run anytime — ON CONFLICT DO NOTHING against
 * pool_snapshots_unique_reading skips rows already ingested rather than
 * duplicating them (this matters every day going forward, not just during
 * migration: a daily tick's snapshot always structurally re-touches a
 * timestamp already on file, since today's "latest" becomes tomorrow's
 * baseline).
 *
 * One CSV row -> one DB row (unlike the old ingest-measurements.mts, which
 * had to split each comparison-pair row into an implicit from/to pair).
 *
 * Defaults to reading from a caller-supplied --input path, since this
 * pipeline's Python side always writes to an ephemeral hand-off file, never
 * a persistent one -- there's no default path the way the old
 * measurements-era script had.
 *
 * Usage: cd web && node scripts/ingest-snapshots.mts --input <path>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { poolSnapshots } from "../src/db/schema.ts";

process.loadEnvFile(path.resolve(import.meta.dirname, "../.env.local"));

const inputFlagIndex = process.argv.indexOf("--input");
if (inputFlagIndex === -1) {
  console.error("Usage: node scripts/ingest-snapshots.mts --input <path>");
  process.exit(1);
}
const CSV_PATH = path.resolve(process.argv[inputFlagIndex + 1]);

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, values[i]])) as CsvRow;
  });
}

const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));

const values = rows.map((row) => ({
  venue: row.venue,
  trackAsset: row.track_asset,
  poolLabel: row.pool_label || null,
  ts: new Date(Number(row.ts) * 1000),
  sqrtkPerLp: row.sqrtk_per_lp,
  reserveA: row.reserve_a,
  reserveB: row.reserve_b,
  lpSupply: row.lp_supply,
  venueVerified: row.venue_verified === "True",
  source: row.source,
}));

const sql = postgres(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema: { poolSnapshots } });

const CHUNK_SIZE = 500;
let inserted = 0;

for (let i = 0; i < values.length; i += CHUNK_SIZE) {
  const chunk = values.slice(i, i + CHUNK_SIZE);
  const result = await db
    .insert(poolSnapshots)
    .values(chunk)
    .onConflictDoNothing({
      target: [poolSnapshots.venue, poolSnapshots.trackAsset, poolSnapshots.ts],
    })
    .returning({ id: poolSnapshots.id });
  inserted += result.length;
}

console.log(
  `${rows.length} rows in CSV, ${inserted} inserted, ${rows.length - inserted} already present`,
);

await sql.end();

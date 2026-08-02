/**
 * ONE-TIME migration. Not part of the recurring pipeline, not re-run after
 * this cutover completes. Extracts 2 real points per pool from the
 * about-to-be-retired `measurements` table into `pool_snapshots`, so the
 * new snapshot series has real history to start from instead of an empty
 * table -- no new Blockfrost calls needed for these two points, since
 * they're just a reshaping of data already fetched.
 *
 * measurements has no reserveA/B/lpSupply "from" columns -- only the "to"
 * endpoint carries raw reserves/LP supply. So this reads the "to" columns
 * of two different rows per pool, not the "from" columns of one:
 *   - older point: the 'deep' row with the smallest `days` (the nominal
 *     ~7-day one) -- all 4 deep rows per pool share an identical to_ts/
 *     reserves/sqrtk_per_lp_to by construction (one measure run computes
 *     one "now" state and reuses it across all 4 windows), so this is a
 *     deterministic tie-break, not a meaningful choice among different
 *     values.
 *   - newer point: the pool's single 'tick' row's "to" columns.
 *
 * Must run AFTER pool_snapshots exists (Drizzle migration A) and BEFORE
 * measurements is dropped (Drizzle migration B).
 *
 * Usage: cd web && node scripts/migrate-measurements-to-pool-snapshots.mts
 */
import path from "node:path";
import postgres from "postgres";

process.loadEnvFile(path.resolve(import.meta.dirname, "../.env.local"));

const sql = postgres(process.env.DATABASE_URL!);

const before = await sql`select count(*) from pool_snapshots`;
console.log(`pool_snapshots before: ${before[0].count} row(s)`);

const inserted = await sql`
  insert into pool_snapshots
    (venue, track_asset, pool_label, ts, sqrtk_per_lp, reserve_a, reserve_b, lp_supply, venue_verified, source)
  select venue, track_asset, pool_label, to_ts, sqrtk_per_lp_to, reserve_a_to, reserve_b_to, lp_supply_to, venue_verified, 'migration'
  from (
    select distinct on (venue, track_asset)
      venue, track_asset, pool_label, to_ts, sqrtk_per_lp_to, reserve_a_to, reserve_b_to, lp_supply_to, venue_verified
    from measurements
    where source = 'deep'
    order by venue, track_asset, days asc
  ) as deep_point
  union all
  select venue, track_asset, pool_label, to_ts, sqrtk_per_lp_to, reserve_a_to, reserve_b_to, lp_supply_to, venue_verified, 'migration'
  from measurements
  where source = 'tick'
  on conflict (venue, track_asset, ts) do nothing
  returning venue, track_asset
`;

const after = await sql`select count(*) from pool_snapshots`;
console.log(`inserted ${inserted.length} row(s); pool_snapshots after: ${after[0].count} row(s)`);

const badCounts = await sql`
  select venue, track_asset, count(*) as n
  from pool_snapshots
  group by venue, track_asset
  having count(*) <> 2
`;
if (badCounts.length > 0) {
  console.error(`WARNING: ${badCounts.length} pool(s) did not extract to exactly 2 points:`);
  console.error(badCounts);
} else {
  console.log("every pool extracted to exactly 2 points -- OK");
}

await sql.end();

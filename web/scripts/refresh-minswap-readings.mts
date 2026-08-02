/**
 * Populates current_readings for every Minswap V2 pool in pools.json:
 * live TVL/volume from the Minswap SDK, combined with our own 7d/30d fee
 * APR computed FRESH from pool_snapshots each run. Safe to re-run anytime
 * (upsert on the (venue, track_asset) primary key).
 *
 * Usage: cd web && node scripts/refresh-minswap-readings.mts
 *
 * Join note: pool.list() has no LP-token field — matching would otherwise
 * have to go through the coinA/coinB pair, which is ambiguous (many DEXs
 * list the same pair). Empirically, though, poolId IS assetUnitToCoinId of
 * the LP token itself (verified against 8 known pools), so poolIds-filtered
 * calls give an exact, unambiguous match — still double-checked against
 * `protocol` below rather than trusted blindly.
 *
 * APR note: pool_snapshots holds bare point-in-time readings, no
 * precomputed growth/APR — unlike the old measurements table, which baked
 * in a specific window per row and silently froze under daily ticking (see
 * pool_snapshots' own doc comment in schema.ts). Every run here picks two
 * snapshots (the pool's latest, and whichever is closest to
 * latest.ts − 7/30 days) and computes the annualized rate fresh via
 * decimal.js, matching the precision rigor automation/sqrtk's Python side
 * already uses (60-digit decimal.Decimal).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc } from "drizzle-orm";
import Decimal from "decimal.js";
import { MinswapSdk, assetUnitToCoinId, coinIdToAssetUnit } from "@minswap/sdk-v2";
import { poolSnapshots, currentReadings } from "../src/db/schema.ts";

Decimal.set({ precision: 60 });

process.loadEnvFile(path.resolve(import.meta.dirname, "../.env.local"));

const POOLS_PATH = path.resolve(
  import.meta.dirname,
  "../../automation/sqrtk/pools.json",
);

// Minswap API's hard cap, from its own error response, not documented in the types:
// "a maximum of 20 pool addresses is allowed".
const POOL_IDS_CHUNK_SIZE = 20;

type PoolEntry = { label: string; venue: string; track_asset: string };

const pools: PoolEntry[] = JSON.parse(readFileSync(POOLS_PATH, "utf8")).filter(
  (p: PoolEntry) => p.venue === "minswap-v2",
);

const sql = postgres(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema: { poolSnapshots, currentReadings } });
const sdk = new MinswapSdk({ currency: "ADA" });

// --- Step 1: live TVL/volume from Minswap, keyed by track_asset ---

type LiveStats = {
  tvlAda: number;
  volume24hAda: number;
  volume7dAda: number;
  volume30dAda: number | null;
};

const liveByTrackAsset = new Map<string, LiveStats>();

for (let i = 0; i < pools.length; i += POOL_IDS_CHUNK_SIZE) {
  const chunk = pools.slice(i, i + POOL_IDS_CHUNK_SIZE);
  const poolIds = chunk.map((p) => assetUnitToCoinId(p.track_asset));
  const page = await sdk.pool.list({ poolIds, limit: POOL_IDS_CHUNK_SIZE });

  for (const p of page.items) {
    // Defensive: only trust rows the SDK itself labels as the exact venue we
    // asked for, and skip anything without a poolId to convert back.
    if (p.protocol !== "minswap-cpmm-v2" || !p.poolId) continue;
    const trackAsset = coinIdToAssetUnit(p.poolId);
    liveByTrackAsset.set(trackAsset, {
      // SDK field names say *Usd, but currency:"ADA" makes the values ADA-denominated.
      tvlAda: p.tvlUsd,
      volume24hAda: p.volume24h,
      volume7dAda: p.volume1w,
      volume30dAda: p.volume30d,
    });
  }
}

// --- Step 2: our own fee APR, computed fresh from pool_snapshots ---

// Tolerance bands: `daysAgo` is measured relative to each pool's OWN latest
// snapshot, never a stored window column -- there isn't one anymore. A
// candidate must be AT LEAST `target` days back -- never fewer -- since
// under-reporting (a slightly-stale window honestly labeled) is preferable
// to over-reporting (a "7D" figure that's actually a 5-day measurement).
// `max` is a sane outer bound so a window that's way longer than its label
// claims shows "--" instead of a number wearing the wrong label even with a
// tooltip caveat -- the tooltip is easy to miss entirely (see the display
// discussion this accompanies).
const WINDOWS = [
  { key: "7d", target: 7, max: 14 },
  { key: "30d", target: 30, max: 45 },
] as const;

const DAY_MS = 86_400_000;

const minswapSnapshots = await db
  .select()
  .from(poolSnapshots)
  .where(eq(poolSnapshots.venue, "minswap-v2"))
  .orderBy(poolSnapshots.trackAsset, desc(poolSnapshots.ts));

type SnapshotRow = (typeof minswapSnapshots)[number];

// Newest-first per pool, a direct consequence of the orderBy above.
const snapshotsByTrackAsset = new Map<string, SnapshotRow[]>();
for (const row of minswapSnapshots) {
  if (!snapshotsByTrackAsset.has(row.trackAsset)) {
    snapshotsByTrackAsset.set(row.trackAsset, []);
  }
  snapshotsByTrackAsset.get(row.trackAsset)!.push(row);
}

function pickWindow(
  rows: SnapshotRow[],
  latest: SnapshotRow,
  target: number,
  max: number,
): SnapshotRow | null {
  // Every eligible candidate is >= target by construction, so "closest to
  // target" is just "smallest daysAgo that still qualifies" -- never pick
  // one that would under-count the window, only the least-over one.
  let best: SnapshotRow | null = null;
  let bestDaysAgo = Infinity;
  for (const row of rows) {
    if (row.id === latest.id) continue;
    const daysAgo = (latest.ts.getTime() - row.ts.getTime()) / DAY_MS;
    if (daysAgo < target || daysAgo > max) continue;
    if (daysAgo < bestDaysAgo) {
      bestDaysAgo = daysAgo;
      best = row;
    }
  }
  return best;
}

function computeApr(from: SnapshotRow, to: SnapshotRow) {
  const days = (to.ts.getTime() - from.ts.getTime()) / DAY_MS;
  const ratio = new Decimal(to.sqrtkPerLp).div(from.sqrtkPerLp);
  const apr = ratio.pow(new Decimal(365).div(days)).minus(1).times(100);
  return { days, apr };
}

// --- Step 3: combine and upsert ---

let upserted = 0;

for (const pool of pools) {
  const live = liveByTrackAsset.get(pool.track_asset);
  const rows = snapshotsByTrackAsset.get(pool.track_asset) ?? [];
  const latest = rows[0] ?? null;

  const w7 = latest ? pickWindow(rows, latest, 7, 14) : null;
  const w30 = latest ? pickWindow(rows, latest, 30, 45) : null;
  const apr7 = w7 && latest ? computeApr(w7, latest) : null;
  const apr30 = w30 && latest ? computeApr(w30, latest) : null;

  const row = {
    venue: pool.venue,
    trackAsset: pool.track_asset,
    poolLabel: pool.label,
    tvlAda: live ? String(live.tvlAda) : null,
    volume24hAda: live ? String(live.volume24hAda) : null,
    volume7dAda: live ? String(live.volume7dAda) : null,
    volume30dAda: live?.volume30dAda != null ? String(live.volume30dAda) : null,
    feeApr7dPct: apr7 ? apr7.apr.toFixed(4) : null,
    feeApr7dActualDays: apr7 ? apr7.days.toFixed(3) : null,
    feeApr7dFromSnapshotId: w7?.id ?? null,
    feeApr7dToSnapshotId: w7 ? latest!.id : null,
    feeApr30dPct: apr30 ? apr30.apr.toFixed(4) : null,
    feeApr30dActualDays: apr30 ? apr30.days.toFixed(3) : null,
    feeApr30dFromSnapshotId: w30?.id ?? null,
    feeApr30dToSnapshotId: w30 ? latest!.id : null,
    lastMeasuredAt: latest?.ts ?? null,
    lastSqrtkPerLp: latest?.sqrtkPerLp ?? null,
    venueVerified: latest?.venueVerified ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(currentReadings)
    .values(row)
    .onConflictDoUpdate({
      target: [currentReadings.venue, currentReadings.trackAsset],
      set: row,
    });
  upserted++;
}

console.log(
  `${pools.length} minswap-v2 pools processed, ${upserted} upserted into current_readings (${liveByTrackAsset.size} had live TVL/volume)`,
);

await sql.end();

import {
  boolean,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Pool identity/registry — the DB-native replacement for pools.json for the
 * automated pipeline. Write-once-at-discovery data (script_hash, nft,
 * asset_a/b rarely if ever change once a pool exists), kept deliberately
 * separate from current_readings' frequently-refreshed display snapshot:
 * pruning a tracked pool is a `pools` operation, refreshing its numbers is a
 * current_readings operation. The automated tick job only needs READ access
 * here — this table is only written by the (rare, manual) discovery/pruning
 * workflow.
 *
 * Field names are shared across venues by convention (same discipline as
 * measurements/current_readings), but what each one actually points at
 * on-chain is venue-specific and independently verified per venue — see
 * automation/sqrtk/SQRTK_RUNBOOK.md section 5 for what Minswap vs. WingRiders
 * each derive these from. lp_asset is kept distinct from track_asset (even
 * though identical today) because a future venue's identity and LP tokens
 * could diverge — same reasoning pools.json itself already documents.
 */
export const pools = pgTable(
  "pools",
  {
    venue: text("venue").notNull(),
    trackAsset: text("track_asset").notNull(),
    lpAsset: text("lp_asset").notNull(),
    label: text("label").notNull(),
    scriptHash: text("script_hash").notNull(),
    nft: text("nft").notNull(),
    assetA: text("asset_a").notNull(),
    assetB: text("asset_b").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.venue, table.trackAsset] })],
);

/**
 * One row per point-in-time √k reading — replaces the old `measurements`
 * comparison-pair design (one row per (from_ts, to_ts) window, with
 * growth/APR precomputed for that specific pair). That design silently
 * broke under an ongoing daily-tick cadence: a bucket-picking display layer
 * chose whichever single row's own window was "closest to nominal 7/30
 * days," but daily ticks only ever produce ~1-day-window rows, so the
 * picked row — and the displayed APR — would freeze forever after the
 * first one-time deep-sweep and never update again.
 *
 * The fix: store bare snapshots (pool, timestamp, √k/LP, reserves, LP
 * supply) with no baked-in comparison at all. Any window's APR gets
 * computed FRESH at refresh time by picking two snapshots — the pool's
 * latest, and whichever snapshot's timestamp is closest to
 * `latest.ts − N days` — and computing growth between them on the spot.
 * This is exactly what the old table's own doc comment already argued for
 * ("anyone, including us, can independently recompute fee_apr_pct and
 * verify it") — this shape just stops fighting that goal with a
 * precompute-and-freeze design.
 *
 * Platform-agnostic by design, same discipline as before: automation/sqrtk's
 * per-venue extraction logic (treasury paths, reserve source, LP-supply
 * method) already resolves every venue's quirks before a row is ever
 * written, so this shape is the same regardless of which venue produced it.
 */
export const poolSnapshots = pgTable(
  "pool_snapshots",
  {
    id: serial("id").primaryKey(),
    venue: text("venue").notNull(),
    trackAsset: text("track_asset").notNull(),
    poolLabel: text("pool_label"), // human-readable, convenience/debugging only — not authoritative

    ts: timestamp("ts", { withTimezone: true }).notNull(),

    // Raw √k input/output, kept at full precision — the whole credibility
    // premise of this product, not just display data.
    sqrtkPerLp: numeric("sqrtk_per_lp", { precision: 48, scale: 18 }).notNull(),
    reserveA: numeric("reserve_a", { precision: 20, scale: 0 }).notNull(),
    reserveB: numeric("reserve_b", { precision: 20, scale: 0 }).notNull(),
    lpSupply: numeric("lp_supply", { precision: 20, scale: 0 }).notNull(),

    // Provenance — what the venue's verification state was, and which tool
    // wrote this row ('deep' = old one-time sweep, 'tick'/'backfill'/'live'
    // = the current pipeline, 'migration' = carried over from the old
    // measurements table during the comparison-pair -> snapshot cutover).
    venueVerified: boolean("venue_verified").notNull(),
    source: text("source").notNull(),

    // When WE ingested this row — distinct from ts, which is the
    // snapshot's own on-chain timestamp.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Ongoing need, not migration scaffolding: every daily tick's snapshot
    // structurally re-touches a timestamp already on file (today's "latest"
    // becomes tomorrow's baseline), so idempotent re-ingestion needs this
    // permanently, not just during the cutover. `source` is deliberately
    // EXCLUDED from the key — "this pool's state at this exact moment" is
    // one physical fact; there should never be two rows for the same
    // (venue, track_asset, ts) differing only by provenance tag.
    unique("pool_snapshots_unique_reading").on(table.venue, table.trackAsset, table.ts),
  ],
);

/**
 * One row per pool — what the live page actually queries, so it stays small
 * and wide (no joins, no aggregation at request time). Fed by two
 * independent sources that can refresh on different cadences: our own √k
 * pipeline (fee_apr_*, via pool_snapshots) and each venue's live SDK
 * (tvl_ada, volume_*_ada).
 *
 * fee_apr_*_from/to_snapshot_id point back at the exact two pool_snapshots
 * rows a figure was computed from — full audit trail without re-storing the
 * raw √k inputs a second time here. Two IDs per window, not one: the figure
 * is now computed FRESH from a pair of snapshots at refresh time (see
 * pool_snapshots' own doc comment), not copied from a single precomputed
 * row, so there is no single row left to point at.
 *
 * Deliberately excludes venue-native APR (volume-derived, the thing √k
 * exists to be manipulation-proof against) and any 24h window (a fresh √k
 * measurement pass is real Blockfrost cost, and 24h is exactly the noisy
 * timeframe 7d/30d were chosen to avoid).
 */
export const currentReadings = pgTable(
  "current_readings",
  {
    venue: text("venue").notNull(),
    trackAsset: text("track_asset").notNull(),
    poolLabel: text("pool_label"),

    // Venue-reported, cached from the live SDK call — not fetched per page load.
    tvlAda: numeric("tvl_ada", { precision: 24, scale: 6 }),
    volume24hAda: numeric("volume_24h_ada", { precision: 24, scale: 6 }),
    volume7dAda: numeric("volume_7d_ada", { precision: 24, scale: 6 }),
    volume30dAda: numeric("volume_30d_ada", { precision: 24, scale: 6 }),

    // Our own headline metric. Nullable — a pool can be discovered before
    // its first measurement completes.
    feeApr7dPct: numeric("fee_apr_7d_pct", { precision: 20, scale: 4 }),
    feeApr7dActualDays: numeric("fee_apr_7d_actual_days", { precision: 10, scale: 3 }),
    feeApr7dFromSnapshotId: integer("fee_apr_7d_from_snapshot_id").references(() => poolSnapshots.id),
    feeApr7dToSnapshotId: integer("fee_apr_7d_to_snapshot_id").references(() => poolSnapshots.id),

    feeApr30dPct: numeric("fee_apr_30d_pct", { precision: 20, scale: 4 }),
    feeApr30dActualDays: numeric("fee_apr_30d_actual_days", { precision: 10, scale: 3 }),
    feeApr30dFromSnapshotId: integer("fee_apr_30d_from_snapshot_id").references(() => poolSnapshots.id),
    feeApr30dToSnapshotId: integer("fee_apr_30d_to_snapshot_id").references(() => poolSnapshots.id),

    // The objectively most-recent reading regardless of window -- distinct
    // from fee_apr_7d/30d's underlying rows, which are picked by closeness
    // to a nominal window, not recency. automation/sqrtk's fetch_snapshots.py
    // reads its own freshness baseline straight from pool_snapshots (a
    // DISTINCT ON query, backed by its own unique index), not from these
    // columns -- these are display/debug convenience on this table now,
    // kept in sync here as a side effect of refresh-minswap-readings.mts
    // already finding `latest` for the fee_apr_* computation anyway.
    lastMeasuredAt: timestamp("last_measured_at", { withTimezone: true }),
    lastSqrtkPerLp: numeric("last_sqrtk_per_lp", { precision: 48, scale: 18 }),

    venueVerified: boolean("venue_verified"),

    // Row-level freshness — distinct from the snapshot's own ts, since
    // TVL/volume and the √k figures can refresh on different cadences.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.venue, table.trackAsset] })],
);

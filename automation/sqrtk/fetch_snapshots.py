#!/usr/bin/env python3
"""
ADApose Labs -- the recurring, DB-driven measurement pipeline. Also absorbs
migrate_snapshots_gap.py's old job (deepen/resume an existing pool's
history) -- that's now just `--target-days <bigger N>` against this same
script, made cheap by the covered-day skip below.

Targets are calendar-anchored to UTC midnight (today_midnight = (now //
DAY) * DAY), not relative to whatever moment the script happens to run.
Why: the displayed APR diffs the latest snapshot against an N-days-ago one
(web/scripts/refresh-minswap-readings.mts's pickWindow), so if "latest"
drifts around with whatever time a human happened to invoke this, the real
measured window drifts with it too -- independent of anything about the
chain itself. See docs/decisions.md's 2026-08-03 D30 addendum.

Search stays strictly backward ("at or before" the target, never forward)
-- decided deliberately, not an oversight: sqrt(k)/LP is monotonically
non-decreasing by design (rises only from fees), so accepting a
transaction from *after* the nominal boundary to represent "state as of
the boundary" would systematically bias the reported value upward, not
just measure it imprecisely. Nothing about a pool changes between two
consecutive pool-touching transactions, so the state at the newest
genuine transaction before an instant *is* the true state at that instant,
exactly -- no forward window, no hard cutoff on how far back a target is
allowed to search either (a quiet pool just means an honestly-longer
measured window downstream, not a data gap).

This file reads the pool registry, each pool's latest known state, and
which calendar days are already covered from Postgres (read-only), calls
sqrtk_core.py's chain-reading primitives directly, and writes flat
point-in-time snapshot rows -- no growth/APR computed here at all; that's
the display layer's job, computed fresh from two snapshots each time it
runs.

Python never writes to Postgres in this pipeline -- it emits an ephemeral
CSV at a caller-supplied path, which web/scripts/ingest-snapshots.mts (the
only thing with DB write access anywhere in this pipeline) reads and
inserts.

CREDENTIAL NOTE
----------------
Needs DATABASE_URL in .env (or the environment), in addition to
BLOCKFROST_PROJECT_ID/BLOCKFROST_BASE_URL. This script only ever issues
SELECTs, but that's enforced by the code, not yet by the credential itself
-- there's no separate read-only Postgres role set up yet, so today this is
the same connection string used everywhere else.

DEPENDENCY NOTE
----------------
The rest of this toolkit is standard-library-only by design. This one file
needs psycopg -- install into a venv, never system Python: see
requirements-db.txt.

USAGE
-----
    python3 fetch_snapshots.py --out /tmp/fetch_run.csv
    # deepen/resume an existing pool's history (migrate_snapshots_gap.py's
    # old job) -- cheap even at a large N, already-covered days cost
    # nothing:
    python3 fetch_snapshots.py --out /tmp/deep.csv --target-days 35
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from decimal import Decimal

import psycopg

import sqrtk_core as C


def load_database_url(path: str) -> str:
    """Same minimal .env parsing sqrtk_core.Env uses, for DATABASE_URL
    specifically -- Env itself only exposes the two Blockfrost values."""
    vals: dict[str, str] = {}
    if os.path.exists(path):
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    if os.environ.get("DATABASE_URL"):
        vals["DATABASE_URL"] = os.environ["DATABASE_URL"]
    url = vals.get("DATABASE_URL", "")
    if not url:
        sys.exit(f"DATABASE_URL not found in {path} or the environment.")
    return url


def load_pools_from_db(conn) -> list[C.Pool]:
    """DB-native equivalent of sqrtk_core.load_pools -- same validation,
    reading the `pools` registry table instead of pools.json."""
    with conn.cursor() as cur:
        cur.execute(
            "select label, venue, nft, script_hash, asset_a, asset_b, "
            "lp_asset, track_asset from pools"
        )
        rows = cur.fetchall()
    pools = []
    for label, venue, nft, script_hash, asset_a, asset_b, lp_asset, track_asset in rows:
        if venue not in C.VENUES:
            sys.exit(f"pool {label}: unknown venue {venue!r}; known: {list(C.VENUES)}")
        pool = C.Pool(
            label=label, venue=venue, nft=nft, script_hash=script_hash,
            asset_a=asset_a, asset_b=asset_b,
            lp_asset=lp_asset or "", track_asset=track_asset or "",
        )
        v = C.VENUES[pool.venue]
        if v.nft_is_venue_wide and not pool.track_asset:
            sys.exit(
                f"pool {label}: venue {v.name} shares ONE NFT across every "
                f"pool -- pools.track_asset must be set (same check as "
                f"sqrtk_core.load_pools)."
            )
        pools.append(pool)
    return pools


def load_latest_snapshots_from_db(conn) -> dict:
    """
    {track_asset: {"ts": int, "sqrtk_per_lp": Decimal}} -- the single most
    recent pool_snapshots row per pool. Replaces reading current_readings'
    bookkeeping columns: the bookkeeping now lives in pool_snapshots itself
    (the MAX(ts) row), not in a separately-maintained shadow copy.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select distinct on (venue, track_asset) "
            "  venue, track_asset, ts, sqrtk_per_lp "
            "from pool_snapshots "
            "order by venue, track_asset, ts desc"
        )
        rows = cur.fetchall()
    return {
        track_asset: {"ts": int(ts.timestamp()), "sqrtk_per_lp": Decimal(str(sqrtk))}
        for _venue, track_asset, ts, sqrtk in rows
    }


def load_covered_days_from_db(conn, since_ts: int) -> dict[str, set[int]]:
    """
    {track_asset: {day_start_unix, ...}} -- every UTC calendar day (as a
    midnight-unix-timestamp bucket) that already has at least one
    pool_snapshots row at or after since_ts, across every pool in one
    query. Lets the per-pool target-day filter below skip any day we
    already have without spending a Blockfrost call to rediscover it.

    Sits alongside load_latest_snapshots_from_db, not a replacement for it:
    that function's DISTINCT ON collapses each pool to its single newest
    row (still needed separately for the brand-new-pool check and the
    decreasing-value seed) and would lose every earlier row in the
    lookback window this needs.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select venue, track_asset, ts from pool_snapshots "
            "where ts >= to_timestamp(%s)",
            (since_ts,),
        )
        rows = cur.fetchall()
    covered: dict[str, set[int]] = {}
    for _venue, track_asset, ts in rows:
        covered.setdefault(track_asset, set()).add(
            (int(ts.timestamp()) // C.DAY) * C.DAY
        )
    return covered


def collect_snapshots(bf: C.Blockfrost, pool: C.Pool, venue: C.Venue,
                       targets: list[int], source: str, problems: list,
                       verbose: bool = True) -> list[dict]:
    """
    For each target unix timestamp in `targets`, walk back via
    iter_txs_at_or_before/read_state to the newest genuine pool state at or
    before it -- the tracking asset can move in transactions that never
    touch the pool (a wallet-to-wallet LP transfer, a farm deposit, an order
    UTxO carrying LP mid-batch), so this walks past those rather than
    treating them as unreadable.

    Dedupes by tx_hash (several targets can land on the same tx for a quiet
    pool), then checks sqrt(k)/LP is non-decreasing across the distinct
    states found, in chronological order -- the same correctness rule the
    old cmd_measure used across its own lookback points.

    Returns one flat snapshot row dict per distinct state, tagged with
    `source`, sorted ascending by ts. No growth/APR fields -- those are
    computed later, at display time, from two snapshots' raw sqrtk_per_lp.

    One function serves every call site: a brand-new pool's backfill
    (targets = N consecutive calendar days back), a routine top-up
    (targets = today's midnight, and any other day not yet covered), and a
    manual deepen/catch-up (targets = a larger N days back) -- all the same
    logic, just a different (already covered-day-filtered) target list.
    """
    earliest_ts = min(targets)
    lp_cache: dict = {}
    states: list[C.State] = []

    for target_ts in targets:
        st, skipped, tx_row = None, 0, None
        try:
            for cand in C.iter_txs_at_or_before(bf, pool.identity, target_ts, verbose=verbose):
                tx_row = cand
                st = C.read_state(bf, pool, venue, cand, lp_cache, earliest_ts, verbose=verbose)
                if st:
                    break
                skipped += 1
        except C.PoolContentsError as exc:
            problems.append(f"{pool.label} T={target_ts}: {exc}")
            continue
        if tx_row is None:
            print(f"    T={target_ts}: no pool tx at or before that time -- pool younger?")
            continue
        if not st:
            problems.append(
                f"{pool.label} T={target_ts}: could not read state after skipping "
                f"{skipped} tx(s) that touched the tracking asset without touching the pool")
            continue
        for n in st.notes:
            problems.append(f"{pool.label} T={target_ts}: {n}")
        states.append(st)

    # dedupe: several targets can land on the same tx for a quiet pool
    seen, uniq = set(), []
    for st in sorted(states, key=lambda s: s.ts):
        if st.tx_hash not in seen:
            seen.add(st.tx_hash)
            uniq.append(st)

    for a, b in zip(uniq, uniq[1:]):
        if b.sqrt_k_per_lp < a.sqrt_k_per_lp:
            drop = (a.sqrt_k_per_lp - b.sqrt_k_per_lp) / a.sqrt_k_per_lp * 100
            problems.append(
                f"{pool.label}: sqrt(k)/LP FELL {drop:.6f}% between {a.ts} and {b.ts} "
                f"({a.tx_hash[:12]}… -> {b.tx_hash[:12]}…). Reserve source or LP source is "
                "wrong, or this pool is not constant-product. Do not trust this data."
            )

    return [
        {
            "venue": venue.name,
            "track_asset": pool.identity,
            "pool_label": pool.label,
            "ts": st.ts,
            "sqrtk_per_lp": f"{st.sqrt_k_per_lp:.18f}",
            "reserve_a": st.reserve_a,
            "reserve_b": st.reserve_b,
            "lp_supply": st.lp_supply,
            "venue_verified": venue.verified,
            "source": source,
        }
        for st in uniq
    ]


def cmd_fetch(args) -> int:
    env = C.Env(args.env_file)
    bf = C.Blockfrost(env, verbose=not args.quiet)
    db_url = load_database_url(args.env_file)

    tip = bf.latest_block()
    now = tip["time"]
    today_midnight = (now // C.DAY) * C.DAY
    print(f"chain tip {now} (height {tip['height']}) -- today = {today_midnight} UTC")

    max_lookback = max(args.target_days, args.new_pool_days)
    since_ts = today_midnight - max_lookback * C.DAY

    with psycopg.connect(db_url) as conn:
        pools = load_pools_from_db(conn)
        latest = load_latest_snapshots_from_db(conn)
        covered = load_covered_days_from_db(conn, since_ts)
    print(f"{len(pools)} pool(s) in the registry, {len(latest)} with prior state\n")

    rows: list[dict] = []
    problems: list[str] = []
    n_new_pool = n_routine = n_fully_covered = n_skip_unverified = 0

    for pool in pools:
        venue = C.VENUES[pool.venue]
        if not venue.verified:
            problems.append(
                f"{pool.label}: venue {venue.name} field paths are "
                f"UNVERIFIED -- SKIPPED, no row written")
            print(f"[{pool.label}] SKIPPED -- venue unverified")
            n_skip_unverified += 1
            continue

        last = latest.get(pool.identity)
        is_new = last is None
        days = args.new_pool_days if is_new else args.target_days
        source = "backfill" if is_new else "live"

        # range(N + 1), not range(N): N days of *spread* needs offsets 0..N
        # (N+1 points) -- range(N) alone tops out at N-1 days back, one day
        # short of what a caller asking for "N days" expects.
        nominal_targets = [today_midnight - i * C.DAY for i in range(days + 1)]
        already_covered = covered.get(pool.identity, set())
        targets = [t for t in nominal_targets if t not in already_covered]

        if not targets:
            print(f"[{pool.label}] all {len(nominal_targets)} target day(s) already "
                  f"covered -- skipping, no Blockfrost calls spent")
            n_fully_covered += 1
            continue

        verb = "backfilling" if is_new else "fetching"
        print(f"[{pool.label}] {verb} {len(targets)}/{len(nominal_targets)} "
              f"target day(s) (rest already covered)")
        new_rows = collect_snapshots(bf, pool, venue, targets, source, problems,
                                      verbose=not args.quiet)

        if new_rows and last is not None:
            # `last` isn't necessarily the immediate chronological predecessor
            # of new_rows[0]: with calendar-anchored gap-filling, a covered
            # day in between (e.g. day-3) can get filtered out while an
            # OLDER day (day-7) still needs fetching, landing new_rows[0]
            # *before* `last` in real time, not after. Merge and sort by ts
            # rather than assuming adjacency, so only genuinely-consecutive
            # pairs get compared.
            combined = sorted(
                [{"ts": last["ts"], "sqrtk_per_lp": last["sqrtk_per_lp"]}]
                + [{"ts": r["ts"], "sqrtk_per_lp": Decimal(r["sqrtk_per_lp"])} for r in new_rows],
                key=lambda r: r["ts"],
            )
            for a, b in zip(combined, combined[1:]):
                if b["sqrtk_per_lp"] < a["sqrtk_per_lp"]:
                    drop = (a["sqrtk_per_lp"] - b["sqrtk_per_lp"]) / a["sqrtk_per_lp"] * 100
                    problems.append(
                        f"{pool.label}: sqrt(k)/LP FELL {drop:.6f}% between ts={a['ts']} "
                        f"and ts={b['ts']}. Reserve source or LP source may be wrong. "
                        f"Do not trust this row.")

        rows.extend(new_rows)
        if is_new:
            n_new_pool += 1
        else:
            n_routine += 1

    if rows:
        file_exists = os.path.exists(args.out) and os.path.getsize(args.out) > 0
        mode = "a" if file_exists else "w"
        with open(args.out, mode, newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            if not file_exists:
                w.writeheader()
            w.writerows(rows)
        print(f"\nwrote {len(rows)} snapshot row(s) to {args.out}")

    print(f"\n{n_new_pool} new pool(s) backfilled, {n_routine} pool(s) ticked, "
          f"{n_fully_covered} skipped (fully covered, no Blockfrost calls spent), "
          f"{n_skip_unverified} skipped (unverified venue)")
    print(f"{bf.calls} API calls used this run")

    if problems:
        print("\n" + "=" * 70)
        print(f"PROBLEMS ({len(problems)}) -- read every one before trusting a number")
        print("=" * 70)
        for p in problems:
            print("  * " + p)
        return 1
    print("\nNo problems flagged.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=".env")
    ap.add_argument("--out", required=True,
                    help="CSV path new rows are written to -- an ephemeral "
                         "hand-off file for ingest-snapshots.mts to consume, "
                         "not a persistent store")
    ap.add_argument("--target-days", type=int, default=7,
                    help="how many consecutive UTC-midnight-anchored days "
                         "back (from today) an already-tracked pool should "
                         "have coverage for. Days already covered cost zero "
                         "Blockfrost calls, so this is safe to raise for a "
                         "manual deepen/catch-up without worrying about "
                         "cost -- not sized for daily 'spread', sized so "
                         "manual (pre-scheduler) runs don't need to track "
                         "exactly when this last ran")
    ap.add_argument("--new-pool-days", type=int, default=35,
                    help="how many consecutive UTC-midnight-anchored days "
                         "back to backfill when a pool has no prior "
                         "snapshot at all")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    return cmd_fetch(args)


if __name__ == "__main__":
    sys.exit(main())

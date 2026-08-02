#!/usr/bin/env python3
"""
ADApose Labs -- the recurring, DB-driven measurement pipeline. Replaces
sqrtk_tick_db.py (which reused sqrtk_tick.py's tick()/bootstrap(), both of
which produced the now-retired comparison-pair row shape). This file reads
the pool registry and each pool's latest known state from Postgres
(read-only), calls sqrtk_core.py's chain-reading primitives directly, and
writes flat point-in-time snapshot rows -- no growth/APR computed here at
all; that's the display layer's job (web/scripts/refresh-minswap-readings.mts),
computed fresh from two snapshots each time it runs.

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
    `source`. No growth/APR fields -- those are computed later, at display
    time, from two snapshots' raw sqrtk_per_lp.

    One function serves every call site: a brand-new pool's backfill
    (targets = N consecutive days back), a routine single-fresh reading
    (targets = [now]), and the one-time gap-fill script (targets = the days
    between an old point and now) -- all the same logic, just a different
    target list.
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

    with psycopg.connect(db_url) as conn:
        pools = load_pools_from_db(conn)
        latest = load_latest_snapshots_from_db(conn)
    print(f"{len(pools)} pool(s) in the registry, {len(latest)} with prior state\n")

    tip = bf.latest_block()
    now = tip["time"]
    print(f"chain tip {now} (height {tip['height']})")

    rows: list[dict] = []
    problems: list[str] = []
    n_live = n_backfilled = n_skip_fresh = n_skip_unverified = 0

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
        if last is None:
            print(f"[{pool.label}] no prior snapshot -- backfilling {args.backfill_days} day(s)")
            # range(N + 1), not range(N): N days of *spread* needs offsets
            # 0..N (N+1 points) -- range(N) alone tops out at N-1 days back,
            # one day short of what a caller asking for "N days" expects.
            targets = [now - i * C.DAY for i in range(args.backfill_days + 1)]
            rows.extend(collect_snapshots(bf, pool, venue, targets, "backfill",
                                          problems, verbose=not args.quiet))
            n_backfilled += 1
            continue

        # Cheap pre-check, no Blockfrost call: `now` is fetched once for the
        # whole run and can only ever be >= any state a real read would find,
        # so if wall-clock time alone hasn't advanced 0.5 days, no on-chain
        # read could change that conclusion.
        best_case_days = (now - last["ts"]) / C.DAY
        if best_case_days < 0.5:
            print(f"[{pool.label}] last snapshot {best_case_days:.2f}d ago -- too "
                  f"soon even in the best case, skipping Blockfrost calls")
            n_skip_fresh += 1
            continue

        print(f"[{pool.label}] venue={venue.name}")
        new_rows = collect_snapshots(bf, pool, venue, [now], "live", problems,
                                      verbose=not args.quiet)
        if new_rows:
            fresh = Decimal(new_rows[0]["sqrtk_per_lp"])
            if fresh < last["sqrtk_per_lp"]:
                drop = (last["sqrtk_per_lp"] - fresh) / last["sqrtk_per_lp"] * 100
                problems.append(
                    f"{pool.label}: sqrt(k)/LP FELL {drop:.6f}% since the last known "
                    f"reading. Reserve source or LP source may be wrong, or this pool "
                    f"stopped being constant-product. Do not trust this row.")
        rows.extend(new_rows)
        n_live += 1

    if rows:
        file_exists = os.path.exists(args.out) and os.path.getsize(args.out) > 0
        mode = "a" if file_exists else "w"
        with open(args.out, mode, newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            if not file_exists:
                w.writeheader()
            w.writerows(rows)
        print(f"\nwrote {len(rows)} snapshot row(s) to {args.out}")

    print(f"\n{n_live} ticked, {n_backfilled} backfilled, "
          f"{n_skip_fresh} skipped (too fresh, no Blockfrost calls spent), "
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
    ap.add_argument("--backfill-days", type=int, default=7,
                    help="how many individual daily snapshots to fetch "
                         "backward from now when a pool has no prior history")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    return cmd_fetch(args)


if __name__ == "__main__":
    sys.exit(main())

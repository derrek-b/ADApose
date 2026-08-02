#!/usr/bin/env python3
"""
ADApose Labs -- ONE-TIME migration helper. Not invoked by any scheduler, not
part of the recurring pipeline (that's fetch_snapshots.py).

Run exactly once, after:
  1. pool_snapshots exists (Drizzle migration A applied), and
  2. web/scripts/migrate-measurements-to-pool-snapshots.mts has already
     seeded each pool's 2 carried-over points (source='migration') from the
     old measurements table.

The 2 migrated points per pool are real, but sparse -- the old deep-sweep
point and the most recent tick point can be just a day or two apart, nowhere
near enough spread for a real rolling 7-day (let alone 30-day) window. This
builds proper daily density: for every pool with SOME prior history, fetch
one snapshot per day for the last --target-days days, regardless of exactly
how fresh the latest reading already is -- same target shape
fetch_snapshots.py's own new-pool bootstrap uses (targets = N consecutive
days back from now), just applied to already-known pools instead of brand
new ones. Reuses fetch_snapshots.collect_snapshots directly; any day that
happens to already have a snapshot is a no-op via the DB's own unique
constraint at ingest time, not something this script needs to detect itself.

USAGE
-----
    python3 migrate_snapshots_gap.py --out /tmp/gap_fill.csv
"""
from __future__ import annotations

import argparse
import csv
import os
import sys

import psycopg

import fetch_snapshots as F
import sqrtk_core as C


def cmd_migrate_gap(args) -> int:
    env = C.Env(args.env_file)
    bf = C.Blockfrost(env, verbose=not args.quiet)
    db_url = F.load_database_url(args.env_file)

    with psycopg.connect(db_url) as conn:
        pools = F.load_pools_from_db(conn)
        latest = F.load_latest_snapshots_from_db(conn)
    print(f"{len(pools)} pool(s) in the registry, {len(latest)} with prior state\n")

    tip = bf.latest_block()
    now = tip["time"]
    print(f"chain tip {now} (height {tip['height']})")

    rows: list[dict] = []
    problems: list[str] = []
    n_filled = n_skip_nohistory = n_skip_unverified = 0

    # range(N + 1), not range(N): N days of *spread* needs offsets 0..N
    # (N+1 points) -- range(N) alone tops out at N-1 days back, one day
    # short of what a caller asking for "N days" expects.
    targets = [now - i * C.DAY for i in range(args.target_days + 1)]

    for pool in pools:
        venue = C.VENUES[pool.venue]
        if not venue.verified:
            print(f"[{pool.label}] SKIPPED -- venue unverified")
            n_skip_unverified += 1
            continue

        if pool.identity not in latest:
            print(f"[{pool.label}] no prior snapshot at all -- not this script's job "
                  f"(run fetch_snapshots.py instead)")
            n_skip_nohistory += 1
            continue

        print(f"[{pool.label}] building {args.target_days} day(s) of daily density")
        rows.extend(F.collect_snapshots(bf, pool, venue, targets, "backfill",
                                        problems, verbose=not args.quiet))
        n_filled += 1

    if rows:
        file_exists = os.path.exists(args.out) and os.path.getsize(args.out) > 0
        mode = "a" if file_exists else "w"
        with open(args.out, mode, newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            if not file_exists:
                w.writeheader()
            w.writerows(rows)
        print(f"\nwrote {len(rows)} snapshot row(s) to {args.out}")

    print(f"\n{n_filled} pool(s) backfilled, {n_skip_nohistory} skipped (no prior history), "
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
    ap.add_argument("--out", required=True)
    ap.add_argument("--target-days", type=int, default=7,
                    help="how many consecutive daily snapshots (counting back "
                         "from now) to build for each already-known pool")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    return cmd_migrate_gap(args)


if __name__ == "__main__":
    sys.exit(main())

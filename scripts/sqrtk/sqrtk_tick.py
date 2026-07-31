#!/usr/bin/env python3
"""
ADApose Labs -- periodic (weekly) sqrt(k) tick: one current-state reading per
pool, appended to the same history sqrtk_snapshot.py's `measure` builds.

WHY THIS EXISTS, VS measure's LOOKBACK SWEEP
----------------------------------------------
`measure` re-derives up to four historical points from ONE run via a binary-
search-into-the-past for each -- necessary when there's no periodic history
yet, and expensive precisely because it's reconstructing the past on every
call (2*log2(pages) requests per lookback point, plus a datum fetch per
point). Once a pool already has a real periodic series, that reconstruction
is redundant: this week's own current state IS next week's historical point,
recorded for free the moment it's read. This script does exactly that and
nothing else -- one current-state read per pool, diffed against the most
recent row already on file for that pool.

Identity for that lookup is `track_asset` (the `track_asset` column measure
now writes), NEVER `pool`/label -- see SQRTK_RUNBOOK.md on why labels aren't
a safe join key across runs.

BOOTSTRAP, NOT BLANK, FOR A POOL WITH NO PRIOR ROW
----------------------------------------------------
A pool with no rows yet doesn't get a blank/level-only first tick -- it gets
measure's real lookback sweep, run for just that one pool (reusing
cmd_measure directly, not reimplemented here), so it enters the series with
real depth on day one instead of waiting months for enough ticks to
accumulate. This only happens when the pool's venue is verified, exactly like
`measure` itself: an unverified venue's pool is skipped and flagged, never
silently measured. An unconfirmed extraction rule can look exactly as
plausible as a correct one -- there is no safe number to produce for it,
bootstrap or tick.

Known minor limitation: the bootstrap sub-call constructs its own Blockfrost
client (inside cmd_measure) rather than sharing this script's rate limiter,
so the two aren't perfectly continuous across that boundary and their API
call counts are reported separately. Accepted rather than reworking
cmd_measure's signature to inject a shared client -- reusing its correctness
check and append logic unmodified matters more than a unified call count.

CORRECTNESS CHECK CARRIES OVER UNCHANGED
------------------------------------------
sqrt(k)/LP must be non-decreasing. A fresh reading below the last one on file
is flagged as a problem (non-zero exit) -- and still WRITTEN, same as
measure's own behaviour: a drop is signal, never something to silently drop
from the record.

USAGE
-----
    python3 sqrtk_tick.py --pools pools.json --out sqrtk.csv

    # offline self-test, no network:
    python3 mock_tick.py

Reads BLOCKFROST_PROJECT_ID from .env, same as sqrtk_snapshot.py.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import asdict
from decimal import Decimal

import sqrtk_snapshot as S

DAY = 86400


def load_last_rows(path: str) -> dict:
    """
    {track_asset: row} for the most recent (max to_ts) row already on file
    per pool. Empty dict if the file doesn't exist yet -- every pool
    bootstraps on a first run, which is correct, not a special case.
    """
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return {}
    last: dict = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            ta = row.get("track_asset")
            if not ta:
                continue
            prev = last.get(ta)
            if prev is None or int(row["to_ts"]) > int(prev["to_ts"]):
                last[ta] = row
    return last


def bootstrap(pool: S.Pool, args, problems: list) -> None:
    """
    No prior row for this pool -- run measure's real lookback sweep for just
    this one pool, appending directly into the shared --out file. Reuses
    cmd_measure wholesale (same correctness check, same append behaviour,
    same "source": "deep" tag) rather than reimplementing any of it here.
    """
    tmp_path = f"/tmp/sqrtk_tick_bootstrap_{os.getpid()}.json"
    with open(tmp_path, "w") as fh:
        json.dump([asdict(pool)], fh)
    try:
        sub_args = argparse.Namespace(
            env_file=args.env_file, pools=tmp_path, out=args.out,
            days=args.bootstrap_days, quiet=args.quiet)
        rc = S.cmd_measure(sub_args)
        if rc != 0:
            problems.append(f"{pool.label}: bootstrap (deep sweep) reported "
                            f"problems of its own -- see its output above")
    finally:
        os.remove(tmp_path)


def tick(pool: S.Pool, venue: S.Venue, last_row: dict, bf: S.Blockfrost,
         now: int, args, rows_out: list, problems: list) -> None:
    """
    One current-state read for `pool`, diffed against `last_row`. Writes
    nothing if there's genuinely nothing new since last_row (a quiet pool
    ticked again with no new pool-touching tx) -- that's not a problem, just
    no new information yet.
    """
    tx_row, st, skipped = None, None, 0
    for cand in S.iter_txs_at_or_before(bf, pool.identity, now,
                                        verbose=not args.quiet):
        tx_row = cand
        st = S.read_state(bf, pool, venue, cand, {}, now, verbose=not args.quiet)
        if st:
            break
        skipped += 1
    if not st:
        problems.append(f"{pool.label}: could not read current state after "
                        f"skipping {skipped} tx(s) that touched the tracking "
                        f"asset without touching the pool")
        return
    for n in st.notes:
        problems.append(f"{pool.label}: {n}")

    from_ts = int(last_row["to_ts"])
    days = (st.ts - from_ts) / DAY
    if days < 0.5:
        print(f"    {pool.label}: last row {days:.2f}d ago -- nothing new "
              f"to record yet")
        return

    sqrtk_from = Decimal(last_row["sqrtk_per_lp_to"])
    sqrtk_to = st.sqrt_k_per_lp
    if sqrtk_to < sqrtk_from:
        drop = (sqrtk_from - sqrtk_to) / sqrtk_from * 100
        problems.append(
            f"{pool.label}: sqrt(k)/LP FELL {drop:.6f}% since the last row "
            f"on file ({from_ts} -> {st.ts}). Reserve source or LP source "
            f"may be wrong, or this pool stopped being constant-product. "
            f"Do not trust this row.")

    ratio = sqrtk_to / sqrtk_from
    apr = (ratio ** (Decimal(365) / Decimal(str(days))) - 1) * 100
    rows_out.append({
        "pool": pool.label,
        "venue": venue.name,
        "track_asset": pool.identity,
        "from_ts": from_ts,
        "to_ts": st.ts,
        "days": round(days, 3),
        "sqrtk_per_lp_from": f"{sqrtk_from:.18f}",
        "sqrtk_per_lp_to": f"{sqrtk_to:.18f}",
        "growth_pct": f"{(ratio - 1) * 100:.6f}",
        "fee_apr_pct": f"{apr:.4f}",
        "reserve_a_to": st.reserve_a,
        "reserve_b_to": st.reserve_b,
        "lp_supply_to": st.lp_supply,
        "venue_verified": venue.verified,
        "source": "tick",
    })
    print(f"    {pool.label}: {days:.1f}d since last row -> fee APR {apr:.3f}%")


def cmd_tick(args) -> int:
    env = S.Env(args.env_file)
    bf = S.Blockfrost(env, verbose=not args.quiet)
    pools = S.load_pools(args.pools)

    tip = bf.latest_block()
    now = tip["time"]
    print(f"chain tip {now} (height {tip['height']})")

    last_rows = load_last_rows(args.out)
    print(f"{len(last_rows)} pool(s) have prior history in {args.out}\n")

    rows: list[dict] = []
    problems: list[str] = []
    n_tick = n_bootstrap = n_skip = 0

    for pool in pools:
        venue = S.VENUES[pool.venue]
        if not venue.verified:
            problems.append(
                f"{pool.label}: venue {venue.name} field paths are "
                f"UNVERIFIED -- SKIPPED, no row written")
            print(f"[{pool.label}] SKIPPED -- venue unverified")
            n_skip += 1
            continue

        last_row = last_rows.get(pool.identity)
        if last_row is None:
            print(f"[{pool.label}] no prior history -- bootstrapping via "
                  f"measure's lookback sweep")
            bootstrap(pool, args, problems)
            n_bootstrap += 1
        else:
            print(f"[{pool.label}] venue={venue.name}")
            tick(pool, venue, last_row, bf, now, args, rows, problems)
            n_tick += 1

    if rows:
        file_exists = os.path.exists(args.out) and os.path.getsize(args.out) > 0
        mode = "a" if file_exists else "w"
        with open(args.out, mode, newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            if not file_exists:
                w.writeheader()
            w.writerows(rows)
        print(f"\nappended {len(rows)} tick row(s) to {args.out}")

    print(f"\n{n_tick} ticked, {n_bootstrap} bootstrapped, {n_skip} skipped "
          f"(unverified venue)")
    print(f"{bf.calls} API calls used this run (bootstrap sub-calls, if any, "
          f"report their own count above)")

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
    ap.add_argument("--pools", required=True)
    ap.add_argument("--out", default="sqrtk.csv")
    ap.add_argument("--bootstrap-days", default="7,14,30,60",
                    help="--days passed to measure's lookback sweep when "
                         "bootstrapping a pool with no prior history")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    return cmd_tick(args)


if __name__ == "__main__":
    sys.exit(main())

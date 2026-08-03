#!/usr/bin/env python3
"""
Offline end-to-end exercise of fetch_snapshots.cmd_fetch's own orchestration
-- the covered-days skip, new-pool-vs-routine branching, unverified-venue
skip, decreasing-reading flag -- as distinct from chain-reading correctness
(covered by mock_wingriders.py/mock_minswap.py directly).

Monkeypatches sqrtk_core.Env/Blockfrost (reusing mock_wingriders.py's
400-day fixture + MockBF by import) plus fetch_snapshots.load_database_url/
psycopg.connect/load_pools_from_db/load_latest_snapshots_from_db/
load_covered_days_from_db, so no real DB connection or .env is ever touched.

    python3 mock_fetch_db.py
"""
import csv
import os
import types
from decimal import Decimal

import sqrtk_core as C
import fetch_snapshots as F
import mock_wingriders as MW  # reuse its 400-day fixture + MockBF

TODAY_MIDNIGHT = (MW.NOW // MW.DAY) * MW.DAY


class FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def run(pools, latest, covered=None, new_pool_days=35, target_days=7, quiet=True):
    """Runs cmd_fetch with the DB layer faked out. Returns (rc, rows, calls)."""
    if covered is None:
        covered = {}

    orig_env, orig_bf = C.Env, C.Blockfrost
    orig_load_db_url = F.load_database_url
    orig_load_pools = F.load_pools_from_db
    orig_load_latest = F.load_latest_snapshots_from_db
    orig_load_covered = F.load_covered_days_from_db
    orig_connect = F.psycopg.connect

    mock = MW.MockBF()
    C.Env = lambda path=".env": types.SimpleNamespace(
        project_id="x", base_url="", redact=lambda s: s)
    C.Blockfrost = lambda env, rps=8.0, verbose=True: mock
    F.load_database_url = lambda path: "postgresql://fake"
    F.load_pools_from_db = lambda conn: [C.Pool(**p) for p in pools]
    F.load_latest_snapshots_from_db = lambda conn: latest
    F.load_covered_days_from_db = lambda conn, since_ts: covered
    F.psycopg.connect = lambda url: FakeConn()

    out_path = "/tmp/mock_fetch_db_run.csv"
    if os.path.exists(out_path):
        os.remove(out_path)
    args = types.SimpleNamespace(env_file=".env", out=out_path,
                                 new_pool_days=new_pool_days,
                                 target_days=target_days, quiet=quiet)
    try:
        rc = F.cmd_fetch(args)
    finally:
        C.Env, C.Blockfrost = orig_env, orig_bf
        F.load_database_url = orig_load_db_url
        F.load_pools_from_db = orig_load_pools
        F.load_latest_snapshots_from_db = orig_load_latest
        F.load_covered_days_from_db = orig_load_covered
        F.psycopg.connect = orig_connect

    rows = []
    if os.path.exists(out_path):
        rows = list(csv.DictReader(open(out_path)))
    return rc, rows, mock.calls


def main():
    fails = []
    C.VENUES["wingriders-v2"].treasury_paths = [
        [["fields", 2, "int"], ["fields", 3, "int"]],
        [["fields", 4, "int"], ["fields", 5, "int"]],
        [["fields", 6, "int"], ["fields", 7, "int"]]]
    C.VENUES["wingriders-v2"].verified = True

    pool_dict = {"label": "MOCK-ADA-TOKB", "venue": "wingriders-v2", "nft": MW.NFT,
                 "script_hash": MW.SH, "lp_asset": MW.LP, "track_asset": MW.LP,
                 "asset_a": "lovelace", "asset_b": MW.TOKB}

    # ---- 1. no prior snapshot -> backfill triggered, new_pool_days default ----
    # new_pool_days=35 means 35 days of spread -- offsets 0..35, 36 points
    # (see fetch_snapshots.py's range(days + 1) comment).
    rc, rows, calls = run(pools=[pool_dict], latest={}, covered={})
    print(f"backfill: {len(rows)} row(s) written, {calls} calls, rc={rc}")
    if len(rows) != 36:
        fails.append(f"expected 36 backfilled rows (new_pool_days=35 default, offsets 0..35), got {len(rows)}")
    if rows and any(r["source"] != "backfill" for r in rows):
        fails.append("backfilled rows should all be tagged source=backfill")

    # ---- 2. routine pool, default target_days=7, every one of the 8 target
    #          buckets already covered -> zero Blockfrost calls beyond chain tip ----
    some_last = {MW.LP: {"ts": TODAY_MIDNIGHT - 8 * MW.DAY, "sqrtk_per_lp": Decimal("1.0")}}
    all_covered = {MW.LP: {TODAY_MIDNIGHT - i * MW.DAY for i in range(8)}}
    rc, rows, calls = run(pools=[pool_dict], latest=some_last, covered=all_covered)
    print(f"fully-covered: {len(rows)} row(s), {calls} calls, rc={rc}")
    if calls != 1:  # just the latest_block() chain-tip fetch
        fails.append(f"expected exactly 1 API call (chain tip only), got {calls}")
    if rows:
        fails.append("fully-covered pool should write zero rows")

    # ---- 3. routine pool, default target_days=7, none of the 8 target
    #          buckets covered -> exactly 8 'live' rows ----
    old_last = {MW.LP: {"ts": TODAY_MIDNIGHT - 30 * MW.DAY, "sqrtk_per_lp": Decimal("1.0")}}
    rc, rows, calls = run(pools=[pool_dict], latest=old_last, covered={})
    print(f"routine fetch: {len(rows)} row(s), {calls} calls, rc={rc}")
    if len(rows) != 8 or any(r["source"] != "live" for r in rows):
        fails.append(f"expected exactly 8 'live' rows (target_days=7 default, offsets 0..7), got {rows}")

    # ---- 4. partial coverage -- only today's bucket missing, the other 7
    #          already covered -> exactly 1 new row, not 8. This is the case
    #          that actually exercises per-target filtering rather than the
    #          all-or-nothing bookends above. ----
    partial_covered = {MW.LP: {TODAY_MIDNIGHT - i * MW.DAY for i in range(1, 8)}}
    rc, rows, calls = run(pools=[pool_dict], latest=old_last, covered=partial_covered)
    print(f"partial coverage: {len(rows)} row(s), {calls} calls, rc={rc}")
    if len(rows) != 1 or rows[0]["source"] != "live":
        fails.append(f"expected exactly 1 new row (only today's bucket missing), got {rows}")

    # ---- 5. unverified venue -> skipped before any covered-day work ----
    C.VENUES["wingriders-v2"].verified = False
    rc, rows, calls = run(pools=[pool_dict], latest={}, covered={})
    print(f"unverified: {len(rows)} row(s), {calls} calls, rc={rc}")
    if calls != 1:
        fails.append(f"unverified venue should cost only the chain-tip call, got {calls}")
    if rows:
        fails.append("unverified venue should write zero rows")
    if rc == 0:
        fails.append("unverified venue should be flagged (non-zero exit)")
    C.VENUES["wingriders-v2"].verified = True

    # ---- 6. a fresh reading below the DB's latest -> flagged but still
    #          written. Comparison basis is new_rows[0] (the oldest of the
    #          newly-fetched rows), not an arbitrary one. ----
    high_last = {MW.LP: {"ts": TODAY_MIDNIGHT - 30 * MW.DAY, "sqrtk_per_lp": Decimal("999")}}
    rc, rows, calls = run(pools=[pool_dict], latest=high_last, covered={})
    print(f"decreasing: {len(rows)} row(s), rc={rc}")
    if len(rows) != 8:
        fails.append("a decreasing reading should still be written, not dropped")
    if rc == 0:
        fails.append("a decreasing reading should be flagged (non-zero exit)")

    # ---- 7. a large manual --target-days override (standing in for the
    #          retired migrate_snapshots_gap.py's "deepen an existing pool"
    #          job) against a pool with some days already covered -> fewer
    #          targets get walked than the raw day count. ----
    big_override_days = 30  # -> 31 nominal targets (offsets 0..30)
    half_covered = {MW.LP: {TODAY_MIDNIGHT - i * MW.DAY for i in range(20)}}  # 20 of 31 covered
    # `last` must sit safely before this whole 31-day range -- old_last (day
    # -30) is fine for the smaller target_days=7 cases above but a 30-day
    # override reaches back far enough to overlap/exceed it, which isn't a
    # realistic "most recent known state" position for this deeper window.
    deep_last = {MW.LP: {"ts": TODAY_MIDNIGHT - 40 * MW.DAY, "sqrtk_per_lp": Decimal("1.0")}}
    rc, rows, calls = run(pools=[pool_dict], latest=deep_last, covered=half_covered,
                          target_days=big_override_days)
    print(f"manual deepen override: {len(rows)} row(s), {calls} calls, rc={rc}")
    if len(rows) != 11:  # 31 nominal - 20 already covered = 11 genuinely missing
        fails.append(f"expected exactly 11 new rows (31 nominal targets minus 20 already covered), got {len(rows)}")

    # ---- 8. `last` is NOT the immediate chronological predecessor of the
    #          fetched range (a covered day sits between them, closer to
    #          today) -> must NOT produce a false "FELL" flag. This is a
    #          real bug found during the actual mainnet dry run: comparing
    #          `last` against new_rows[0] assumed adjacency, but
    #          calendar-anchored gap-filling can fetch a day OLDER than
    #          `last` while a nearer day was already covered -- last's
    #          value is real (higher, being more recent) while the older
    #          fetched day is genuinely lower, which is correct monotonic
    #          growth, not a fall. ----
    # Don't assume a nominal target's ts survives exactly -- the walk-back
    # snaps to whatever real transaction is at/before it (see
    # collect_snapshots' own docstring), so take the oldest row this probe
    # actually returned, whatever its real ts turns out to be.
    probe_last = {MW.LP: {"ts": TODAY_MIDNIGHT - 40 * MW.DAY, "sqrtk_per_lp": Decimal("0")}}
    _, probe_rows, _ = run(pools=[pool_dict], latest=probe_last, covered={}, target_days=3)
    oldest_probe_row = min(probe_rows, key=lambda r: int(r["ts"]))
    day3_real_ts = int(oldest_probe_row["ts"])
    day3_value = Decimal(oldest_probe_row["sqrtk_per_lp"])
    day3_bucket = (day3_real_ts // MW.DAY) * MW.DAY

    realistic_last = {MW.LP: {"ts": day3_real_ts, "sqrtk_per_lp": day3_value}}
    day3_covered = {MW.LP: {day3_bucket}}
    rc, rows, calls = run(pools=[pool_dict], latest=realistic_last, covered=day3_covered,
                          target_days=7)
    print(f"non-adjacent last (regression): {len(rows)} row(s), rc={rc}")
    if len(rows) != 7:  # 8 nominal - 1 already-covered (day-3) = 7
        fails.append(f"expected 7 new rows (8 nominal minus the already-covered day-3), got {len(rows)}")
    if rc != 0:
        fails.append("non-adjacent `last` incorrectly flagged a decrease -- merge-by-ts comparison regressed")

    print()
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  * " + f)
        return 1
    print("fetch_snapshots.cmd_fetch mock end-to-end: all checks passed")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())

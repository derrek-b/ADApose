#!/usr/bin/env python3
"""
Offline end-to-end exercise of fetch_snapshots.cmd_fetch's own orchestration
-- the freshness pre-check, backfill-vs-live branching, unverified-venue
skip, decreasing-reading flag -- as distinct from chain-reading correctness
(covered by mock_wingriders.py/mock_minswap.py directly). Replaces
mock_tick.py.

Monkeypatches sqrtk_core.Env/Blockfrost (reusing mock_wingriders.py's
400-day fixture + MockBF by import, same pattern mock_tick.py already used)
plus fetch_snapshots.load_database_url/psycopg.connect/load_pools_from_db/
load_latest_snapshots_from_db, so no real DB connection or .env is ever
touched.

    python3 mock_fetch_db.py
"""
import csv
import os
import types
from decimal import Decimal

import sqrtk_core as C
import fetch_snapshots as F
import mock_wingriders as MW  # reuse its 400-day fixture + MockBF


class FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def run(pools, latest, backfill_days=7, quiet=True):
    """Runs cmd_fetch with the DB layer faked out. Returns (rc, rows, calls)."""
    orig_env, orig_bf = C.Env, C.Blockfrost
    orig_load_db_url = F.load_database_url
    orig_load_pools = F.load_pools_from_db
    orig_load_latest = F.load_latest_snapshots_from_db
    orig_connect = F.psycopg.connect

    mock = MW.MockBF()
    C.Env = lambda path=".env": types.SimpleNamespace(
        project_id="x", base_url="", redact=lambda s: s)
    C.Blockfrost = lambda env, rps=8.0, verbose=True: mock
    F.load_database_url = lambda path: "postgresql://fake"
    F.load_pools_from_db = lambda conn: [C.Pool(**p) for p in pools]
    F.load_latest_snapshots_from_db = lambda conn: latest
    F.psycopg.connect = lambda url: FakeConn()

    out_path = "/tmp/mock_fetch_db_run.csv"
    if os.path.exists(out_path):
        os.remove(out_path)
    args = types.SimpleNamespace(env_file=".env", out=out_path,
                                 backfill_days=backfill_days, quiet=quiet)
    try:
        rc = F.cmd_fetch(args)
    finally:
        C.Env, C.Blockfrost = orig_env, orig_bf
        F.load_database_url = orig_load_db_url
        F.load_pools_from_db = orig_load_pools
        F.load_latest_snapshots_from_db = orig_load_latest
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

    # ---- 1. no prior snapshot -> backfill triggered ----
    # backfill_days=7 means 7 days of *spread* -- offsets 0..7, i.e. 8 points
    # (see fetch_snapshots.py's range(args.backfill_days + 1) comment).
    rc, rows, calls = run(pools=[pool_dict], latest={})
    print(f"backfill: {len(rows)} row(s) written, {calls} calls, rc={rc}")
    if len(rows) != 8:
        fails.append(f"expected 8 backfilled rows (backfill_days=7 spans offsets 0..7), got {len(rows)}")
    if rows and any(r["source"] != "backfill" for r in rows):
        fails.append("backfilled rows should all be tagged source=backfill")

    # ---- 2. prior snapshot fresher than 0.5 days -> zero Blockfrost calls ----
    fresh_last = {MW.LP: {"ts": MW.NOW - 3600, "sqrtk_per_lp": Decimal("1.0")}}
    rc, rows, calls = run(pools=[pool_dict], latest=fresh_last)
    print(f"too-fresh: {len(rows)} row(s), {calls} calls, rc={rc}")
    if calls != 1:  # just the latest_block() chain-tip fetch
        fails.append(f"expected exactly 1 API call (chain tip only), got {calls}")
    if rows:
        fails.append("too-fresh pool should write zero rows")

    # ---- 3. prior snapshot older than 0.5 days -> exactly one 'live' row ----
    old_last = {MW.LP: {"ts": MW.NOW - 2 * MW.DAY, "sqrtk_per_lp": Decimal("1.0")}}
    rc, rows, calls = run(pools=[pool_dict], latest=old_last)
    print(f"live tick: {len(rows)} row(s), {calls} calls, rc={rc}")
    if len(rows) != 1 or rows[0]["source"] != "live":
        fails.append(f"expected exactly 1 'live' row, got {rows}")

    # ---- 4. unverified venue -> skipped before any freshness math ----
    C.VENUES["wingriders-v2"].verified = False
    rc, rows, calls = run(pools=[pool_dict], latest={})
    print(f"unverified: {len(rows)} row(s), {calls} calls, rc={rc}")
    if calls != 1:
        fails.append(f"unverified venue should cost only the chain-tip call, got {calls}")
    if rows:
        fails.append("unverified venue should write zero rows")
    if rc == 0:
        fails.append("unverified venue should be flagged (non-zero exit)")
    C.VENUES["wingriders-v2"].verified = True

    # ---- 5. a fresh reading below the DB's latest -> flagged but still written ----
    high_last = {MW.LP: {"ts": MW.NOW - 2 * MW.DAY, "sqrtk_per_lp": Decimal("999")}}
    rc, rows, calls = run(pools=[pool_dict], latest=high_last)
    print(f"decreasing: {len(rows)} row(s), rc={rc}")
    if len(rows) != 1:
        fails.append("a decreasing reading should still be written, not dropped")
    if rc == 0:
        fails.append("a decreasing reading should be flagged (non-zero exit)")

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

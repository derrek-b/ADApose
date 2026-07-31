#!/usr/bin/env python3
"""
Offline end-to-end exercise of sqrtk_tick.py, no network, no key.

Covers what sqrtk_snapshot.py's own mocks don't test: diffing against a
prior row, skipping an unverified venue without computing anything, flagging
(but still writing) a decreasing reading, and doing nothing when there's
genuinely nothing new since the last row on file. The bootstrap path (no
prior row -> full lookback sweep) reuses mock_run.py's already-verified
400-day fixture and MockBF directly rather than rebuilding one -- bootstrap
IS cmd_measure's own lookback sweep, unmodified, so testing it here would
just be re-testing mock_run.py's own coverage under a different name.

    python3 mock_tick.py
"""
import contextlib
import csv
import io
import json
import os
import sys
import types
from decimal import Decimal

import sqrtk_snapshot as S
import sqrtk_tick as T
import mock_run as MR  # reuse its 400-day fixture + MockBF for the bootstrap case

DAY = 86400
NOW = 1_800_000_000
SH = "af97793b8702f381976cec83e303e9ce17781458c73c4bb16fe02b83"
NFT = "ff" * 28 + "506f6f6c"
LP = "ee" * 28 + "4c50"
TOKB = "dd" * 28 + "544f4b"
ADDR = MR.bech32_encode("addr", bytes([0x71]) + bytes.fromhex(SH))

CSV_FIELDS = ["pool", "venue", "track_asset", "from_ts", "to_ts", "days",
              "sqrtk_per_lp_from", "sqrtk_per_lp_to", "growth_pct",
              "fee_apr_pct", "reserve_a_to", "reserve_b_to", "lp_supply_to",
              "venue_verified", "source"]


class SinglePointMockBF(S.Blockfrost):
    """
    Minimal fixture for the TICK path (current-state-only, no lookback into
    the past): exactly one 'current' tx, with reserves/LP/treasury the test
    controls directly so the expected result is computable independently and
    checked exactly, the same discipline as mock_run.py's own fixture.
    """
    def __init__(self, ra, rb, lp, ta=0, tb=0, tx_hash="11" * 32, ts=NOW):
        self.calls = 0
        self.verbose = False
        self.min_gap = 0.0
        self._last = 0.0
        self.env = types.SimpleNamespace(redact=lambda s: s)
        self.tx_hash, self.ts = tx_hash, ts
        self.ra, self.rb, self.lp, self.ta, self.tb = ra, rb, lp, ta, tb

    def latest_block(self):
        self.calls += 1
        return {"time": NOW, "height": 10_000_000}

    def asset_txs_page(self, asset, page, order="desc", count=100):
        self.calls += 1
        if page > 1:
            return []
        return [{"tx_hash": self.tx_hash, "block_time": self.ts, "tx_index": 0,
                 "block_height": 10_000_000}]

    def tx_utxos(self, tx_hash):
        self.calls += 1
        return {"outputs": [
            {"address": MR.bech32_encode("addr", bytes([0x61]) + bytes(28)),
             "amount": [{"unit": "lovelace", "quantity": "2000000"}]},
            {"address": ADDR, "data_hash": "da" + tx_hash[2:],
             "amount": [
                 {"unit": "lovelace", "quantity": str(self.ra + self.ta + 3_000_000)},
                 {"unit": TOKB, "quantity": str(self.rb + self.tb)},
                 {"unit": NFT, "quantity": "1"},
                 {"unit": LP, "quantity": str(
                     S.VENUES["wingriders-v2"].max_lp_supply - self.lp)},
             ]},
        ]}

    def datum(self, datum_hash):
        self.calls += 1
        return {"constructor": 0, "fields": [
            {"bytes": ""}, {"bytes": TOKB},
            {"int": self.ta}, {"int": self.tb},
            {"int": 0}, {"int": 0}, {"int": 0}, {"int": 0},
        ]}


def setup_verified_venue(verified=True):
    S.VENUES["wingriders-v2"].treasury_paths = [
        [["fields", 2, "int"], ["fields", 3, "int"]],
        [["fields", 4, "int"], ["fields", 5, "int"]],
        [["fields", 6, "int"], ["fields", 7, "int"]],
    ]
    S.VENUES["wingriders-v2"].verified = verified


def make_pool(label="MOCK-ADA-TOKB", nft=NFT, lp=LP, sh=SH):
    return {"label": label, "venue": "wingriders-v2", "nft": nft,
            "script_hash": sh, "lp_asset": lp, "track_asset": lp,
            "asset_a": "lovelace", "asset_b": TOKB}


def run_tick(mock_bf, pools, prior_rows, tag):
    """prior_rows: None (no file at all) or a list (possibly empty) of dict rows."""
    pools_path = f"/tmp/tick_pools_{tag}.json"
    out_path = f"/tmp/tick_out_{tag}.csv"
    with open(pools_path, "w") as fh:
        json.dump(pools, fh)
    if os.path.exists(out_path):
        os.remove(out_path)
    if prior_rows is not None:
        with open(out_path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            w.writeheader()
            w.writerows(prior_rows)

    orig_env, orig_bf = S.Env, S.Blockfrost
    S.Env = lambda path=".env": types.SimpleNamespace(
        project_id="x", base_url="", redact=lambda s: s)
    S.Blockfrost = lambda env, rps=8.0, verbose=True: mock_bf
    args = types.SimpleNamespace(env_file=".env", pools=pools_path, out=out_path,
                                 bootstrap_days="7,14,30,60", quiet=True)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = T.cmd_tick(args)
    S.Env, S.Blockfrost = orig_env, orig_bf
    out_rows = list(csv.DictReader(open(out_path))) if os.path.exists(out_path) else []
    return rc, out_rows, buf.getvalue()


def prior_row(sqrtk_to, to_ts, ra=1_000_000_000, rb=1_000_000_000, lp=1_000_000_000):
    return {
        "pool": "MOCK-ADA-TOKB", "venue": "wingriders-v2", "track_asset": LP,
        "from_ts": str(to_ts - 7 * DAY), "to_ts": str(to_ts), "days": "7",
        "sqrtk_per_lp_from": "1.000000000000000000",
        "sqrtk_per_lp_to": f"{sqrtk_to:.18f}",
        "growth_pct": "0", "fee_apr_pct": "0",
        "reserve_a_to": str(ra), "reserve_b_to": str(rb), "lp_supply_to": str(lp),
        "venue_verified": "True", "source": "deep",
    }


def main() -> int:
    fails = []

    def check(name, cond, detail=""):
        print(f"  {'PASS' if cond else 'FAIL'}  {name}{'  ' + detail if detail and not cond else ''}")
        if not cond:
            fails.append(name)

    # ---- bootstrap: no prior row -> full lookback sweep, reusing mock_run's
    # own fixture wholesale (this IS cmd_measure, unmodified) ----
    print("bootstrap (no prior row):")
    setup_verified_venue(True)
    mock = MR.MockBF()
    rc, rows, out = run_tick(mock, [make_pool()], None, "bootstrap")
    check("exits 0", rc == 0, f"rc={rc}\n{out[-2000:]}")
    check("wrote 4 rows (the full lookback sweep)", len(rows) == 4, f"got {len(rows)}")
    check("all rows tagged source=deep", rows and all(r["source"] == "deep" for r in rows))

    # ---- normal tick: prior row exists, current state is fresh, growth
    # computed against the file, not re-derived from history ----
    print("\nnormal tick (prior row exists):")
    setup_verified_venue(True)
    from_ts = NOW - 30 * DAY
    sqrtk_from = (Decimal(1_000_000_000) * Decimal(1_000_000_000)).sqrt() / Decimal(1_000_000_000)
    prow = prior_row(sqrtk_from, from_ts)
    ra1, rb1, lp1 = 1_030_000_000, 1_030_000_000, 1_000_000_000
    mock = SinglePointMockBF(ra1, rb1, lp1)
    rc, rows, out = run_tick(mock, [make_pool()], [prow], "normal")
    expected_sqrtk_to = (Decimal(ra1) * Decimal(rb1)).sqrt() / Decimal(lp1)
    expected_ratio = expected_sqrtk_to / sqrtk_from
    expected_apr = (expected_ratio ** (Decimal(365) / Decimal(30)) - 1) * 100
    check("exits 0", rc == 0, f"rc={rc}\n{out[-2000:]}")
    tick_rows = [r for r in rows if r["source"] == "tick"]
    check("exactly one new tick row", len(tick_rows) == 1, f"got {len(tick_rows)}")
    if tick_rows:
        got_apr = Decimal(tick_rows[0]["fee_apr_pct"])
        check("fee_apr_pct matches independent computation",
              abs(got_apr - expected_apr) < Decimal("0.01"),
              f"got {got_apr} vs {expected_apr}")
        check("days == 30 (from_ts is the PRIOR row's to_ts, not re-derived)",
              tick_rows[0]["days"] == "30.0", f"got {tick_rows[0]['days']}")
        check("track_asset carried through", tick_rows[0]["track_asset"] == LP)

    # ---- unverified venue: skipped entirely, nothing computed, nothing written ----
    print("\nunverified venue:")
    setup_verified_venue(False)
    mock = SinglePointMockBF(ra1, rb1, lp1)
    rc, rows, out = run_tick(mock, [make_pool()], [prow], "unverified")
    check("exits non-zero", rc != 0, f"rc={rc}")
    check("no new rows written (only the seeded prior row survives)",
          len(rows) == 1, f"got {len(rows)} total rows")
    check("only the one latest_block() call -- skipped before any per-pool "
          "tx/datum lookup", mock.calls == 1, f"got {mock.calls} calls")

    # ---- decreasing reading: flagged as a problem, but still WRITTEN ----
    print("\ndecreasing sqrt(k)/LP:")
    setup_verified_venue(True)
    higher_sqrtk = expected_sqrtk_to  # the "normal tick" scenario's higher value
    prow_high = prior_row(higher_sqrtk, from_ts)
    ra_lower, rb_lower, lp_lower = 900_000_000, 900_000_000, 1_000_000_000
    mock = SinglePointMockBF(ra_lower, rb_lower, lp_lower)
    rc, rows, out = run_tick(mock, [make_pool()], [prow_high], "decreasing")
    check("exits non-zero (flagged)", rc != 0, f"rc={rc}")
    tick_rows = [r for r in rows if r["source"] == "tick"]
    check("row was still WRITTEN despite the drop -- never silently dropped",
          len(tick_rows) == 1, f"got {len(tick_rows)}")
    if tick_rows:
        check("growth_pct is negative, visible in the data",
              float(tick_rows[0]["growth_pct"]) < 0,
              f"got {tick_rows[0]['growth_pct']}")

    # ---- near-zero elapsed time: nothing new to say, no row, NOT a problem ----
    print("\nlast row too recent (< 0.5 days ago):")
    setup_verified_venue(True)
    recent = NOW - int(0.1 * DAY)
    prow_recent = prior_row(sqrtk_from, recent)
    mock = SinglePointMockBF(ra1, rb1, lp1)
    rc, rows, out = run_tick(mock, [make_pool()], [prow_recent], "too_recent")
    check("exits 0 -- this is not an error", rc == 0, f"rc={rc}")
    check("no new row written", len(rows) == 1, f"got {len(rows)} total rows")

    print()
    if fails:
        print(f"{len(fails)} FAILED: {fails}")
        return 1
    print("tick mock end-to-end: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

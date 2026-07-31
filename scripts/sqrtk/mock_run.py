#!/usr/bin/env python3
"""
Offline end-to-end exercise of `measure` against a fabricated chain.

No network, no key. It builds a synthetic pool whose reserves grow only from
fees, runs the real measure path over it, and checks the reported fee APR comes
back at the rate that was baked in. Then it re-runs with a deliberately broken
venue rule (treasury not subtracted) to confirm the guard rails fire.

    python3 mock_run.py
"""
import json
import os
import sys
import types

import sqrtk_snapshot as S

DAY = 86400
NOW = 1_800_000_000
SH = "af97793b8702f381976cec83e303e9ce17781458c73c4bb16fe02b83"
NFT = "ff" * 28 + "506f6f6c"
LP = "ee" * 28 + "4c50"
TOKB = "dd" * 28 + "544f4b"


def bech32_encode(hrp, payload):
    B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    def polymod(values):
        gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
        chk = 1
        for v in values:
            b = chk >> 25
            chk = ((chk & 0x1FFFFFF) << 5) ^ v
            for i in range(5):
                chk ^= gen[i] if ((b >> i) & 1) else 0
        return chk
    hrp_exp = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]
    acc, bits, data = 0, 0, []
    for b in payload:
        acc = (acc << 8) | b
        bits += 8
        while bits >= 5:
            bits -= 5
            data.append((acc >> bits) & 31)
    if bits:
        data.append((acc << (5 - bits)) & 31)
    chk = polymod(hrp_exp + data + [0] * 6) ^ 1
    return hrp + "1" + "".join(B32[d] for d in data) + \
        "".join(B32[(chk >> 5 * (5 - i)) & 31] for i in range(6))


ADDR = bech32_encode("addr", bytes([0x71]) + bytes.fromhex(SH))

# ---- fabricate 400 daily pool states, fees accruing at a known rate --------
# 0.02% per day on sqrt(k)/LP  ->  (1.0002 ** 365 - 1) = 7.57 %/yr
DAILY = 1.0002
LP_SUPPLY = 1_000_000_000
BASE_A = 5_000_000_000
BASE_B = 5_000_000_000
MIN_ADA = 3_000_000

CHAIN = {}      # tx_hash -> (block_time, reserve_a, reserve_b, treasury_a, treasury_b, lp)
TXS = []        # newest-first rows
LP_EVENTS = []  # newest-first: {"tx_hash", "action", "amount"}

# Walk FORWARD in time so deposits compound correctly, then reverse.
# Deposits on day 120 and day 370 scale (the second lands INSIDE the 60d window) reserves and LP together by 1.1 --
# sqrt(k)/LP must be completely unmoved by them, which is the whole point.
DEPOSIT_DAYS = {120, 370}
_ra, _rb, _lp = float(BASE_A), float(BASE_B), float(LP_SUPPLY)
_ta = _tb = 0.0
_fwd = []
_lp_mints = []
for day in range(400):
    _ra *= DAILY
    _rb *= DAILY
    # 17% of the fee accrual is skimmed into the treasury, inside the same Value
    _ta += (_ra - _ra / DAILY) * 0.17
    _tb += (_rb - _rb / DAILY) * 0.17
    if day in DEPOSIT_DAYS:
        minted = _lp * 0.1
        _ra *= 1.1
        _rb *= 1.1
        _lp += minted
        _lp_mints.append((day, int(minted)))
    _fwd.append((day, int(_ra), int(_rb), int(_ta), int(_tb), int(_lp)))

for day, ra, rb, ta, tb, lp in _fwd:
    ts = NOW - (399 - day) * DAY
    h = f"{399 - day:064x}"
    CHAIN[h] = (ts, ra, rb, ta, tb, lp)
    TXS.append({"tx_hash": h, "block_time": ts, "tx_index": 0,
                "block_height": 10_000_000 - (399 - day)})
TXS.sort(key=lambda r: -r["block_time"])

FINAL_LP = _fwd[-1][5]
for day, minted in sorted(_lp_mints, reverse=True):
    LP_EVENTS.append({"tx_hash": f"{399 - day:064x}", "action": "minted", "amount": str(minted)})
LP_EVENTS.append({"tx_hash": f"{399:064x}", "action": "minted", "amount": str(LP_SUPPLY)})

DATUM_HASH = {h: f"da{h[2:]}" for h in CHAIN}


class MockBF(S.Blockfrost):
    def __init__(self):
        self.calls = 0
        self.verbose = False
        self.min_gap = 0.0
        self._last = 0.0
        self.env = types.SimpleNamespace(redact=lambda s: s)

    def latest_block(self):
        self.calls += 1
        return {"time": NOW, "height": 10_000_000}

    def asset_txs_page(self, asset, page, order="desc", count=100):
        self.calls += 1
        assert order == "desc"
        return TXS[(page - 1) * count: page * count]

    def tx_utxos(self, tx_hash):
        self.calls += 1
        ts, ra, rb, ta, tb, lp = CHAIN[tx_hash]
        return {"outputs": [
            {"address": bech32_encode("addr", bytes([0x61]) + bytes(28)),
             "amount": [{"unit": "lovelace", "quantity": "2000000"}]},
            {"address": ADDR,
             "data_hash": DATUM_HASH[tx_hash],
             "amount": [
                 {"unit": "lovelace", "quantity": str(ra + ta + MIN_ADA)},
                 {"unit": TOKB, "quantity": str(rb + tb)},
                 {"unit": NFT, "quantity": "1"},
                 # wingriders-v2 is lp_supply_source="pool_holds_remainder" (not
                 # mint_history -- see the venue's own comment in
                 # sqrtk_snapshot.py): circulating LP = max_lp_supply - held, so
                 # the pool output must hold exactly that remainder for `lp` (the
                 # true value baked into this day's CHAIN entry) to read back
                 # correctly. A constant placeholder here was the bug -- it made
                 # every day report ~maxint circulating supply regardless of `lp`.
                 {"unit": LP, "quantity": str(
                     S.VENUES["wingriders-v2"].max_lp_supply - lp)},
             ]},
        ]}

    def datum(self, datum_hash):
        self.calls += 1
        h = "00" + datum_hash[2:]
        _, ra, rb, ta, tb, lp = CHAIN[h]
        # constructor shaped like a WingRiders-style pool datum:
        # fields 0..1 assets, 2..3 treasury pair, 4..5 project pair, 6..7 reserve pair
        return {"constructor": 0, "fields": [
            {"bytes": ""}, {"bytes": TOKB},
            {"int": ta}, {"int": tb},
            {"int": 0}, {"int": 0},
            {"int": 0}, {"int": 0},
        ]}

    def tx(self, tx_hash):
        self.calls += 1
        return {"block_time": CHAIN[tx_hash][0]}

    def asset(self, asset):
        self.calls += 1
        return {"quantity": str(FINAL_LP)}

    def asset_history_page(self, asset, page, order="desc", count=100):
        self.calls += 1
        assert order == "desc", "backwards walk expected"
        return LP_EVENTS[(page - 1) * count: page * count]


def run(venue_treasury_paths, tag):
    S.VENUES["wingriders-v2"].treasury_paths = venue_treasury_paths
    S.VENUES["wingriders-v2"].verified = bool(venue_treasury_paths)
    pools = [{"label": "MOCK-ADA-TOKB", "venue": "wingriders-v2", "nft": NFT,
              "script_hash": SH, "lp_asset": LP, "track_asset": LP,
              "asset_a": "lovelace", "asset_b": TOKB}]
    with open("/tmp/mock_pools.json", "w") as fh:
        json.dump(pools, fh)

    mock = MockBF()
    orig_env, orig_bf = S.Env, S.Blockfrost
    S.Env = lambda path=".env": types.SimpleNamespace(
        project_id="x", base_url="", redact=lambda s: s)
    S.Blockfrost = lambda env, rps=8.0, verbose=True: mock
    out_path = f"/tmp/mock_{tag}.csv"
    if os.path.exists(out_path):
        os.remove(out_path)  # measure() now APPENDS -- start each mock clean
    args = types.SimpleNamespace(env_file=".env", pools="/tmp/mock_pools.json",
                                 out=out_path, days="7,14,30,60", quiet=True)
    print(f"\n########## {tag} ##########")
    rc = S.cmd_measure(args)
    S.Env, S.Blockfrost = orig_env, orig_bf
    return rc, mock.calls


def main():
    fails = []

    # ---- correct rules ----
    rc, calls = run([[["fields", 2, "int"], ["fields", 3, "int"]],
                     [["fields", 4, "int"], ["fields", 5, "int"]],
                     [["fields", 6, "int"], ["fields", 7, "int"]]], "correct")
    print(f"\nAPI calls for 1 pool x 4 lookback points: {calls}")
    if rc != 0:
        fails.append("correct rules should exit 0")
    rows = list(__import__("csv").DictReader(open("/tmp/mock_correct.csv")))
    expected = (DAILY ** 365 - 1) * 100
    print(f"expected fee APR ~{expected:.3f}%")
    for r in rows:
        got = float(r["fee_apr_pct"])
        ok = abs(got - expected) < 0.05
        print(f"  {r['days']:>6}d window -> {got:.4f}%  {'OK' if ok else 'MISMATCH'}")
        if not ok:
            fails.append(f"APR mismatch on {r['days']}d window: {got} vs {expected}")

    # ---- broken rules: point a treasury path at a field that does not exist.
    # Non-empty treasury_paths -> verified=True, so this does NOT hit the
    # unverified-venue skip below; it's caught a different way -- the
    # configured path genuinely doesn't resolve against the datum.
    rc, _ = run([[["fields", 99, "int"], ["fields", 98, "int"]]], "bad_path")
    if rc == 0:
        fails.append("unresolvable treasury path should have been flagged")
    else:
        print("guard rail fired as intended (non-zero exit)")

    # ---- unverified venue (empty treasury_paths -> verified=False): measure()
    # must SKIP it entirely, not compute and flag. There is no safe number to
    # produce for an unconfirmed extraction rule -- it can look exactly as
    # plausible as a correct one (tried modelling that directly: configuring
    # two paths that resolve but happen to always read 0 instead of the real
    # pair produces a monotonically-increasing, wrong APR with ZERO problems
    # flagged -- rc==0, legitimately, nothing currently catches it. That's a
    # separate, real gap -- distinguishing "correctly maps to a field that's
    # 0 today" from "wrongly maps to a field that's always 0" isn't something
    # this check can do -- worth knowing, not something patched here). run()
    # removes any stale /tmp/mock_unverified.csv from a prior invocation.
    rc, _ = run([], "unverified")
    if rc == 0:
        fails.append("unverified venue should have been flagged")
    elif os.path.exists("/tmp/mock_unverified.csv"):
        fails.append("unverified venue should not have written any rows")
    else:
        print("guard rail fired as intended (non-zero exit, zero rows written)")

    print()
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  * " + f)
        return 1
    print("mock end-to-end: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

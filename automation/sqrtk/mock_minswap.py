#!/usr/bin/env python3
"""
Offline end-to-end exercise of `fetch_snapshots.collect_snapshots` for the
Minswap V2 venue. Adapted to call the new snapshot-collecting function
directly instead of the retired cmd_measure -- same fixture, same
regression coverage.

Covers what the WingRiders mock cannot:
  * reserves read from the datum rather than from the Value
  * circulating LP read from the datum (`total_liquidity`) rather than
    reconstructed from mint history
  * the LP cross-check (max_lp_supply - held == total_liquidity)
  * the venue-wide NFT problem: history MUST be paged by the pool's own LP
    asset, never by the shared MSP token.  The mock asserts on the asset it is
    asked about, so a regression to NFT-paging fails loudly here.

    python3 mock_minswap.py
"""
import types

import sqrtk_core as C
import fetch_snapshots as F

DAY = C.DAY
NOW = 1_800_000_000
MAXB = 9_223_372_036_854_775_807

SH = "ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b"
POL = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c"
NFT = POL + "4d5350"                     # venue-wide, identical on every pool
LP = POL + "82e2b1fd27a7712a1a9cf750dfbea1a5778611b20e06dd6a611df7a643f8cb75"
TOKB = "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6" + "4d494e"

ADDR = None  # filled after the encoder is defined


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


# pools live at the BASE form: script payment + key stake (header 0x11)
STAKE = "52563c5410bff6a0d43ccebb7c37e1f69f5eb260552521adff33b9c2"
ADDR = bech32_encode("addr", bytes([0x11]) + bytes.fromhex(SH) + bytes.fromhex(STAKE))

# ---- fabricate 400 daily states; fees accrue at a known rate ---------------
DAILY = 1.0002                      # -> (1.0002**365 - 1) = 7.57 %/yr
LP0 = 1_000_000_000
BASE_A = 5_000_000_000
BASE_B = 5_000_000_000
DEPOSIT_DAYS = {120, 370}           # day 370 lands INSIDE the 60d window

CHAIN = {}
TXS = []

_ra, _rb, _lp = float(BASE_A), float(BASE_B), float(LP0)
_fwd = []
for day in range(400):
    _ra *= DAILY
    _rb *= DAILY
    if day in DEPOSIT_DAYS:
        _lp *= 1.1
        _ra *= 1.1
        _rb *= 1.1
    _fwd.append((day, int(_ra), int(_rb), int(_lp)))

for day, ra, rb, lp in _fwd:
    ts = NOW - (399 - day) * DAY
    h = f"{399 - day:064x}"
    CHAIN[h] = (ts, ra, rb, lp)
    TXS.append({"tx_hash": h, "block_time": ts, "tx_index": 0,
                "block_height": 10_000_000 - (399 - day)})
# ---- decoy txs: the LP token moving WITHOUT the pool being touched --------
# The tracking asset for a Minswap V2 pool is its LP token, and LP tokens sit
# in LP holders' wallets. A wallet-to-wallet transfer, a farm deposit, or an
# order UTxO carrying LP all appear in /assets/{lp}/transactions while leaving
# no output at the pool credential. Observed live on MIN2-ADA-MIN at two of
# five lookback points, so it is the common case, not an edge case.
# Placed exactly ON the T-0d and T-14d boundaries, which is where they do
# damage: they are the newest tx at or before the target, so a reader that
# does not walk back loses that lookback point entirely.
DECOYS = {f"de{'':>0}{i:062x}" for i in range(2)}
DECOY_ROWS = [
    {"tx_hash": f"de{0:062x}", "block_time": NOW, "tx_index": 1,
     "block_height": 10_000_001},
    {"tx_hash": f"de{1:062x}", "block_time": NOW - 14 * DAY, "tx_index": 1,
     "block_height": 10_000_000 - 13},
]
TXS.extend(DECOY_ROWS)
# ties on block_time: the decoy must sort NEWER than the pool tx it shadows,
# otherwise it never gets selected and the test proves nothing
TXS.sort(key=lambda r: (-r["block_time"], 0 if r["tx_hash"].startswith("de") else 1))

DATUM_HASH = {h: f"da{h[2:]}" for h in CHAIN}

# set by run(); when True the mock reports a held-LP quantity that disagrees
# with total_liquidity, which the cross-check must catch
BREAK_CROSSCHECK = False
# set by run(); when True the pool output is missing the venue NFT. That is NOT
# the same as "this tx did not touch the pool" -- an output IS at the pool
# credential -- and it must NEVER be walked past as if it were benign.
BREAK_UNITS = False
ASKED_ASSETS = []


class MockBF(C.Blockfrost):
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
        ASKED_ASSETS.append(asset)
        # This is the regression guard. Minswap's NFT is venue-wide, so asking
        # about it would return every pool on the DEX interleaved. The real
        # client cannot detect that; the mock can, so it refuses.
        assert asset != NFT, (
            "collect_snapshots paged history by the VENUE-WIDE NFT -- that "
            "returns every Minswap pool interleaved. It must page by the "
            "pool's LP asset.")
        assert asset == LP, f"unexpected tracking asset {asset}"
        return TXS[(page - 1) * count: page * count]

    def tx_utxos(self, tx_hash):
        self.calls += 1
        if tx_hash in DECOYS:
            # an LP holder moving LP between two ordinary key addresses:
            # the LP token is here, the pool is not
            return {"outputs": [
                {"address": bech32_encode("addr", bytes([0x61]) + bytes(28)),
                 "amount": [{"unit": "lovelace", "quantity": "2000000"},
                            {"unit": LP, "quantity": "5000"}]},
                {"address": bech32_encode("addr", bytes([0x61]) + bytes([1] * 28)),
                 "amount": [{"unit": "lovelace", "quantity": "3000000"}]},
            ]}
        ts, ra, rb, lp = CHAIN[tx_hash]
        # The pool holds everything it has not issued, PLUS the 10 units of
        # burn liquidity that are counted in total_liquidity but never leave
        # the pool (utils.ak default_burn_liquidity = 10).  Chain-confirmed on
        # MIN2-ADA-MIN.  Hard-coding MAXB - lp here would make the mock pass a
        # cross-check that fails on every real pool.
        held = MAXB - lp + C.VENUES["minswap-v2"].lp_locked
        if BREAK_CROSSCHECK:
            held -= 12_345          # Value and datum now disagree
        return {"outputs": [
            {"address": bech32_encode("addr", bytes([0x61]) + bytes(28)),
             "amount": [{"unit": "lovelace", "quantity": "2000000"}]},
            {"address": ADDR,
             "data_hash": DATUM_HASH[tx_hash],
             "amount": [
                 # datum reserves are the LP-owned balances; the Value carries
                 # a little more (min-ADA and batcher change live here too)
                 {"unit": "lovelace", "quantity": str(ra + 4_500_000)},
                 {"unit": TOKB, "quantity": str(rb)},
                 {"unit": NFT, "quantity": "0" if BREAK_UNITS else "1"},
                 {"unit": LP, "quantity": str(held)},
             ]},
        ]}

    def datum(self, datum_hash):
        self.calls += 1
        h = "00" + datum_hash[2:]
        _, ra, rb, lp = CHAIN[h]
        # PoolDatum field order per lib/amm_dex_v2/types.ak
        return {"constructor": 0, "fields": [
            {"constructor": 0, "fields": [{"bytes": STAKE}]},   # 0 stake cred
            {"constructor": 0, "fields": [                       # 1 asset_a
                {"bytes": ""}, {"bytes": ""}]},
            {"constructor": 0, "fields": [                       # 2 asset_b
                {"bytes": TOKB[:56]}, {"bytes": TOKB[56:]}]},
            {"int": lp},                                         # 3 total_liquidity
            {"int": ra},                                         # 4 reserve_a
            {"int": rb},                                         # 5 reserve_b
            {"int": 30}, {"int": 30},                            # 6,7 fee numerators
            {"constructor": 1, "fields": []},                    # 8 fee sharing: None
            {"constructor": 0, "fields": []},                    # 9 allow_dynamic_fee
        ]}

    def asset(self, asset):
        raise AssertionError("Minswap V2 must not need /assets -- LP is in the datum")

    def asset_history_page(self, asset, page, order="desc", count=100):
        raise AssertionError("Minswap V2 must not walk LP mint history")

    def tx(self, tx_hash):
        self.calls += 1
        return {"block_time": CHAIN[tx_hash][0]}


def make_pool(pool_overrides=None):
    kwargs = dict(label="MIN2-ADA-MIN", venue="minswap-v2", nft=NFT,
                  script_hash=SH, lp_asset=LP, track_asset=LP,
                  asset_a="lovelace", asset_b=TOKB)
    kwargs.update(pool_overrides or {})
    return C.Pool(**kwargs)


def run(targets, pool_overrides=None):
    """Returns (rows, problems, calls) from collect_snapshots against the
    fabricated Minswap V2 pool."""
    pool = make_pool(pool_overrides)
    venue = C.VENUES["minswap-v2"]
    mock = MockBF()
    problems: list = []
    rows = F.collect_snapshots(mock, pool, venue, targets, "backfill", problems, verbose=False)
    return rows, problems, mock.calls


def annualized_rate(row_from, row_to):
    from decimal import Decimal
    days = Decimal(row_to["ts"] - row_from["ts"]) / Decimal(DAY)
    ratio = Decimal(row_to["sqrtk_per_lp"]) / Decimal(row_from["sqrtk_per_lp"])
    return (ratio ** (Decimal(365) / days) - 1) * 100


def main():
    fails = []

    # ---- 1. correct config ------------------------------------------------
    targets = [NOW - 60 * DAY, NOW - 30 * DAY, NOW - 14 * DAY, NOW - 7 * DAY, NOW]
    rows, problems, calls = run(targets)
    print(f"\nAPI calls for 1 pool x {len(targets)} lookback points: {calls}")
    if problems:
        fails.append(f"correct config should raise no problems, got: {problems}")
    by_ts = {r["ts"]: r for r in rows}
    now_row = by_ts.get(NOW)
    expected = (DAILY ** 365 - 1) * 100
    print(f"expected fee APR ~{expected:.3f}%")
    for back_days in (60, 30, 14, 7):
        from_row = by_ts.get(NOW - back_days * DAY)
        if not from_row or not now_row:
            fails.append(f"missing snapshot for the {back_days}d window")
            continue
        got = float(annualized_rate(from_row, now_row))
        ok = abs(got - expected) < 0.05
        print(f"  {back_days:>3}d window -> {got:.4f}%  lp={from_row['lp_supply']}  "
              f"{'OK' if ok else 'MISMATCH'}")
        if not ok:
            fails.append(f"APR mismatch on {back_days}d window: {got} vs {expected}")

    # Every window ENDS at T-0, so lp_supply at "now" is identical across all
    # windows by construction -- comparing those proves nothing. Read the LP
    # supply at the two ends of the 60d window directly instead: it must
    # differ, because a deposit lands on day 370, inside that window. That
    # the 60d APR still comes back at exactly the baked-in rate anyway is the
    # actual proof that a mid-window deposit does not move sqrt(k)/LP.
    mock2 = MockBF()
    pool = make_pool()
    venue = C.VENUES["minswap-v2"]
    lps, walked = [], []
    for off in (60, 0):
        st, skipped = None, 0
        for cand in C.iter_txs_at_or_before(mock2, pool.identity,
                                            NOW - off * DAY, verbose=False):
            st = C.read_state(mock2, pool, venue, cand, {}, NOW - 60 * DAY,
                              verbose=False)
            if st:
                break
            skipped += 1
        lps.append(st.lp_supply)
        walked.append(skipped)
    print(f"LP supply at T-60d = {lps[0]:,}  ->  at T-0d = {lps[1]:,}")
    # T-0d sits on a decoy (LP moved outside the pool), T-60d does not. If the
    # walk-back ever regresses, T-0d silently becomes unreadable again.
    if walked != [0, 1]:
        fails.append(f"walk-back over non-pool txs did not behave as expected: "
                     f"skipped {walked}, expected [0, 1]")
    else:
        print("walked back over the non-pool tx at T-0d, none needed at T-60d: OK")
    if lps[0] == lps[1]:
        fails.append("LP supply did not change across the 60d window -- the "
                     "in-window deposit was not picked up")
    elif lps[1] <= lps[0]:
        fails.append(f"LP supply moved the wrong way: {lps[0]} -> {lps[1]}")

    # the mock asserts internally, but make the intent explicit in the output
    if NFT in ASKED_ASSETS:
        fails.append("history was paged by the venue-wide NFT")
    else:
        print("\nhistory paged by the pool's LP asset, not the shared MSP NFT: OK")

    # ---- 2. LP cross-check must catch a Value/datum disagreement ----------
    global BREAK_CROSSCHECK
    BREAK_CROSSCHECK = True
    _, cross_problems, _ = run([NOW])
    BREAK_CROSSCHECK = False
    if not cross_problems:
        fails.append("LP cross-check should have flagged the disagreement")
    else:
        print("LP cross-check fired as intended (problem(s) flagged)")

    # ---- 2b. an output at the pool credential missing a required unit ------
    # This must be reported, not quietly walked past. The walk-back added for
    # non-pool txs is exactly the mechanism that could swallow it.
    global BREAK_UNITS
    BREAK_UNITS = True
    _, unit_problems, _ = run([NOW])
    BREAK_UNITS = False
    if not unit_problems:
        fails.append("a pool output missing the NFT should have been reported, "
                     "not silently walked past")
    else:
        print("rejected pool output was reported, not walked past (problem(s) flagged)")

    # ---- 3. a Minswap pool with no track_asset must be refused -----------
    print("\n########## missing track_asset ##########")
    import json
    import os
    tmp_path = "/tmp/mock_min_no_track_pools.json"
    with open(tmp_path, "w") as fh:
        json.dump([{"label": "MIN2-ADA-MIN", "venue": "minswap-v2", "nft": NFT,
                    "script_hash": SH, "lp_asset": LP, "track_asset": "",
                    "asset_a": "lovelace", "asset_b": TOKB}], fh)
    try:
        C.load_pools(tmp_path)
        fails.append("a minswap-v2 pool without track_asset should be rejected")
    except SystemExit as e:
        print(f"rejected at load time as intended:\n  {e}")
    finally:
        os.remove(tmp_path)

    print()
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  * " + f)
        return 1
    print("minswap mock end-to-end: all checks passed")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())

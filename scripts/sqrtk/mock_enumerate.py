#!/usr/bin/env python3
"""
Offline dry-run of enumerate_minswap.py.

No network. Fabricates a pool-script address listing that deliberately contains
every case the enumerator has to handle:

    * an ADA pair, resolved by derivation
    * a TOKEN/TOKEN pair -- the case an earlier version silently dropped,
      because its min-ADA made the Value look like three assets
    * a pool whose pair is stated in reverse order -> ordering must come from
      the derivation, not from the order Blockfrost happened to list units in
    * a pool whose LP token matches NO ordering -> pair must come from the
      datum, be flagged, and still emit the OBSERVED (correct) LP id
    * a pool with a stray airdropped token in the Value alongside a real pair
    * two tokens sharing an asset name -> labels must be de-duplicated
    * a decoy output with no MSP NFT -> must be skipped
    * more pools than --top          -> drop must be announced

    python3 mock_enumerate.py
"""
import contextlib
import io
import json
import os
import sys
import types

import sqrtk_snapshot as S
import enumerate_minswap as E
from lp_name import LP_POLICY, POOL_NFT, lp_asset_name

TOK = {
    "MIN":  "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6" + "4d494e",
    "SNEK": "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f" + "534e454b",
    "IAG":  "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114" + "494147",
    "DJED": "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61" + "446a65644d6963726f555344",
}


def lp_of(a, b):
    pa, na = E.split(a)
    pb, nb = E.split(b)
    return LP_POLICY + lp_asset_name(pa, na, pb, nb)


def utxo(ada, assets, lp, nft=True, extra=None, qty=123_456_789):
    amount = [{"unit": "lovelace", "quantity": str(ada)}]
    for u in assets:
        if u != "lovelace":
            amount.append({"unit": u, "quantity": str(qty)})
    if nft:
        amount.append({"unit": POOL_NFT, "quantity": "1"})
    if lp:
        amount.append({"unit": lp, "quantity": "9000000000000000000"})
    for u in (extra or []):
        amount.append({"unit": u, "quantity": "5"})
    idx = len(ROWS)
    return {"tx_hash": f"{idx:064x}", "output_index": 0,
            "amount": amount, "data_hash": f"da{idx:062x}"}


ROWS: list = []
# 1. biggest: ADA/MIN
ROWS.append(utxo(9_000_000_000_000, ["lovelace", TOK["MIN"]],
                 lp_of("lovelace", TOK["MIN"])))
# 2. TOKEN/TOKEN -- its lovelace is min-ADA only, not a reserve
ROWS.append(utxo(4_000_000_000_000, [TOK["SNEK"], TOK["IAG"]],
                 lp_of(TOK["SNEK"], TOK["IAG"])))
# 3. reversed ordering: the pool's asset_a is the token, asset_b is ADA
ROWS.append(utxo(3_500_000_000_000, ["lovelace", TOK["IAG"]],
                 lp_of(TOK["IAG"], "lovelace")))
# 4. LP token matching no ordering -> must fall back to the datum
ROWS.append(utxo(3_000_000_000_000, ["lovelace", TOK["DJED"]],
                 LP_POLICY + "ff" * 32))
# 5. a real ADA/SNEK pair with a stray airdropped token in the Value
ROWS.append(utxo(2_500_000_000_000, ["lovelace", TOK["SNEK"]],
                 lp_of("lovelace", TOK["SNEK"]), extra=[TOK["DJED"]]))
# 6. a second token whose asset NAME is also 4d494e ("MIN") under a different
#    policy -- the label must not collide with pool 1
MIN2 = "aa" * 28 + "4d494e"
ROWS.append(utxo(2_000_000_000_000, ["lovelace", MIN2],
                 lp_of("lovelace", MIN2)))
# 7. smallest -- will be dropped by --top 6
ROWS.append(utxo(1_000_000_000, ["lovelace", TOK["IAG"]],
                 lp_of("lovelace", TOK["IAG"])))
# 8. decoy: no MSP NFT (a batcher output sitting at the same address)
ROWS.append(utxo(5_000_000_000_000, ["lovelace", TOK["MIN"]],
                 lp_of("lovelace", TOK["MIN"]), nft=False))
# 9. THE REGRESSION CASE. A token/token pool holding min-ADA only. Ranked on
#    its lovelace it is the smallest output here and gets dropped; priced
#    through the ADA pools above it is the largest pool on the venue.
ROWS.append(utxo(2_000_000, [TOK["MIN"], TOK["SNEK"]],
                 lp_of(TOK["MIN"], TOK["SNEK"]), qty=100_000_000))
# 10. a token/token pool whose tokens have NO deep ADA pool -> unpriced, so it
#     must be reported as unsized rather than silently ranked at zero
ORPHAN_X = "bb" * 28 + "584f52"
ORPHAN_Y = "cc" * 28 + "594f52"
ROWS.append(utxo(2_000_000, [ORPHAN_X, ORPHAN_Y], lp_of(ORPHAN_X, ORPHAN_Y)))

PAGES = {1: ROWS}
DATUM_FETCHES: list = []

# datum for pool 4 only -- the enumerator must not fetch any others
DJED_DATUM = {"constructor": 0, "fields": [
    {"constructor": 0, "fields": [{"bytes": "aa" * 28}]},
    {"constructor": 0, "fields": [{"bytes": ""}, {"bytes": ""}]},
    {"constructor": 0, "fields": [{"bytes": TOK["DJED"][:56]},
                                  {"bytes": TOK["DJED"][56:]}]},
    {"int": 1}, {"int": 2}, {"int": 3}, {"int": 30}, {"int": 30},
    {"constructor": 1, "fields": []}, {"constructor": 0, "fields": []},
]}


class MockBF(S.Blockfrost):
    def __init__(self):
        self.calls = 0
        self.verbose = False
        self.env = types.SimpleNamespace(redact=lambda s: s)

    def get(self, path, params=None, retries=5):
        self.calls += 1
        assert "/utxos" in path, f"unexpected request {path}"
        page = int(path.split("page=")[1])
        return PAGES.get(page, [])

    def datum(self, datum_hash):
        self.calls += 1
        DATUM_FETCHES.append(datum_hash)
        # Only the pool whose LP token defeats the derivation may cost a datum
        # request. Any other fetch means the free path was skipped.
        assert datum_hash == f"da{3:062x}", (
            f"datum fetched for {datum_hash} -- the pair should have been "
            "resolved for free by the LP-name derivation")
        return DJED_DATUM

    def asset(self, unit):
        raise AssertionError("--tickers was not requested; /assets must not be hit")


def main():
    fails = []
    mock = MockBF()
    orig_env, orig_bf, orig_argv = S.Env, S.Blockfrost, sys.argv
    E.S.Env = lambda path=".env": types.SimpleNamespace(
        project_id="x", base_url="", redact=lambda s: s)
    E.S.Blockfrost = lambda env, verbose=True: mock
    if os.path.exists("/tmp/mock_enum_pools.json"):
        os.remove("/tmp/mock_enum_pools.json")  # enumerate now MERGES -- start clean
    sys.argv = ["enumerate_minswap.py", "--top", "7",
                "--out", "/tmp/mock_enum_pools.json"]
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            rc = E.main()
    finally:
        E.S.Env, E.S.Blockfrost, sys.argv = orig_env, orig_bf, orig_argv
    out = buf.getvalue()
    print(out)

    print(f"\n--- assertions ---")
    if rc != 0:
        fails.append(f"expected exit 0, got {rc}")

    pools = json.load(open("/tmp/mock_enum_pools.json"))
    if len(pools) != 7:
        fails.append(f"expected 7 pools after --top 7, got {len(pools)}")

    lps = [p["lp_asset"] for p in pools]
    if len(set(lps)) != len(lps):
        fails.append("duplicate lp_asset emitted -- a decoy leaked through")

    order = [p["label"] for p in pools]
    print(f"labels in ADA order: {order}")
    by_lp = {p["lp_asset"]: p for p in pools}

    def pool_for(a, b):
        p = by_lp.get(lp_of(a, b))
        if p is None:
            fails.append(f"no pool emitted for the pair {a[:12]}/{b[:12]}")
        return p

    # 1. ADA/MIN
    p = pool_for("lovelace", TOK["MIN"])
    if p and (p["asset_a"], p["asset_b"]) != ("lovelace", TOK["MIN"]):
        fails.append("ADA/MIN pair emitted in the wrong order")

    # 2. token/token: the case the old classify() silently dropped
    p = pool_for(TOK["SNEK"], TOK["IAG"])
    if p and (p["asset_a"], p["asset_b"]) != (TOK["SNEK"], TOK["IAG"]):
        fails.append("token/token pair emitted in the wrong order")
    if p and "lovelace" in (p["asset_a"], p["asset_b"]):
        fails.append("token/token pool's min-ADA was mistaken for a pool asset")

    # 3. reversed ordering must come from the derivation, not from Value order
    p = pool_for(TOK["IAG"], "lovelace")
    if p and (p["asset_a"], p["asset_b"]) != (TOK["IAG"], "lovelace"):
        fails.append("reversed pair was not emitted in the pool's own order")

    # 4. derivation defeated -> datum fallback, observed LP still emitted
    p = by_lp.get(LP_POLICY + "ff" * 32)
    if p is None:
        fails.append("the undeducible pool was dropped instead of using the datum")
    else:
        if "read from the datum" not in p["_comment"]:
            fails.append("datum fallback was not recorded in _comment")
        if (p["asset_a"], p["asset_b"]) != ("lovelace", TOK["DJED"]):
            fails.append(f"datum fallback returned the wrong pair: "
                         f"{p['asset_a'][:12]}/{p['asset_b'][:12]}")
    if DATUM_FETCHES != [f"da{3:062x}"]:
        fails.append(f"expected exactly 1 datum fetch, got {len(DATUM_FETCHES)}")

    # 5. a stray airdropped token must not confuse the pair
    p = pool_for("lovelace", TOK["SNEK"])
    if p and TOK["DJED"] in (p["asset_a"], p["asset_b"]):
        fails.append("the airdropped token was mistaken for a pool asset")

    # 6. two tokens sharing an asset name must not collide as labels
    if len(set(order)) != len(order):
        fails.append(f"labels collided: {order}")
    if not any(l.endswith("-2") for l in order):
        fails.append("expected a '-2' suffixed label for the shared asset name")

    # 7. THE REGRESSION. MIN/SNEK holds 2 ADA of min-ADA and would have been
    #    dropped dead last under lovelace ranking. Priced through the ADA pools
    #    it is the second largest pool here and must survive --top.
    p = by_lp.get(lp_of(TOK["MIN"], TOK["SNEK"]))
    if p is None:
        fails.append("the token/token pool was dropped -- ranking is still blind "
                     "to pools whose lovelace is only min-ADA")
    else:
        if order.index(p["label"]) != 1:
            fails.append(f"token/token pool ranked {order.index(p['label'])}, "
                         "expected 2nd by estimated size")
        if "estimated" not in p["_comment"]:
            fails.append("an estimated size was not labelled as estimated")
        if "measured" in p["_comment"]:
            fails.append("an estimated size was described as measured")

    # 8. an ADA pool's size must still be described as measured, not estimated
    p = pool_for("lovelace", TOK["MIN"])
    if p and "measured" not in p["_comment"]:
        fails.append("an ADA pool's size should be recorded as measured")

    # 9. the unpriceable pool must be dropped LOUDLY, not silently
    if lp_of(ORPHAN_X, ORPHAN_Y) in by_lp:
        fails.append("the unpriced pool should not have outranked sized pools")
    if "WITHOUT being sized" not in out:
        fails.append("dropping an unsized pool was not announced")

    # every pool must carry track_asset == lp_asset and the venue-wide nft
    for p in pools:
        if p["track_asset"] != p["lp_asset"]:
            fails.append(f"{p['label']}: track_asset != lp_asset")
        if p["nft"] != POOL_NFT:
            fails.append(f"{p['label']}: wrong nft")
        if p["venue"] != "minswap-v2":
            fails.append(f"{p['label']}: wrong venue")

    # the emitted file must load cleanly through the real loader
    with open("/tmp/mock_enum_pools.json") as fh:
        pass
    try:
        loaded = S.load_pools("/tmp/mock_enum_pools.json")
        print(f"load_pools accepted all {len(loaded)} emitted pools; "
              f"identity of #1 = {loaded[0].identity[:20]}…")
        if loaded[0].identity != loaded[0].track_asset:
            fails.append("Pool.identity did not resolve to track_asset")
    except SystemExit as e:
        fails.append(f"load_pools rejected the enumerator's own output: {e}")

    print(f"API calls: {mock.calls} (1 UTxO page + 1 datum fallback expected)")

    print()
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  * " + f)
        return 1
    print("enumerator dry-run: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
ADApose Labs -- offline self-tests for sqrtk_core.py. No network, no key.
Replaces sqrtk_snapshot.py's embedded `selftest` subcommand -- standalone
now that sqrtk_snapshot.py is retired, testing sqrtk_core.py directly.

    python3 selftest.py
"""
from __future__ import annotations

import sys
from decimal import Decimal

import sqrtk_core as C


def main() -> int:
    fails = []

    def check(name, cond, detail=""):
        print(f"  {'PASS' if cond else 'FAIL'}  {name}{'  ' + detail if detail and not cond else ''}")
        if not cond:
            fails.append(name)

    print("bech32 / credential:")
    # WingRiders V2 CPMM script hash, enterprise (0x71) form, built from raw bytes
    def enc(hrp, payload):
        def polymod(values):
            gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
            chk = 1
            for v in values:
                b = chk >> 25
                chk = ((chk & 0x1FFFFFF) << 5) ^ v
                for i in range(5):
                    chk ^= gen[i] if ((b >> i) & 1) else 0
            return chk
        def hrp_expand(h):
            return [ord(c) >> 5 for c in h] + [0] + [ord(c) & 31 for c in h]
        def convert(data):
            acc, bits, ret = 0, 0, []
            for b in data:
                acc = (acc << 8) | b
                bits += 8
                while bits >= 5:
                    bits -= 5
                    ret.append((acc >> bits) & 31)
            if bits:
                ret.append((acc << (5 - bits)) & 31)
            return ret
        data = convert(payload)
        chk = polymod(hrp_expand(hrp) + data + [0] * 6) ^ 1
        return hrp + "1" + "".join(C._B32[d] for d in data) + \
            "".join(C._B32[(chk >> 5 * (5 - i)) & 31] for i in range(6))

    sh = "af97793b8702f381976cec83e303e9ce17781458c73c4bb16fe02b83"
    ent = enc("addr", bytes([0x71]) + bytes.fromhex(sh))
    base = enc("addr", bytes([0x11]) + bytes.fromhex(sh) + bytes(28))
    check("enterprise 0x71 -> payment credential", C.payment_credential(ent) == sh,
          f"got {C.payment_credential(ent)}")
    check("base 0x11 -> same payment credential", C.payment_credential(base) == sh,
          f"got {C.payment_credential(base)}")
    check("both recognised as script addresses",
          C.address_is_script(ent) and C.address_is_script(base))

    print("output selection:")
    utxos = {"outputs": [
        {"address": enc("addr", bytes([0x61]) + bytes(28)),   # key address, decoy
         "amount": [{"unit": "NFT", "quantity": "1"}]},
        {"address": ent,
         "amount": [{"unit": "lovelace", "quantity": "1000000000"},
                    {"unit": "TOKENB", "quantity": "2000000"},
                    {"unit": "NFT", "quantity": "1"}]},
    ]}
    picked = C.select_pool_output(utxos, sh, "NFT")
    check("picks the script output carrying the NFT, not the decoy",
          picked is not None and C.value_of(picked, "lovelace") == 1_000_000_000)
    check("rejects wrong script hash", C.select_pool_output(utxos, "bb" * 28, "NFT") is None)
    # the decoy is a KEY address whose credential is 28 zero bytes; a naive
    # matcher that ignores the header byte would return it
    check("rejects a key address with a colliding credential",
          C.select_pool_output(utxos, "00" * 28, "NFT") is None)
    check("rejects when the NFT is absent",
          C.select_pool_output({"outputs": [{"address": ent, "amount": [
              {"unit": "lovelace", "quantity": "5"}]}]}, sh, "NFT") is None)

    print("datum path walking:")
    dat = {"constructor": 0, "fields": [
        {"bytes": "aa"}, {"int": 111}, {"int": 222},
        {"constructor": 0, "fields": [{"int": 333}]},
    ]}
    check("int path", C.dig(dat, ["fields", 1, "int"]) == 111)
    check("nested path", C.dig(dat, ["fields", 3, "fields", 0, "int"]) == 333)
    check("missing path returns None", C.dig(dat, ["fields", 9, "int"]) is None)

    print("sqrt(k)/LP math:")
    s0 = C.State("t", 0, "a", 1_000_000_000, 1_000_000_000, 1_000_000_000)
    check("sqrt(k)/LP of a balanced pool == 1", abs(s0.sqrt_k_per_lp - 1) < Decimal("1e-30"))

    # a pure swap moves reserves but must NOT move sqrt(k)/LP (fee-free case)
    x, y = 1_000_000_000, 1_000_000_000
    k = x * y
    x2 = x + 10_000_000
    y2 = k // x2
    s_swap = C.State("t", 0, "b", x2, y2, 1_000_000_000)
    check("fee-free swap leaves sqrt(k)/LP unchanged",
          abs(s_swap.sqrt_k_per_lp - s0.sqrt_k_per_lp) < Decimal("1e-8"),
          f"{s_swap.sqrt_k_per_lp} vs {s0.sqrt_k_per_lp}")

    # a deposit scales reserves and LP together -> unchanged
    s_dep = C.State("t", 0, "c", 2_000_000_000, 2_000_000_000, 2_000_000_000)
    check("deposit leaves sqrt(k)/LP unchanged",
          abs(s_dep.sqrt_k_per_lp - s0.sqrt_k_per_lp) < Decimal("1e-30"))

    # fees only -> strictly up
    s_fee = C.State("t", 0, "d", 1_003_000_000, 1_003_000_000, 1_000_000_000)
    check("fee accrual raises sqrt(k)/LP", s_fee.sqrt_k_per_lp > s0.sqrt_k_per_lp)

    ratio = s_fee.sqrt_k_per_lp / s0.sqrt_k_per_lp
    apr = (ratio ** (Decimal(365) / Decimal(30)) - 1) * 100
    check("0.3% over 30d annualises to ~3.7%/yr", Decimal("3.5") < apr < Decimal("3.9"),
          f"got {apr:.3f}")

    print("forgetting a treasury accumulator:")
    # A pool whose treasury grows: Value rises but so does the treasury.  An
    # adapter that forgets to subtract it reports k growing faster than fees.
    correct_now = C.State("t", 0, "e", 1_003_000_000, 1_003_000_000, 1_000_000_000)
    forgot_now = C.State("t", 0, "e", 1_003_000_000 + 500_000, 1_003_000_000, 1_000_000_000)
    check("forgotten treasury inflates the APR (silent, not a crash)",
          forgot_now.sqrt_k_per_lp > correct_now.sqrt_k_per_lp)

    print("page search:")
    # 950 txs newest-first over 950 distinct timestamps; target sits mid-history
    fake = [{"tx_hash": f"{i:064x}", "block_time": 100000 - i} for i in range(950)]

    class FakeBF:
        calls = 0
        def asset_txs_page(self, nft, page, order="desc", count=100):
            FakeBF.calls += 1
            return fake[(page - 1) * 100: page * 100]

    fb = FakeBF()
    # oldest block_time present is 100000-949 = 99051
    for target in (100_000, 99_999, 99_500, 99_100, 99_051):
        got = C.find_tx_at_or_before(fb, "nft", target, verbose=False)
        expect = next(r for r in fake if r["block_time"] <= target)
        check(f"finds newest tx <= {target}", bool(got) and got["tx_hash"] == expect["tx_hash"],
              f"got {got['block_time'] if got else None} want {expect['block_time']}")
    check("returns None when the target predates the pool",
          C.find_tx_at_or_before(fb, "nft", 99_050, verbose=False) is None)
    check("returns newest tx when target is in the future",
          (C.find_tx_at_or_before(fb, "nft", 200_000, verbose=False) or {}).get("block_time") == 100_000)
    check("search stayed cheap (<60 page reads for 7 lookups)", FakeBF.calls < 60,
          f"used {FakeBF.calls}")

    print()
    if fails:
        print(f"{len(fails)} FAILED: {fails}")
        return 1
    print("all self-tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

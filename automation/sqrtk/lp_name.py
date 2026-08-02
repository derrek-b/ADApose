#!/usr/bin/env python3
"""
Compute a Minswap V2 LP asset id from the pool's asset pair.

Derivation, taken from the contract source (NOT guessed):
    github.com/minswap/minswap-dex-v2  lib/amm_dex_v2/utils.ak
      fn compute_lp_asset_name(pa, na, pb, nb):
          a_ident   = sha3_256(pa ++ na)
          b_ident   = sha3_256(pb ++ nb)
          lp_name   = sha3_256(a_ident ++ b_ident)

The same file ships a unit test vector for ADA-MIN; this script verifies
against it on every run, so a wrong answer announces itself instead of being
quietly accepted.

Asset order matters: assetA/assetB are the pool's own ordering, which for an
ADA pair puts ADA (empty policy, empty name) first.  If a derived id does not
resolve on chain, try the reverse order before assuming anything else.

    # ADA paired with a token, giving the token's unit (policy+hexname):
    python3 lp_name.py --pair lovelace 29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6+4d494e

    # or as one concatenated unit string, which is how Blockfrost reports it:
    python3 lp_name.py --pair lovelace 29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e

    # just check the test vector and exit:
    python3 lp_name.py --selftest
"""
import argparse
import hashlib
import sys

# Minswap V2 mainnet, from deployed/mainnet/script.json
LP_POLICY = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c"
POOL_NFT = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c" + "4d5350"
POOL_SCRIPT_HASH = "ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b"

TEST_VECTOR = (
    ("", ""),
    ("29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6", "4d494e"),
    "82e2b1fd27a7712a1a9cf750dfbea1a5778611b20e06dd6a611df7a643f8cb75",
)


def sha3(b: bytes) -> bytes:
    return hashlib.sha3_256(b).digest()


def lp_asset_name(pa: str, na: str, pb: str, nb: str) -> str:
    a = sha3(bytes.fromhex(pa) + bytes.fromhex(na))
    b = sha3(bytes.fromhex(pb) + bytes.fromhex(nb))
    return sha3(a + b).hex()


def split_unit(unit: str) -> tuple[str, str]:
    """
    Accepts 'lovelace', 'policy+name', or the concatenated 'policyname' form
    Blockfrost uses.  A policy id is always 28 bytes = 56 hex chars.
    """
    unit = unit.strip()
    if unit.lower() in ("lovelace", "ada", ""):
        return "", ""
    if "+" in unit:
        pol, name = unit.split("+", 1)
        return pol.strip(), name.strip()
    if len(unit) < 56:
        sys.exit(f"{unit!r} is too short to be a policy id (need 56 hex chars)")
    return unit[:56], unit[56:]


def selftest() -> bool:
    (pa, na), (pb, nb), expected = TEST_VECTOR
    got = lp_asset_name(pa, na, pb, nb)
    ok = got == expected
    print(f"test vector ADA-MIN: {'OK' if ok else 'FAILED'}")
    if not ok:
        print(f"  computed {got}")
        print(f"  expected {expected}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", nargs=2, metavar=("ASSET_A", "ASSET_B"),
                    help="the two pool assets; use 'lovelace' for ADA")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if not selftest():
        return 1
    if args.selftest:
        return 0
    if not args.pair:
        ap.error("give --pair ASSET_A ASSET_B (or --selftest)")

    pa, na = split_unit(args.pair[0])
    pb, nb = split_unit(args.pair[1])
    fwd = lp_asset_name(pa, na, pb, nb)
    rev = lp_asset_name(pb, nb, pa, na)

    print()
    print(f"assetA policy={pa or '(none, ADA)'} name={na or '(none)'}")
    print(f"assetB policy={pb or '(none, ADA)'} name={nb or '(none)'}")
    print()
    print("as given (A,B):")
    print(f"  lp_asset    {LP_POLICY}{fwd}")
    print("reversed (B,A) -- try this if the above does not resolve on chain:")
    print(f"  lp_asset    {LP_POLICY}{rev}")
    print()
    print("pools.json entry:")
    print("  {")
    print('    "label": "MIN2-...",')
    print('    "venue": "minswap-v2",')
    print(f'    "script_hash": "{POOL_SCRIPT_HASH}",')
    print(f'    "nft": "{POOL_NFT}",')
    print(f'    "track_asset": "{LP_POLICY}{fwd}",')
    print(f'    "lp_asset": "{LP_POLICY}{fwd}",')
    print(f'    "asset_a": "{args.pair[0]}",')
    print(f'    "asset_b": "{pb}{nb}"')
    print("  }")
    return 0


if __name__ == "__main__":
    sys.exit(main())

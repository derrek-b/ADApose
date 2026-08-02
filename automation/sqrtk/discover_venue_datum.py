#!/usr/bin/env python3
"""
ADApose Labs -- dump a pool's raw datum so its field indices can be MAPPED,
not guessed. Prints to stdout only; nothing is written anywhere.

For onboarding a brand-new VENUE (not a new pool at an already-verified
venue) -- rare, manual, one-time-per-venue. Read the printed datum JSON,
hand-map the field indices into sqrtk_core.py's Venue config, then set
verified=True only once the mapping is confirmed against the real contract
source, not just against what looks plausible.

    python3 discover_venue_datum.py --pools pools.json [--pool LABEL]
"""
from __future__ import annotations

import argparse
import json
import sys

import sqrtk_core as C


def cmd_discover(args) -> int:
    env = C.Env(args.env_file)
    bf = C.Blockfrost(env)
    pools = C.load_pools(args.pools)
    targets = [p for p in pools if not args.pool or p.label == args.pool]
    if not targets:
        sys.exit(f"no pool matching {args.pool!r} in {args.pools}")

    for pool in targets:
        print(f"\n=== {pool.label}  ({pool.venue}) ===")
        rows = bf.asset_txs_page(pool.identity, 1, order="desc")
        if not rows:
            print("  no transactions found for this NFT -- is the asset id right?")
            continue
        for row in rows[:6]:
            utxos = bf.tx_utxos(row["tx_hash"])
            out = C.select_pool_output(utxos, pool.script_hash, pool.required_units) if utxos else None
            if not out:
                continue
            print(f"  tx {row['tx_hash']}  block_time {row['block_time']}")
            print(f"  address        {out['address']}")
            print(f"  payment cred   {C.payment_credential(out['address'])}")
            print(f"  is script addr {C.address_is_script(out['address'])}")
            print("  Value:")
            for amt in out["amount"]:
                print(f"      {amt['quantity']:>24}  {amt['unit']}")
            dat = C.fetch_datum(bf, out)
            print("  Datum (Blockfrost PlutusData JSON):")
            print("    " + json.dumps(dat, indent=2).replace("\n", "\n    "))
            print("\n  Map treasury/reserve fields to paths like [\"fields\", 5, \"int\"] and put\n"
                  "  them in the Venue config. Confirm against the contract source before use.")
            break
        else:
            print("  found NFT transactions but no output at the configured script_hash --\n"
                  "  check script_hash (it is the PAYMENT CREDENTIAL, not the full address).")
    print(f"\n{bf.calls} API calls used.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=".env")
    ap.add_argument("--pools", required=True)
    ap.add_argument("--pool", default="")
    args = ap.parse_args()
    return cmd_discover(args)


if __name__ == "__main__":
    sys.exit(main())

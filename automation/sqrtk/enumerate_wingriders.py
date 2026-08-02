#!/usr/bin/env python3
"""
Build a real pools.json for WingRiders V2 by enumerating every pool on the venue.

Everything this script assumes about WingRiders is taken from the contract
source, not guessed:  wingriders/dex-v2-contracts, commit 280a9e8.

  * All three DEX token kinds live under ONE policy, `dexSymbol`
    (src/DEX/Mint/Validity.hs:99-102):
        - factory token, name "F"  = 0x46   (singleton, venue-wide)
        - validity token, name "L" = 0x4c   (one per pool, SAME name on every
                                             pool -- Constants.hs:102-103,
                                             enforced at Factory.hs:215)
        - share tokens             (one asset per pool, unique name)
    So a pool output is exactly: an output holding 1 unit of <policy>4c.

  * The pool holds its own unissued share reserve
    (Validity.hs:102 "Pool holds a reserve of pre-minted share tokens"), so the
    share token is present in the Value and is the per-pool unique identity.
    That makes it the `track_asset`, and it is also the `lp_asset`.

  * The pair is NOT read off the Value by elimination alone.  The datum states
    it outright -- assetASymbol/assetAToken at PoolDatum fields 1/2 and
    assetBSymbol/assetBToken at fields 3/4 (src/DEX/Types/Pool.hs:88-119) --
    and ORDER MATTERS here, because treasuryA/treasuryB in the same datum are
    subtracted from the A and B sides respectively.  Getting the pair backwards
    would silently subtract the wrong treasury from the wrong reserve.  So the
    Value is used only to shortlist by size (free), and the datum is fetched
    for the pools that survive --top (one request each).

HOW POOLS ARE FOUND -- and why not by address
---------------------------------------------
The obvious approach, listing the UTxOs at the pool script's ENTERPRISE
address, finds only a small minority of the venue.  Measured 2026-07-30: that
address held 15 UTxOs / 14 pools, the largest 352 ADA, most of them dust.

The contract explains why.  WingRiders V2 delegates pool ADA -- there is a
`stakingAgentTokenName = "S"` and a `defaultStakingAgentTokenCount`
(Constants.hs:114-115, 133-134).  A delegating pool must sit at a BASE address:
the same script payment credential PLUS a staking credential.  Change the
staking credential and you get a different address for the identical script.
So there is no single "the pool address", and no address list can be derived
from the script hash -- only the enterprise form can, and that is precisely the
form the live pools do not use.

The venue-wide validity token solves it.  Every pool output holds exactly one
unit of <policy>"L", so /assets/<policy>4c/addresses enumerates every address
holding a pool, base or enterprise, with no derivation and nothing assumed.
Each such address then has its UTxOs listed directly.

The policy id itself is still discovered rather than hardcoded: the enterprise
address is read once at startup purely to observe which policy carries the "L"
token.  Pass --policy to skip that call.

Usage:

    python3 enumerate_wingriders.py --top 40 --out pools.json

    # skip the bootstrap call if you already know the policy
    python3 enumerate_wingriders.py --policy 6fdc63a1... --top 40

    # reproduce the old (enterprise-address-only) behaviour
    python3 enumerate_wingriders.py --enterprise-only

MERGES into --out, never overwrites it: pools already present (matched by
(venue, track_asset), not label) are left untouched; this run only adds
pools it hasn't seen there before -- so --out defaults to pools.json, the
same shared file enumerate_minswap.py targets, not a separate per-venue
file. Safe to re-run any time.

Reads BLOCKFROST_PROJECT_ID from .env, same as sqrtk_core.py.
"""
import argparse
import json
import os
import re
import sys

import sqrtk_core as S

# WingRiders V2 constant-product pool script hash (payment credential).
POOL_SCRIPT_HASH = "af97793b8702f381976cec83e303e9ce17781458c73c4bb16fe02b83"

FACTORY_NAME = "46"   # "F"
VALIDITY_NAME = "4c"  # "L"

LOVELACE = "lovelace"
_B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def bech32_encode(hrp: str, payload: bytes) -> str:
    def polymod(values):
        gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
        chk = 1
        for v in values:
            b = chk >> 25
            chk = ((chk & 0x1FFFFFF) << 5) ^ v
            for i in range(5):
                chk ^= gen[i] if ((b >> i) & 1) else 0
        return chk
    acc = bits = 0
    data = []
    for byte in payload:
        acc = (acc << 8) | byte
        bits += 8
        while bits >= 5:
            bits -= 5
            data.append((acc >> bits) & 31)
    if bits:
        data.append((acc << (5 - bits)) & 31)
    hrp_x = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]
    chk = polymod(hrp_x + data + [0] * 6) ^ 1
    return hrp + "1" + "".join(_B32[d] for d in data) + \
        "".join(_B32[(chk >> 5 * (5 - i)) & 31] for i in range(6))


def enterprise_address(script_hash: str) -> str:
    return bech32_encode("addr", bytes([0x71]) + bytes.fromhex(script_hash))


def identify(amount: list) -> tuple[str, str, str, list] | None:
    """
    Given a UTxO's Value, return (policy, validity_unit, share_unit, others)
    or None if this is not a WingRiders pool output.

    The policy is discovered, not assumed: whichever policy carries a unit
    named "L" with quantity 1 is the dex policy for this output.
    """
    qty = {a["unit"]: int(a["quantity"]) for a in amount}
    validity = None
    for unit, q in qty.items():
        if unit != LOVELACE and unit[56:] == VALIDITY_NAME and q == 1:
            validity = unit
            break
    if not validity:
        return None
    policy = validity[:56]
    shares = [u for u in qty
              if u != LOVELACE and u[:56] == policy
              and u[56:] not in (VALIDITY_NAME, FACTORY_NAME)]
    if len(shares) != 1:
        return None
    others = [u for u in qty if u == LOVELACE or u[:56] != policy]
    return policy, validity, shares[0], others


def decode_ticker(unit: str) -> str:
    """
    Best-effort human ticker from an on-chain asset unit (policy+hexname, or
    the literal string 'lovelace'). Handles plain ASCII names and CIP-67
    labeled tokens (a 4-byte numeric-label prefix, stripped before decoding
    -- e.g. USDM/ATLAS/TITAN/GENS on this venue all carry one). Falls back to
    the first 8 hex chars of the raw asset name if nothing decodes cleanly;
    never raises, always returns something usable in a label.
    """
    if unit == LOVELACE:
        return "ADA"
    name_hex = unit[56:]

    def try_ascii(b: bytes) -> str | None:
        try:
            s = b.decode("ascii")
        except Exception:
            return None
        stripped = s.strip()
        return stripped if stripped and all(c.isprintable() for c in stripped) else None

    def leading_token(s: str) -> str | None:
        m = re.match(r"^[A-Za-z0-9]+", s)
        return m.group(0).upper() if m else None

    raw_bytes = bytes.fromhex(name_hex) if name_hex else b""
    direct = try_ascii(raw_bytes)
    if direct is not None:
        tok = leading_token(direct)
        if tok:
            return tok
    if len(raw_bytes) > 4:
        cip67 = try_ascii(raw_bytes[4:])
        if cip67 is not None:
            tok = leading_token(cip67)
            if tok:
                return tok
    return (name_hex[:8].upper() or "UNKNOWN")


def asset_from_datum(dat, sym_path, tok_path) -> str | None:
    """PoolDatum stores a pair as (CurrencySymbol, TokenName); ADA is ("","")."""
    sym = S.dig(dat, sym_path)
    tok = S.dig(dat, tok_path)
    if sym is None or tok is None:
        return None
    if sym == "" and tok == "":
        return LOVELACE
    return sym + tok


def page_all(bf, path: str, max_pages: int, what: str, quiet: bool = False) -> list:
    """Page a Blockfrost list endpoint to exhaustion, or warn if capped."""
    sep = "&" if "?" in path else "?"
    out = []
    for page in range(1, max_pages + 1):
        rows = bf.get(f"{path}{sep}count=100&page={page}")
        if not rows:
            break
        out.extend(rows)
        if not quiet:
            print(f"  {what} page {page}: {len(rows)} (running total {len(out)})")
        if len(rows) < 100:
            break
    else:
        print(f"  !! stopped at --max-pages={max_pages} while listing {what}; "
              f"there may be MORE than the {len(out)} listed.")
    return out


def bootstrap_policy(bf, max_pages: int) -> str | None:
    """
    Observe the dex policy id rather than assuming it.

    The enterprise address is a poor place to find pools but a fine place to
    find ONE pool, which is all this needs -- the policy is read off whichever
    output carries a validity token.
    """
    addr = enterprise_address(POOL_SCRIPT_HASH)
    print(f"bootstrap: reading the dex policy off {addr}")
    utxos = page_all(bf, f"/addresses/{addr}/utxos", max_pages,
                     "enterprise UTxOs", quiet=True)
    for u in utxos:
        got = identify(u["amount"])
        if got:
            print(f"  dex policy (observed on-chain): {got[0]}")
            return got[0]
    print("  no pool output found at the enterprise address; pass --policy.")
    return None


def collect_pool_utxos(bf, policy: str, max_pages: int) -> tuple[list, list]:
    """
    Every WR2 pool, found through the venue-wide validity token.

    Returns (utxos, rejected_addresses).  An address whose payment credential
    is not the pool script hash is REJECTED, not silently included -- holding
    an "L" token is necessary to be a pool but not sufficient to be one.
    """
    validity_asset = policy + VALIDITY_NAME
    print(f"\nlisting every address holding {validity_asset[:16]}…"
          f"{VALIDITY_NAME} (the venue-wide validity token)")
    holders = page_all(bf, f"/assets/{validity_asset}/addresses", max_pages,
                       "holder")
    if not holders:
        print("  none. Either the policy is wrong or the venue is empty.")
        return [], []

    total_tokens = sum(int(h.get("quantity", 0)) for h in holders)
    print(f"\n{len(holders)} distinct address(es) hold {total_tokens} validity "
          f"token(s) -- i.e. {total_tokens} pools across {len(holders)} "
          f"staking credential(s).")

    good, rejected = [], []
    for h in holders:
        addr = h["address"]
        if S.payment_credential(addr) != POOL_SCRIPT_HASH:
            rejected.append((addr, S.payment_credential(addr)))
            continue
        good.append(addr)

    if rejected:
        print(f"\n{len(rejected)} address(es) REJECTED -- payment credential is "
              f"not the WR2 pool script:")
        for addr, cred in rejected[:10]:
            print(f"    {addr[:40]}…  cred {cred}")

    print(f"\nlisting UTxOs at {len(good)} pool address(es)")
    utxos = []
    for i, addr in enumerate(good, 1):
        rows = page_all(bf, f"/addresses/{addr}/utxos", max_pages,
                        f"addr {i}", quiet=True)
        utxos.extend(rows)
        if len(good) <= 20 or i % 25 == 0 or i == len(good):
            print(f"  {i}/{len(good)} addresses -> {len(utxos)} UTxOs")
    return utxos, rejected


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", default=".env")
    ap.add_argument("--policy", default=None,
                    help="dex policy id; skips the bootstrap call")
    ap.add_argument("--enterprise-only", action="store_true",
                    help="old behaviour: only the enterprise address (finds a "
                         "small minority of the venue)")
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--max-pages", type=int, default=200)
    ap.add_argument("--out", default="pools.json")
    args = ap.parse_args()

    env = S.Env(args.env_file)
    bf = S.Blockfrost(env, verbose=False)

    # ---- 1. find every pool output --------------------------------------
    if args.enterprise_only:
        addr = enterprise_address(POOL_SCRIPT_HASH)
        print(f"enterprise-only mode: {addr}")
        utxos = page_all(bf, f"/addresses/{addr}/utxos", args.max_pages, "UTxO")
    else:
        policy = args.policy or bootstrap_policy(bf, args.max_pages)
        if not policy:
            return 1
        utxos, _ = collect_pool_utxos(bf, policy, args.max_pages)

    if not utxos:
        print("\nNo pool UTxOs found.")
        return 1

    # ---- 2. classify (free: no extra requests) ---------------------------
    cands, skipped = [], 0
    policies = set()
    for u in utxos:
        got = identify(u["amount"])
        if not got:
            skipped += 1
            continue
        policy_, validity, share, others = got
        policies.add(policy_)
        qty = {a["unit"]: int(a["quantity"]) for a in u["amount"]}
        cands.append({"utxo": u, "policy": policy_, "validity": validity,
                      "share": share, "others": others, "qty": qty,
                      "ada": qty.get(LOVELACE, 0)})

    print(f"\n{len(cands)} pool UTxOs identified; {skipped} outputs skipped "
          f"(no validity token, or not exactly one share token)")
    if not cands:
        return 1
    if len(policies) != 1:
        print(f"  WARNING: {len(policies)} distinct dex policies seen: "
              f"{sorted(policies)}\n"
              "  Expected exactly one. Investigate before trusting the output.")

    # ---- 3. size and rank ------------------------------------------------
    # For an ADA pool the Value's lovelace IS a reserve, minus poolOilAda.
    # For a token/token pool that lovelace is only oil, so ranking on it would
    # sort every token/token pool to the bottom -- a systematic exclusion
    # dressed up as a size cutoff.  Price those through the ADA pools in this
    # same listing.  Every pool records the basis it was ranked on so an
    # estimate is never mistaken for a measurement.
    OIL = 3_000_000
    REF_MIN_LOVELACE = 10_000_000_000          # 10k ADA
    price = {}
    for c in cands:
        toks = [u for u in c["others"] if u != LOVELACE]
        if len(toks) != 1 or c["ada"] < REF_MIN_LOVELACE:
            continue
        p = (c["ada"] - OIL) / c["qty"][toks[0]]
        if toks[0] not in price or p > 0:
            price[toks[0]] = p

    if not price:
        print(f"  !! no ADA pool is deep enough (>= {REF_MIN_LOVELACE/1e6:,.0f} "
              "ADA) to price anything, so EVERY token/token pool will rank 0 "
              "and be labelled 'unpriced'. Their size is unknown, not zero.")

    for c in cands:
        toks = [u for u in c["others"] if u != LOVELACE]
        if len(toks) == 1:
            c["size"] = 2 * (c["ada"] - OIL)
            c["basis"] = "ada-reserve"
        else:
            vals = [c["qty"][t] * price[t] for t in toks if t in price]
            c["size"] = 2 * max(vals) if vals else 0
            c["basis"] = "priced-via-ada-pools" if vals else "unpriced"

    cands.sort(key=lambda c: -c["size"])
    keep = cands[:args.top]
    n_unpriced = sum(1 for c in cands if c["basis"] == "unpriced")
    if n_unpriced:
        print(f"  note: {n_unpriced} of {len(cands)} pools are 'unpriced' and "
              "therefore sort last regardless of their real size.")
    print(f"\nkeeping the top {len(keep)} of {len(cands)} by estimated ADA size; "
          f"fetching one datum each to read the pair IN ORDER")

    # ---- 4. datum: the pair, in the contract's own A/B order --------------
    pools, failed = [], []
    for i, c in enumerate(keep, 1):
        dat = S.fetch_datum(bf, c["utxo"])
        if dat is None:
            failed.append((c["share"], "no datum"))
            continue
        a = asset_from_datum(dat, ["fields", 1, "bytes"], ["fields", 2, "bytes"])
        b = asset_from_datum(dat, ["fields", 3, "bytes"], ["fields", 4, "bytes"])
        if a is None or b is None:
            failed.append((c["share"], "pair paths did not resolve"))
            continue
        present = {u for u in c["qty"]}
        if a not in present or b not in present:
            failed.append((c["share"],
                           f"datum pair {a}/{b} not both present in the Value"))
            continue
        a_tick, b_tick = decode_ticker(a), decode_ticker(b)
        label = f"WR2-ADA-{b_tick}" if a_tick == "ADA" else f"WR2-{a_tick}-{b_tick}"
        entry = {
            "label": label,
            "venue": "wingriders-v2",
            "script_hash": POOL_SCRIPT_HASH,
            "address": c["utxo"].get("address"),
            "nft": c["validity"],
            "track_asset": c["share"],
            "lp_asset": c["share"],
            "asset_a": a,
            "asset_b": b,
            "_size_ada": round(c["size"] / 1e6, 2),
            "_size_basis": c["basis"],
        }
        # decode_ticker is best-effort (ASCII/CIP-67 only); note when a raw
        # on-chain name needed cleanup so the messy original isn't lost
        for tick, raw in ((a_tick, a), (b_tick, b)):
            if raw != LOVELACE:
                raw_hex = raw[56:]
                try:
                    raw_ascii = bytes.fromhex(raw_hex).decode("ascii").strip()
                except Exception:
                    raw_ascii = None
                if raw_ascii and raw_ascii.upper() != tick:
                    entry["_comment"] = (entry.get("_comment", "") +
                        f" raw on-chain name {raw_ascii!r} cleaned to {tick!r}.").strip()
        pools.append(entry)
        print(f"  {i:3d}. {c['size']/1e6:12,.0f} ADA  {c['basis']:22s} "
              f"{a[:16]}…/{b[:16] if b != LOVELACE else 'lovelace'}…  -> {label}")

    if failed:
        print(f"\n{len(failed)} pool(s) could not be resolved and were DROPPED:")
        for share, why in failed:
            print(f"    {share[:24]}…  {why}")

    # ---- merge against whatever --out already holds, don't overwrite it ----
    # Identity is (venue, track_asset), same key sqrtk_core.py and
    # enumerate_minswap.py both use. A pool already on file keeps its
    # existing entry untouched; this run only ADDS newly-discovered pools.
    existing = []
    if os.path.exists(args.out) and os.path.getsize(args.out) > 0:
        with open(args.out) as fh:
            existing = json.load(fh)
    existing_keys = {(p.get("venue"), p.get("track_asset")) for p in existing}
    existing_labels = {p["label"] for p in existing}

    new_pools = [p for p in pools if (p["venue"], p["track_asset"]) not in existing_keys]
    already_known = len(pools) - len(new_pools)

    seen: dict = {}
    for p in new_pools:
        base = p["label"]
        while p["label"] in existing_labels or seen.get(p["label"], 0) > 0:
            seen[base] = seen.get(base, 0) + 1
            p["label"] = f"{base}-{seen[base]}"
        seen[p["label"]] = seen.get(p["label"], 0) + 1
        existing_labels.add(p["label"])

    merged = existing + new_pools
    with open(args.out, "w") as fh:
        json.dump(merged, fh, indent=2)

    print(f"\n{already_known} of this run's {len(pools)} pools were already in "
          f"{args.out}; {len(new_pools)} are new.")
    print(f"{args.out} now holds {len(merged)} pools "
          f"({len(existing)} existing + {len(new_pools)} added).")
    print(f"{bf.calls} API calls used.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

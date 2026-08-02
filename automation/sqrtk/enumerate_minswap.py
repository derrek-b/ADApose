#!/usr/bin/env python3
"""
Build a real pools.json for Minswap V2 by enumerating the pool script address.

Every V2 pool is one UTxO at the pool validator address.  Each such UTxO's
Value contains, by construction:
    * the venue-wide MSP NFT (quantity 1)
    * that pool's own LP token, because Minswap keeps the unissued LP in the
      pool UTxO
    * the two pool assets
So the Value alone yields every field pools.json needs -- no token registry, no
third-party API, no guessing.

Which units are the pool's ASSETS is not readable off the Value, though: every
pool UTxO holds lovelace, and for a token/token pool that lovelace is only
min-ADA.  So the pair is identified by evidence rather than assumption -- the LP
asset name IS sha3_256(sha3_256(pa||na) || sha3_256(pb||nb)), so whichever
ordered pair of units reproduces the LP token in the UTxO is the pair, ordering
included.  That costs nothing but hashes.  Pools the derivation cannot resolve
fall back to the datum, which states the pair outright, and are flagged.

Ranking is done on the Value alone, so it is free.  For an ADA pool the Value's
lovelace IS a reserve and the size is measured.  For a token/token pool that
lovelace is only min-ADA, so ranking on it would sort every token/token pool to
the bottom regardless of real size -- a systematic exclusion dressed up as a
size cutoff.  Instead the ADA pools in the same listing are used to price their
tokens, and a token/token pool is valued through those prices.  Each pool
records which basis it was sized on.  Datums are fetched only for the pools that
survive --top, so the expensive part scales with what you asked for, not with
how many pools Minswap has.

    python3 enumerate_minswap.py --top 40 --out pools.json

    # include a ticker lookup per token (1 extra request per distinct token)
    python3 enumerate_minswap.py --top 40 --tickers --out pools.json

MERGES into --out, never overwrites it: pools already present (matched by
(venue, track_asset), not label) are left untouched; this run only adds
pools it hasn't seen there before. Safe to re-run any time -- e.g. to pick
up pools created since the last run, or to raise --top and reach further
down the size ranking -- without losing what's already on file.

Reads BLOCKFROST_PROJECT_ID from .env, same as sqrtk_core.py.
"""
import argparse
import json
import os
import sys

import sqrtk_core as S
from lp_name import LP_POLICY, POOL_NFT, POOL_SCRIPT_HASH, lp_asset_name, selftest

# base form: script payment credential + Minswap's pool stake key
POOL_ADDRESS = ("addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau6"
                "6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a")
MSP_NAME = "4d5350"


def split(unit):
    return ("", "") if unit == "lovelace" else (unit[:56], unit[56:])


def classify(amount):
    """
    Pull the LP token out of a pool UTxO's Value and return everything else as
    CANDIDATES for the pool pair -- not as the pair itself.

    The Value cannot tell you which units are the pool's assets.  Every pool
    UTxO holds lovelace whether or not ADA is one of its assets: an ADA pool's
    lovelace is a reserve, a token/token pool's lovelace is just min-ADA.  An
    earlier version treated `lovelace` as an asset unconditionally, which made
    every token/token pool look like a 3-asset output and get skipped.  Deciding
    that here is guesswork; `resolve_pair` decides it from evidence instead.
    """
    lp = None
    cands = []
    for amt in amount:
        unit = amt["unit"]
        if unit == POOL_NFT:
            continue
        if unit.startswith(LP_POLICY) and unit[56:] != MSP_NAME:
            lp = unit
            continue
        cands.append(unit)
    return lp, cands


def resolve_pair(cands, lp):
    """
    Identify the pool's (asset_a, asset_b) by which ordered pair reproduces the
    LP token actually sitting in the UTxO.

    This is exact, not heuristic: the LP asset name IS
    sha3_256(sha3_256(pa||na) || sha3_256(pb||nb)), so a pair that reproduces
    the observed token is the pair, and ordering falls out of it too.  Costs no
    requests -- at most a few dozen hashes.  Returns None when nothing matches,
    which is the signal to go ask the datum.
    """
    for a in cands:
        for b in cands:
            if a == b:
                continue
            pa, na = split(a)
            pb, nb = split(b)
            if LP_POLICY + lp_asset_name(pa, na, pb, nb) == lp:
                return a, b
    return None


def pair_from_datum(bf, utxo, address):
    """
    Authoritative fallback: Minswap's PoolDatum states the pair outright.
        field 1 = asset_a, field 2 = asset_b, each Asset(policy_id, asset_name)
    Source: minswap/minswap-dex-v2 lib/amm_dex_v2/types.ak.
    Costs one request, and only for pools the derivation could not resolve.
    """
    out = {"address": address, "amount": utxo["amount"],
           "data_hash": utxo.get("data_hash"),
           "inline_datum": utxo.get("inline_datum")}
    dat = S.fetch_datum(bf, out)
    if dat is None:
        return None
    try:
        units = []
        for idx in (1, 2):
            f = dat["fields"][idx]["fields"]
            unit = f[0]["bytes"] + f[1]["bytes"]
            units.append(unit if unit else "lovelace")
        return units[0], units[1]
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", default=".env")
    ap.add_argument("--address", default=POOL_ADDRESS)
    ap.add_argument("--top", type=int, default=40,
                    help="keep the N largest pools by estimated ADA size "
                         "(token/token pools priced off their ADA pools)")
    ap.add_argument("--max-pages", type=int, default=200)
    ap.add_argument("--tickers", action="store_true",
                    help="resolve a ticker per token (1 request per token)")
    ap.add_argument("--out", default="pools.json")
    args = ap.parse_args()

    if not selftest():
        return 1

    env = S.Env(args.env_file)
    bf = S.Blockfrost(env, verbose=False)

    # ---- 1. enumerate ----------------------------------------------------
    utxos = []
    for page in range(1, args.max_pages + 1):
        rows = bf.get(f"/addresses/{args.address}/utxos?count=100&page={page}")
        if not rows:
            break
        utxos.extend(rows)
        print(f"  page {page}: {len(rows)} UTxOs (running total {len(utxos)})")
        if len(rows) < 100:
            break
    else:
        print(f"  stopped at --max-pages={args.max_pages}; there may be MORE pools "
              f"than the {len(utxos)} listed. Raise --max-pages to cover them.")
    if not utxos:
        sys.exit("no UTxOs at that address -- wrong address?")

    # ---- 2. classify (free: no extra requests) ---------------------------
    cands = []
    skipped = 0
    for u in utxos:
        units = {a["unit"] for a in u["amount"]}
        if POOL_NFT not in units:
            skipped += 1
            continue
        lp, pair_cands = classify(u["amount"])
        if lp is None or len(pair_cands) < 2:
            skipped += 1
            continue
        qty = {a["unit"]: int(a["quantity"]) for a in u["amount"]}
        cands.append({"utxo": u, "lp": lp, "cands": pair_cands, "qty": qty,
                      "ada": qty.get("lovelace", 0),
                      "pair": resolve_pair(pair_cands, lp)})
    print(f"\n{len(cands)} pool UTxOs identified; {skipped} outputs skipped "
          f"(no MSP NFT, no LP token, or too few units to form a pair)")

    # ---- 2b. size every pool in ADA --------------------------------------
    # Ranking by the Value's lovelace is only meaningful for ADA pools, where
    # that lovelace IS a reserve.  A token/token pool carries min-ADA and
    # nothing more, so ranking on it sorts EVERY token/token pool to the bottom
    # regardless of real size -- a systematic exclusion, not a size cutoff.
    #
    # Fix, and it costs no requests: the ADA pools in this same listing already
    # price every token they trade against.  price[token] = lovelace / token_qty
    # in raw units, so valuing a token/token pool as 2 * qty * price needs no
    # decimals and no external price feed.  It is approximate -- a Value's
    # lovelace includes min-ADA and batcher change, and a thin reference pool
    # gives a bad price -- which is why prices are only taken from reference
    # pools above REF_MIN_LOVELACE, and why every pool records the basis it was
    # ranked on so an estimate is never mistaken for a measurement.
    REF_MIN_LOVELACE = 10_000_000_000          # 10k ADA
    price, ref_pool = {}, {}
    for c in cands:
        if not c["pair"] or c["ada"] < REF_MIN_LOVELACE:
            continue
        a, b = c["pair"]
        if a == "lovelace" and b != "lovelace":
            tok, tok_qty = b, c["qty"].get(b, 0)
        elif b == "lovelace" and a != "lovelace":
            tok, tok_qty = a, c["qty"].get(a, 0)
        else:
            continue
        if tok_qty <= 0:
            continue
        # one V2 pool per pair, but keep the deepest if that ever stops holding
        if c["ada"] > ref_pool.get(tok, (0,))[0]:
            price[tok] = c["ada"] / tok_qty
            ref_pool[tok] = (c["ada"], c["lp"])

    n_ada_pool = n_priced = n_unpriced = 0
    for c in cands:
        pair = c["pair"]
        if pair and "lovelace" in pair:
            c["tvl"] = 2 * c["ada"]
            c["basis"] = "ADA reserve in the Value (measured)"
            n_ada_pool += 1
            continue
        if pair:
            # Both sides of a balanced pool are worth the same, so either one
            # sizes it. Price off the side whose REFERENCE pool is deepest --
            # that is the price least likely to be stale or pushed around. If
            # both sides can be priced and they disagree badly, say so: that
            # disagreement is itself the signal that a reference is unreliable.
            sides = sorted(((ref_pool[u][0], u) for u in pair if u in price),
                           reverse=True)
            if sides:
                best = sides[0][1]
                c["tvl"] = 2 * c["qty"].get(best, 0) * price[best]
                c["basis"] = ("estimated: sized through the ADA pool of "
                              f"{best[56:64]}, so this figure is approximate and "
                              "used only for ranking")
                if len(sides) == 2:
                    other = sides[1][1]
                    alt = 2 * c["qty"].get(other, 0) * price[other]
                    if alt and not (1 / 3 <= c["tvl"] / alt <= 3):
                        c["basis"] += (f"; WARNING the other side prices it at "
                                       f"~{alt / 1e6:,.0f} ADA instead, so at least "
                                       "one reference pool is unreliable")
                n_priced += 1
                continue
            c["tvl"] = 0
            c["basis"] = ("UNPRICED: neither token has an ADA pool deep enough to "
                          "price it, so this pool could not be sized")
            n_unpriced += 1
            continue
        # pair unresolved by derivation; the datum could say, but that costs a
        # request and we have not applied --top yet.  Rank on lovelace and say so.
        c["tvl"] = 2 * c["ada"]
        c["basis"] = ("ranked on the Value's lovelace because the pair could not "
                      "be derived; if this is a token/token pool that figure is "
                      "min-ADA and the ranking understates it")
        n_unpriced += 1

    print(f"  sizing: {n_ada_pool} ADA pools measured, {n_priced} token/token pools "
          f"priced off ADA pools, {n_unpriced} unpriced")
    print(f"  price references taken from {len(price)} tokens with an ADA pool "
          f"deeper than {REF_MIN_LOVELACE / 1e6:,.0f} ADA")

    cands.sort(key=lambda c: -c["tvl"])
    keep = cands[: args.top]
    if len(cands) > args.top:
        dropped = cands[args.top:]
        print(f"keeping the largest {len(keep)} by estimated ADA size; DROPPED "
              f"{len(dropped)} smaller pools -- raise --top to include them")
        blind = sum(1 for c in dropped if c["tvl"] == 0)
        if blind:
            print(f"  of those, {blind} were dropped WITHOUT being sized at all "
                  f"(unpriced) -- they are not known to be small, only unmeasured")

    # ---- 3. verify the derivation and emit -------------------------------
    ticker_cache: dict = {}

    def ticker(unit):
        if unit == "lovelace":
            return "ADA"
        if not args.tickers:
            return unit[56:64]
        if unit not in ticker_cache:
            a = bf.asset(unit) or {}
            meta = a.get("metadata") or {}
            onchain = a.get("onchain_metadata") or {}
            t = meta.get("ticker") or onchain.get("ticker") or onchain.get("name")
            if not t:
                try:
                    t = bytes.fromhex(unit[56:]).decode("utf-8")
                except Exception:
                    t = unit[56:64]
            ticker_cache[unit] = str(t)[:16]
        return ticker_cache[unit]

    pools, derived_ok, from_datum, unresolved = [], 0, 0, 0
    for c in keep:
        order = c["pair"]          # already derived in step 2, for free
        if order:
            note = ("asset pair and ordering confirmed by LP-name derivation "
                    "against the LP token in the UTxO")
            derived_ok += 1
        else:
            order = pair_from_datum(bf, c["utxo"], args.address)
            if order:
                note = ("LP-name derivation did NOT reproduce this pool's LP token; "
                        "the pair was read from the datum instead (fields 1 and 2). "
                        "The lp_asset below is the OBSERVED token, so measurement is "
                        "unaffected -- but the derivation assumption does not hold "
                        "for this pool and is worth a look")
                from_datum += 1
            else:
                unresolved += 1
                print(f"  SKIPPED {c['utxo']['tx_hash'][:16]}…: pair unresolvable "
                      f"(derivation failed AND datum unreadable)")
                continue

        label = f"MIN2-{ticker(order[0])}-{ticker(order[1])}"
        pools.append({
            "_comment": (
                f"Enumerated from {args.address[:24]}… . script_hash and the datum "
                f"field paths come from the Minswap contract source "
                f"(deployed/mainnet/script.json and lib/amm_dex_v2/types.ak). "
                f"nft is the VENUE-WIDE MSP token and cannot identify a pool, which "
                f"is why track_asset is set to this pool's own LP asset. {note}. "
                f"Size at enumeration ~{c['tvl'] / 1e6:,.0f} ADA, basis: {c['basis']}. "
                f"That size is a RANKING aid only -- the measurement path never "
                f"reads it."),
            "label": label,
            "venue": "minswap-v2",
            "script_hash": POOL_SCRIPT_HASH,
            "nft": POOL_NFT,
            "track_asset": c["lp"],
            "lp_asset": c["lp"],
            "asset_a": order[0],
            "asset_b": order[1],
        })

    # ---- merge against whatever --out already holds, don't overwrite it ----
    # Identity is (venue, track_asset) -- track_asset is the pool's own unique
    # LP token, the same key sqrtk_core.py uses internally. label/address/
    # size fields are NOT identity: a pool already on file keeps its existing
    # entry untouched even if this run would have ranked or labelled it
    # differently, so a re-run only ever ADDS newly-discovered pools.
    existing = []
    if os.path.exists(args.out) and os.path.getsize(args.out) > 0:
        with open(args.out) as fh:
            existing = json.load(fh)
    existing_keys = {(p.get("venue"), p.get("track_asset")) for p in existing}
    existing_labels = {p["label"] for p in existing}

    new_pools = [p for p in pools if (p["venue"], p["track_asset"]) not in existing_keys]
    already_known = len(pools) - len(new_pools)

    # de-duplicate labels: within this run's new pools AND against the file's
    # existing labels (two pools can share a ticker pair, e.g. fee tiers)
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

    print(f"\npair resolution: {derived_ok} by LP-name derivation (free), "
          f"{from_datum} by datum fallback (1 request each), "
          f"{unresolved} unresolvable and dropped")
    if from_datum or unresolved:
        print("  Pools resolved by datum are flagged in their _comment. Their emitted")
        print("  lp_asset/track_asset are the OBSERVED tokens, so measurement is still")
        print("  correct; only the free derivation shortcut failed for those.")
    print(f"{already_known} of this run's {len(pools)} pools were already in "
          f"{args.out}; {len(new_pools)} are new.")
    print(f"{args.out} now holds {len(merged)} pools "
          f"({len(existing)} existing + {len(new_pools)} added).")
    print(f"{bf.calls} API calls used.")
    print("\nNext: python3 discover_venue_datum.py --pools "
          f"{args.out} --pool {pools[0]['label'] if pools else '<label>'}")
    print("Confirm reserve_a/reserve_b/total_liquidity against the Value, then sync "
          "new entries into the `pools` DB table -- fetch_snapshots.py picks them up "
          "automatically from there.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

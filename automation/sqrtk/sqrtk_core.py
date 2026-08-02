#!/usr/bin/env python3
"""
ADApose Labs -- shared √k measurement primitives.

Mechanically extracted from the old sqrtk_snapshot.py (that file, and
sqrtk_tick.py/sqrtk_tick_db.py, are retired -- this module holds everything
from them that's still needed). Every function here is unchanged logic, just
relocated: the mainnet-verified, hard-won part of this toolkit (Blockfrost
pagination/backoff, bech32/payment-credential decoding, the binary-search
walk into transaction history, per-venue reserve/LP-supply extraction, the
√k/LP computation) has zero dependency on what shape the caller stores a
reading in.

Three things import from here: `discover_venue_datum.py` (onboarding a new
*venue* -- confirming datum field paths, rare and manual), `fetch_snapshots.py`
(the recurring pipeline -- reads a pool's state at one or more points in
time and emits flat point-in-time snapshot rows), and `selftest.py` (offline
unit tests against these exact functions, no network).

Standard library only, by design -- no third-party dependency here at all.
(`fetch_snapshots.py` is the only file in this toolkit allowed to depend on
`psycopg`, for its own DB read.)

WHAT sqrt(k)/LP MEASURES
-------------------------
For a constant-product pool, k = x*y is held fixed by swaps. Fees are added to
the reserves without being part of the trade, so k only ever grows, and only
from fees. Therefore:

    sqrt_k_per_lp  =  sqrt(reserve_A * reserve_B) / lp_total_supply

rises ONLY from trading fees. It is unchanged by anyone's deposit or
withdrawal, and it is unchanged by price movement. Its growth rate is the
impermanent-loss-free fee yield -- which is exactly what DefiLlama's `apyBase`
*claims* to be, but derives from reported volume rather than reading k.

CORRECTNESS CHECK
-----------------
sqrt_k_per_lp must be NON-DECREASING over time for every pool. If it falls,
one of the following is true and the number must not be used:
  * the reserve source is wrong (datum reserves vs UTxO Value vs Value minus
    treasury) -- see Venue rules below;
  * a treasury accumulator was not subtracted (or one was subtracted twice);
  * the pool stopped being constant-product.
"""
from __future__ import annotations

import bisect
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from decimal import Decimal, getcontext
from typing import Any

getcontext().prec = 60

LOVELACE = "lovelace"
DAY = 86400


# --------------------------------------------------------------------------
# credentials
# --------------------------------------------------------------------------

class Env:
    """Loads Blockfrost credentials from a local .env. Never echoes the key."""

    def __init__(self, path: str = ".env"):
        vals: dict[str, str] = {}
        if os.path.exists(path):
            with open(path) as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip().strip('"').strip("'")
        # process env wins, so CI/shell export also works
        for k in ("BLOCKFROST_PROJECT_ID", "BLOCKFROST_BASE_URL"):
            if os.environ.get(k):
                vals[k] = os.environ[k]

        self.project_id = vals.get("BLOCKFROST_PROJECT_ID", "")
        self.base_url = vals.get(
            "BLOCKFROST_BASE_URL", "https://cardano-mainnet.blockfrost.io/api/v0"
        ).rstrip("/")

        if not self.project_id:
            sys.exit(
                f"BLOCKFROST_PROJECT_ID not found in {path} or the environment.\n"
                "Create a .env next to this script containing:\n"
                "  BLOCKFROST_PROJECT_ID=...\n"
                "  BLOCKFROST_BASE_URL=https://cardano-mainnet.blockfrost.io/api/v0\n"
                "The key stays on this machine; nothing prints it."
            )

    def redact(self, text: str) -> str:
        return text.replace(self.project_id, "<PROJECT_ID_REDACTED>") if self.project_id else text


# --------------------------------------------------------------------------
# rate-limited client
# --------------------------------------------------------------------------

class Blockfrost:
    """Minimal client. Blockfrost allows 10 req/s sustained; we sit under it."""

    def __init__(self, env: Env, rps: float = 8.0, verbose: bool = True):
        self.env = env
        self.min_gap = 1.0 / rps
        self._last = 0.0
        self.verbose = verbose
        self.calls = 0

    def _throttle(self) -> None:
        gap = time.monotonic() - self._last
        if gap < self.min_gap:
            time.sleep(self.min_gap - gap)
        self._last = time.monotonic()

    def get(self, path: str, params: dict[str, Any] | None = None, retries: int = 5) -> Any:
        qs = ""
        if params:
            qs = "?" + "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{self.env.base_url}{path}{qs}"
        req = urllib.request.Request(url, headers={"project_id": self.env.project_id})

        for attempt in range(retries):
            self._throttle()
            try:
                self.calls += 1
                with urllib.request.urlopen(req, timeout=45) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code in (418, 429, 500, 502, 503, 504) and attempt < retries - 1:
                    wait = 2 ** attempt
                    if self.verbose:
                        print(f"    [{e.code}] backing off {wait}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise RuntimeError(
                    self.env.redact(f"HTTP {e.code} on {path}: {e.read().decode()[:300]}")
                ) from None
            except (urllib.error.URLError, ConnectionError) as e:
                # ConnectionError (e.g. http.client.RemoteDisconnected) is NOT
                # a urllib.error.URLError subclass -- urlopen can raise it
                # directly on a transient reset, and without this it bypasses
                # retry entirely and crashes the whole run. Found this the
                # hard way: a real backfill died here after 855 successful
                # calls, losing everything accumulated in memory.
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(self.env.redact(f"network error on {path}: {e}")) from None
        raise RuntimeError(f"exhausted retries on {path}")

    # -- endpoints -------------------------------------------------------

    def latest_block(self) -> dict:
        return self.get("/blocks/latest")

    def asset_txs_page(self, asset: str, page: int, order: str = "desc", count: int = 100) -> list:
        return self.get(
            f"/assets/{asset}/transactions",
            {"page": page, "count": count, "order": order},
        ) or []

    def tx_utxos(self, tx_hash: str) -> dict | None:
        return self.get(f"/txs/{tx_hash}/utxos")

    def tx(self, tx_hash: str) -> dict | None:
        return self.get(f"/txs/{tx_hash}")

    def datum(self, datum_hash: str) -> Any:
        d = self.get(f"/scripts/datum/{datum_hash}")
        return d.get("json_value") if d else None

    def asset(self, asset: str) -> dict | None:
        return self.get(f"/assets/{asset}")

    def asset_history_page(self, asset: str, page: int, order: str = "asc", count: int = 100) -> list:
        return self.get(
            f"/assets/{asset}/history", {"page": page, "count": count, "order": order}
        ) or []


# --------------------------------------------------------------------------
# bech32 address decoding -> payment credential
# --------------------------------------------------------------------------

_B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def bech32_decode(addr: str) -> tuple[str, bytes] | None:
    addr = addr.strip()
    if addr.lower() != addr and addr.upper() != addr:
        return None
    addr = addr.lower()
    pos = addr.rfind("1")
    if pos < 1 or pos + 7 > len(addr):
        return None
    hrp, data_part = addr[:pos], addr[pos + 1:]
    try:
        data = [_B32.index(c) for c in data_part]
    except ValueError:
        return None
    # checksum not verified: we are parsing our own reads, not validating input
    acc, bits, out = 0, 0, bytearray()
    for v in data[:-6]:
        acc = (acc << 5) | v
        bits += 5
        while bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
    return hrp, bytes(out)


def payment_credential(addr: str) -> str | None:
    """
    Shelley address: header byte then 28-byte payment credential.
      0x71 = type 7, script payment, no stake (enterprise)
      0x11 = type 1, script payment + script stake (base)
    Both forms are in live use for the SAME script -- WingRiders V2 runs 20 of
    119 pools at the enterprise form -- which is why we match on the payment
    credential and never on the full address.
    """
    dec = bech32_decode(addr)
    if not dec:
        return None
    _, raw = dec
    if len(raw) < 29:
        return None
    return raw[1:29].hex()


def address_is_script(addr: str) -> bool:
    dec = bech32_decode(addr)
    if not dec:
        return False
    header = dec[1][0]
    # bit 4 of the header set => payment part is a script
    return bool((header >> 4) & 0x1)


# --------------------------------------------------------------------------
# pool config
# --------------------------------------------------------------------------

@dataclass
class Venue:
    """
    How to read reserves and LP supply for one DEX family.

    reserve_source:
      "value_minus_datum_treasury" -- take the UTxO Value and subtract every
          treasury accumulator named in treasury_paths, then subtract
          min_pool_ada from the ADA side.  WingRiders V1 and V2.
      "value"  -- Value is the reserve, minus min_pool_ada on the ADA side.
      "datum"  -- reserves are stated in the datum directly (Minswap V2).

    lp_supply_source:
      "datum" -- circulating LP is stated in the datum directly
          (Minswap V2 `total_liquidity`).  Cheapest and most reliable: no
          extra requests at all.  If max_lp_supply is also set, the held-LP
          remainder is computed as an independent cross-check and any
          disagreement is reported.
      "pool_holds_remainder" -- the pool UTxO holds the unissued LP tokens;
          circulating = max_lp_supply - held.  Minswap V2 (fallback).
      "mint_history" -- LP is minted to the depositor; supply must be summed
          from the asset's mint/burn history up to the target tx.  WingRiders.

    Field paths index into Blockfrost's PlutusData JSON, e.g.
    ["fields", 5, "int"].  Paths marked verified=False have NOT been read off
    chain by us and must be confirmed with `discover_venue_datum.py` before
    the output of this toolkit is trusted for that venue.
    """
    name: str
    reserve_source: str
    lp_supply_source: str
    min_pool_ada: int = 0
    max_lp_supply: int = 0
    treasury_paths: list[list] = field(default_factory=list)
    reserve_a_path: list | None = None
    reserve_b_path: list | None = None
    lp_supply_path: list | None = None
    # True when the pool NFT is a single venue-wide token rather than minted
    # per pool.  Such a venue CANNOT be tracked by its NFT -- paging that
    # asset's history returns every pool on the DEX interleaved -- so every
    # pool at the venue must supply `track_asset`.  Enforced in load_pools.
    nft_is_venue_wide: bool = False
    # LP units the contract counts in its own supply figure but never issues to
    # anyone -- the "burn liquidity" locked at pool creation.  It is the exact
    # constant difference between the two readings of supply, so the cross-check
    # below stays an equality rather than being loosened to a tolerance.
    lp_locked: int = 0
    verified: bool = False


VENUES: dict[str, Venue] = {
    # ---- WingRiders V1 -------------------------------------------------
    # One treasury accumulator pair.  Reserve = Value - treasury, ADA side
    # additionally minus MIN_POOL_ADA.
    "wingriders-v1": Venue(
        name="wingriders-v1",
        reserve_source="value_minus_datum_treasury",
        lp_supply_source="mint_history",
        min_pool_ada=3_000_000,
        treasury_paths=[],           # <-- set from `discover`; see note below
        verified=False,
    ),
    # ---- WingRiders V2 -------------------------------------------------
    # Every field below is taken from the contract source, not from a datum
    # dump and not from a guess:
    #   wingriders/dex-v2-contracts (commit 280a9e8, "Add audit report")
    #
    # PoolDatum field order -- src/DEX/Types/Pool.hs:88-119, constructor 0:
    #    0 requestValidatorHash   1 assetASymbol   2 assetAToken
    #    3 assetBSymbol           4 assetBToken
    #    5 swapFeeInBasis         6 protocolFeeInBasis
    #    7 projectFeeInBasis      8 reserveFeeInBasis      9 feeBasis
    #   10 agentFeeAda           11 lastInteraction
    #   12 treasuryA             13 treasuryB
    #   14 projectTreasuryA      15 projectTreasuryB
    #   16 reserveTreasuryA      17 reserveTreasuryB
    #   18 projectBeneficiary    19 reserveBeneficiary     20 poolSpecifics
    #
    # Reserves -- src/DEX/Pool/Util.hs:196-201 states the formula outright:
    #     fullA = pvalueOfWithOilCheck # poolValue # assetASymbol # assetAToken
    #                                  # C.poolOilAda
    #     qtyA  = fullA - treasuryA - projectTreasuryA - reserveTreasuryA
    # and Util.hs:124 gives the ADA-side identity that pins the oil term:
    #     valueOf(ada) == qtyA + treasuryA + projectTreasuryA
    #                          + reserveTreasuryA + C.poolOilAda
    # So: subtract THREE treasury pairs, and on the ADA side additionally
    # subtract poolOilAda.  reserveFeeInBasis defaults to 0
    # (src/DEX/Constants.hs:58), so reserveTreasury reads 0 on most pools
    # today -- and that zero is exactly the trap: an adapter that forgets it
    # reconciles perfectly until the day a pool turns the fee on.  Subtract
    # all three, unconditionally.
    #
    # min_pool_ada -- src/DEX/Constants.hs:96-97, poolOilAda = 3_000_000.
    #
    # LP supply -- NOT mint_history.  src/DEX/Mint/Validity.hs:102 says the
    # share tokens are "(per pool) ... Pool holds a reserve of pre-minted
    # share tokens", and Validity.hs:108 that they "are all pre-minted and
    # added into the newly created pool ... except for a small portion ...
    # given to the initial liquidity provider".  src/DEX/Factory.hs:230-232:
    #     totalEmittedShares <- pletC (C.maxShareTokens - poolOutShares)
    #     let expectedMintedShares = C.maxShareTokens - C.burnedShareTokens
    #         userGivenShares     = totalEmittedShares - C.burnedShareTokens
    # and the pool math uses totalEmittedShares as the LP denominator
    # throughout (src/DEX/Pool/ConstantProduct.hs:87, 256, 407, 443, 473).
    # So circulating LP is exactly max_lp_supply - held, with NO correction
    # term: the 1_000 burnedShareTokens (Constants.hs:124-125) are never
    # minted at all, so they are never held by the pool, so they fall out of
    # the subtraction on their own.  Hence lp_locked = 0 here where Minswap
    # needs 10 -- same idea, different bookkeeping.  This also removes the
    # mint-history walk, which was the most expensive part of the adapter.
    # max_lp_supply = maxShareTokens = maxInt64 (Constants.hs:12-17).
    #
    # nft_is_venue_wide -- lpValidityTokenName is the CONSTANT "L"
    # (Constants.hs:102-103) and Factory.hs:215 requires exactly one of it per
    # pool output, so every WR2 pool carries an asset with the same policy AND
    # the same name.  It cannot identify a pool, exactly like Minswap's MSP.
    # The per-pool unique token is the share token, whose name is
    # blake2b_256 over the pool type, scales and both assets
    # (src/DEX/Pool/Util.hs:62-70), and the pool holds its unissued reserve --
    # so it is present in the pool output and works as track_asset.
    "wingriders-v2": Venue(
        name="wingriders-v2",
        reserve_source="value_minus_datum_treasury",
        lp_supply_source="pool_holds_remainder",
        min_pool_ada=3_000_000,
        max_lp_supply=9_223_372_036_854_775_807,
        treasury_paths=[
            [["fields", 12, "int"], ["fields", 13, "int"]],   # treasuryA/B
            [["fields", 14, "int"], ["fields", 15, "int"]],   # projectTreasuryA/B
            [["fields", 16, "int"], ["fields", 17, "int"]],   # reserveTreasuryA/B
        ],
        nft_is_venue_wide=True,
        lp_locked=0,
        verified=True,
    ),
    # ---- Minswap V2 ----------------------------------------------------
    # Field order is taken from the contract source, not guessed:
    #   github.com/minswap/minswap-dex-v2  lib/amm_dex_v2/types.ak, PoolDatum
    #     0 pool_batching_stake_credential
    #     1 asset_a            2 asset_b
    #     3 total_liquidity    <- circulating LP, stated outright
    #     4 reserve_a          5 reserve_b
    #     6 base_fee_a_numerator   7 base_fee_b_numerator
    #     8 fee_sharing_numerator_opt   9 allow_dynamic_fee
    # Reserves are the LP-owned balances explicitly, so there is nothing to
    # subtract: no treasury pass, no min-ADA adjustment, no mint-history walk.
    # max_lp_supply is kept ONLY so the held-LP remainder can be computed as an
    # independent second reading of total_liquidity; it is not the primary
    # source.  If the two ever disagree, one of these assumptions has rotted
    # and the run says so.
    "minswap-v2": Venue(
        name="minswap-v2",
        reserve_source="datum",
        lp_supply_source="datum",
        reserve_a_path=["fields", 4, "int"],
        reserve_b_path=["fields", 5, "int"],
        lp_supply_path=["fields", 3, "int"],
        max_lp_supply=9_223_372_036_854_775_807,
        # Source: minswap/minswap-dex-v2 (commit c3293ad, "Release the official
        # version by Minswap Labs").
        #   lib/amm_dex_v2/utils.ak:31   pub const default_burn_liquidity = 10
        #   validators/factory_validator.ak:183-185
        #       let total_liquidity = calculate_initial_liquidity(a, b)
        #       let remaining_liquidity =
        #           9223372036854775807 - (total_liquidity - default_burn_liquidity)
        # So at creation  held + total_liquidity - MAX = 10, and every later
        # batching step preserves that sum exactly:
        #   lib/amm_dex_v2/pool_validation.ak:180
        #       remaining_liquidity_supply_out - remaining_liquidity_supply_in
        #           == pool_in_total_liquidity - pool_out_total_liquidity
        # i.e. LP issued out of the pool == LP added to total_liquidity, always.
        # Confirmed on chain against MIN2-ADA-MIN at block_time 1785417560:
        #   held 9,223,372,012,251,249,188 + total_liquidity 24,603,526,619,263
        #   - MAX = 10.
        lp_locked=10,
        min_pool_ada=0,
        nft_is_venue_wide=True,   # policy f5808c2c…, name 4d5350 "MSP", on EVERY pool
        verified=True,   # datum layout is source-cited; confirm with `discover`
    ),
    # ---- generic escape hatch -----------------------------------------
    # Value as reserves, LP from mint history.  Correct only for a pool with
    # no treasury accumulator at all.  Will be caught by the monotonicity
    # check if used somewhere it does not belong.
    "generic-cpmm": Venue(
        name="generic-cpmm",
        reserve_source="value",
        lp_supply_source="mint_history",
        min_pool_ada=0,
        verified=False,
    ),
}


@dataclass
class Pool:
    label: str
    venue: str
    nft: str                 # policy+hexname of the pool identity NFT (qty 1)
    script_hash: str         # payment credential of the pool address
    asset_a: str             # "lovelace" or policy+hexname
    asset_b: str
    lp_asset: str = ""       # required for mint_history / pool_holds_remainder
    track_asset: str = ""    # asset whose tx history IS this pool's history

    @property
    def identity(self) -> str:
        """
        The asset used to page this pool's transaction history and to pick the
        pool output out of a tx.

        Both venues we have verified so far mark their pools with a token that
        is IDENTICAL on every pool, so neither can be tracked by it:

          * Minswap V2 -- every pool carries the same NFT (policy f5808c2c…,
            name 4d5350 "MSP").
          * WingRiders V2 -- every pool carries exactly one validity token
            whose name is the constant "L" (dex-v2-contracts commit 280a9e8,
            src/DEX/Constants.hs:102-103, enforced per pool output at
            src/DEX/Factory.hs:215).

        Paging /assets/{nft}/txs on either returns every pool on the DEX
        interleaved.  On both, the per-pool unique token is the LP / share
        token, and on both the pool holds its own unissued reserve of it -- so
        it is present in the pool output and can serve as the identity.  Set
        `track_asset` to it and history paging becomes per-pool again.

        The name "nft" is kept for the venue-wide marker because it is what
        makes an output a pool output; `required_units` demands both.
        """
        return self.track_asset or self.nft

    @property
    def required_units(self) -> list[str]:
        """Every unit that must be present in the pool output, deduped."""
        units = [u for u in (self.identity, self.nft) if u]
        return list(dict.fromkeys(units))


def load_pools(path: str) -> list[Pool]:
    with open(path) as fh:
        raw = json.load(fh)
    pools = []
    for r in raw:
        missing = [k for k in ("label", "venue", "nft", "script_hash", "asset_a", "asset_b") if k not in r]
        if missing:
            sys.exit(f"pool entry {r.get('label', '?')} missing keys: {missing}")
        if r["venue"] not in VENUES:
            sys.exit(f"pool {r['label']}: unknown venue {r['venue']!r}; known: {list(VENUES)}")
        pool = Pool(**{k: r.get(k, "") for k in Pool.__dataclass_fields__})
        venue = VENUES[pool.venue]
        if venue.nft_is_venue_wide and not pool.track_asset:
            sys.exit(
                f"pool {pool.label}: venue {venue.name} shares ONE NFT across every pool,\n"
                "so the NFT cannot identify this pool. Set \"track_asset\" to the pool's\n"
                "own LP asset (policy+hexname). Use lp_name.py to compute it."
            )
        if venue.lp_supply_source == "datum" and not venue.lp_supply_path:
            sys.exit(f"venue {venue.name}: lp_supply_source=datum but no lp_supply_path set")
        pools.append(pool)
    return pools


# --------------------------------------------------------------------------
# historical lookup: last tx touching the pool NFT at or before a timestamp
# --------------------------------------------------------------------------

def _first_tx_at_or_before(bf: Blockfrost, nft: str, target_ts: int,
                           verbose: bool = True) -> tuple[int, int] | None:
    """
    Locate the newest tx whose block_time <= target_ts and return its position
    as (page, index_within_page) so a caller can carry on walking backwards
    from there without re-searching.

    /assets/{nft}/transactions with order=desc is newest-first and 100 per
    page.  A busy pool has thousands of pages, so walk out exponentially to
    bracket the target, then binary-search.  Costs ~2*log2(pages) requests
    instead of paging the whole history.
    """
    page = 1
    lo = 1          # known: page lo is entirely newer than target (or unknown at start)
    hi = None       # known: page hi contains or precedes the target

    # exponential probe outward
    while True:
        rows = bf.asset_txs_page(nft, page, order="desc")
        if not rows:
            hi = page
            break
        if rows[-1]["block_time"] <= target_ts:
            hi = page
            break
        lo = page
        if page > 65536:
            return None
        page *= 2

    # binary search for the first page that reaches back past the target
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        rows = bf.asset_txs_page(nft, mid, order="desc")
        if not rows or rows[-1]["block_time"] <= target_ts:
            hi = mid
        else:
            lo = mid

    # scan the bracketing pages newest-first for the first tx <= target
    for p in (lo, hi):
        rows = bf.asset_txs_page(nft, p, order="desc")
        for i, row in enumerate(rows):
            if row["block_time"] <= target_ts:
                if verbose:
                    print(f"    t<={target_ts}: tx {row['tx_hash'][:16]}… "
                          f"@ {row['block_time']} (page {p}, {bf.calls} calls so far)")
                return p, i
    return None


def find_tx_at_or_before(bf: Blockfrost, nft: str, target_ts: int,
                         verbose: bool = True) -> dict | None:
    """The newest tx whose block_time <= target_ts, or None."""
    hit = _first_tx_at_or_before(bf, nft, target_ts, verbose=verbose)
    if not hit:
        return None
    page, idx = hit
    return bf.asset_txs_page(nft, page, order="desc")[idx]


def iter_txs_at_or_before(bf: Blockfrost, asset: str, target_ts: int,
                          verbose: bool = True, limit: int = 25):
    """
    Yield transactions touching `asset`, newest-first, starting from the newest
    one at or before target_ts and walking backwards in time.

    Why this exists.  `find_tx_at_or_before` answers "which tx touched the
    tracking asset most recently before T" -- but that is NOT the same question
    as "what did the pool look like at T".  The tracking asset for a Minswap V2
    pool is its LP token, and LP tokens live in LP holders' wallets: every
    wallet-to-wallet transfer, every deposit into a farm, every order UTxO
    carrying LP mid-batch shows up in that asset's history WITHOUT the pool
    being touched at all.  Such a tx simply has no output at the pool
    credential, and treating it as "state unreadable" throws away a lookback
    point that was perfectly readable one tx further back.

    Walking back is not an approximation.  The state at the newest genuine pool
    tx before T *is* the pool's state at T -- nothing changed in between, by
    definition.  The caller reports the real timestamp of whatever it lands on,
    so the window length stays honest.
    """
    hit = _first_tx_at_or_before(bf, asset, target_ts, verbose=verbose)
    if not hit:
        return
    page, idx = hit
    n = 0
    while n < limit:
        rows = bf.asset_txs_page(asset, page, order="desc")
        if not rows:
            return
        for row in rows[idx:]:
            if row["block_time"] > target_ts:
                continue
            n += 1
            yield row
            if n >= limit:
                return
        page += 1
        idx = 0


def select_pool_output(utxos: dict, script_hash: str, units) -> dict | None:
    """
    The pool output is the one that (a) sits at an address whose payment part
    is a SCRIPT, (b) whose PAYMENT CREDENTIAL equals the pool script hash, and
    (c) carries EVERY unit in `units`.  Matching on the full address would
    silently drop the enterprise-address pools; matching on a token alone would
    pick up a batcher's UTxO mid-hop.  The script-ness check matters because a
    key hash and a script hash are both 28 bytes and are otherwise
    indistinguishable -- only the header byte separates them.

    `units` is a list because a Minswap V2 output must carry both the venue-wide
    NFT and this pool's own LP token; requiring both is strictly stronger than
    requiring either.  A bare string is accepted for convenience.
    """
    if isinstance(units, str):
        units = [units]
    wanted = [u for u in units if u]
    for out in utxos.get("outputs", []):
        if not address_is_script(out["address"]):
            continue
        if payment_credential(out["address"]) != script_hash:
            continue
        have = {amt["unit"] for amt in out["amount"] if int(amt["quantity"]) >= 1}
        if all(u in have for u in wanted):
            return out
    return None


def value_of(out: dict, unit: str) -> int:
    for amt in out["amount"]:
        if amt["unit"] == unit:
            return int(amt["quantity"])
    return 0


# --------------------------------------------------------------------------
# datum access
# --------------------------------------------------------------------------

def dig(node: Any, path: list) -> Any:
    """
    Walk Blockfrost PlutusData JSON.  Ints arrive as {"int": n}, bytes as
    {"bytes": "hex"}, constructors as {"constructor": i, "fields": [...]}.
    A path is a list of dict keys and list indices, e.g. ["fields", 3, "int"].
    """
    cur = node
    for step in path:
        if cur is None:
            return None
        if isinstance(step, int):
            if not isinstance(cur, list) or step >= len(cur):
                return None
            cur = cur[step]
        else:
            if not isinstance(cur, dict) or step not in cur:
                return None
            cur = cur[step]
    return cur


def fetch_datum(bf: Blockfrost, out: dict) -> Any:
    """Blockfrost reports data_hash even for inline datums, so one path serves both."""
    if out.get("data_hash"):
        return bf.datum(out["data_hash"])
    return None


# --------------------------------------------------------------------------
# LP supply
# --------------------------------------------------------------------------

def lp_supply_from_mint_history(
    bf: Blockfrost, lp_asset: str, cutoff_ts: int, earliest_ts: int,
    cache: dict, verbose: bool = True
) -> int | None:
    """
    Reconstruct LP total supply at cutoff_ts.

    The naive way is to sum mints minus burns forward from genesis, but the
    history endpoint does not carry block_time, so every event costs an extra
    /txs/{hash} call -- and a five-year-old pool has thousands.  That single
    detail was the dominant cost of the whole run.

    Instead: take the CURRENT supply from /assets/{lp}, then walk the history
    BACKWARDS undoing events until we are older than earliest_ts (the oldest
    lookback point of this run).  A mature pool typically has a handful of
    mint/burn events in the last 60 days, so the cost falls from thousands of
    calls to tens, and it is independent of how old the pool is.

    Cache holds (times, totals) ascending, so every later cutoff in the run is
    a bisect rather than a refetch.
    """
    if lp_asset not in cache:
        cur = bf.asset(lp_asset)
        if not cur:
            return None
        running = int(cur["quantity"])

        # supply is `running` as of NOW; walk back undoing each event
        points: list[tuple[int, int]] = []
        page, done, seen = 1, False, 0
        oldest_walked = None
        while not done:
            rows = bf.asset_history_page(lp_asset, page, order="desc")
            if not rows:
                break
            for ev in rows:
                t = bf.tx(ev["tx_hash"])
                if not t:
                    continue
                seen += 1
                # `running` is the supply immediately AFTER this event
                points.append((t["block_time"], running))
                amt = int(ev["amount"])
                running -= amt if ev["action"] == "minted" else -amt
                oldest_walked = t["block_time"]
                if t["block_time"] <= earliest_ts:
                    done = True
                    break
            if len(rows) < 100:
                break
            page += 1
            if page > 500:
                print(f"    WARNING: {lp_asset[:16]}… history exceeds 50k events "
                      "in the lookback window; LP supply may be WRONG", file=sys.stderr)
                break

        # `running` is now the supply BEFORE the oldest event we walked, so the
        # sentinel belongs immediately before THAT event -- not at earliest_ts.
        # The last event walked is by construction older than earliest_ts, so
        # anchoring the sentinel at earliest_ts would overwrite the correct
        # supply for the whole window with the pre-event value.
        floor_ts = (oldest_walked - 1) if oldest_walked is not None else (earliest_ts - 1)
        points.append((floor_ts, running))
        points.sort()
        times = [p[0] for p in points]
        totals = [p[1] for p in points]
        cache[lp_asset] = (times, totals)
        if verbose:
            print(f"    LP history: walked {seen} events back to {earliest_ts} "
                  f"({bf.calls} calls so far)")

    times, totals = cache[lp_asset]
    if not times:
        return None
    idx = bisect.bisect_right(times, cutoff_ts) - 1
    if idx < 0:
        return None
    return totals[idx]


# --------------------------------------------------------------------------
# state reading
# --------------------------------------------------------------------------

@dataclass
class State:
    label: str
    ts: int
    tx_hash: str
    reserve_a: int
    reserve_b: int
    lp_supply: int
    notes: list[str] = field(default_factory=list)

    @property
    def k(self) -> int:
        return self.reserve_a * self.reserve_b

    @property
    def sqrt_k(self) -> Decimal:
        return Decimal(self.k).sqrt()

    @property
    def sqrt_k_per_lp(self) -> Decimal:
        return self.sqrt_k / Decimal(self.lp_supply)


class PoolContentsError(Exception):
    """
    Raised when an output sits at the pool's script credential but does not
    carry what a pool output must carry.  Distinct from "this tx did not touch
    the pool", which is ordinary and is handled by walking back.  This one is
    never walked past: it means an assumption has rotted.
    """


def read_state(
    bf: Blockfrost, pool: Pool, venue: Venue, tx_row: dict, lp_cache: dict,
    earliest_ts: int, verbose: bool = True
) -> State | None:
    utxos = bf.tx_utxos(tx_row["tx_hash"])
    if not utxos:
        return None
    out = select_pool_output(utxos, pool.script_hash, pool.required_units)
    if not out:
        # Two very different causes, and conflating them hides a real defect:
        #   (a) no output at the pool credential at all -- this tx moved the
        #       tracking asset without touching the pool (an LP holder's
        #       transfer, a farm deposit, an order UTxO carrying LP). Benign;
        #       the caller walks back to the previous tx.
        #   (b) an output IS at the pool credential but we rejected it for
        #       missing a required unit. That means an assumption about the
        #       pool's contents is wrong, and it must be shouted about.
        at_cred = [o for o in utxos.get("outputs", [])
                   if address_is_script(o["address"])
                   and payment_credential(o["address"]) == pool.script_hash]
        if at_cred:
            have = {a["unit"] for a in at_cred[0]["amount"] if int(a["quantity"]) >= 1}
            missing = [u for u in pool.required_units if u and u not in have]
            msg = (f"POOL OUTPUT REJECTED in {tx_row['tx_hash'][:16]}…: an output "
                   f"sits at the pool credential but is missing required unit(s) "
                   f"{missing}. The pool-contents assumption is wrong -- "
                   f"investigate before trusting this pool.")
            if verbose:
                print("    " + msg, file=sys.stderr)
            raise PoolContentsError(msg)
        if verbose:
            print(f"    {tx_row['tx_hash'][:16]}… touched the tracking asset but "
                  "not the pool (LP moved in a non-pool tx); walking back",
                  file=sys.stderr)
        return None

    notes: list[str] = []
    val_a = value_of(out, pool.asset_a)
    val_b = value_of(out, pool.asset_b)

    # One datum fetch per output at most, shared by the reserve and LP branches.
    _datum_box: list = []

    def get_datum():
        if not _datum_box:
            _datum_box.append(fetch_datum(bf, out))
        return _datum_box[0]

    if venue.reserve_source == "datum":
        dat = get_datum()
        if dat is None:
            notes.append("datum unavailable")
            return None
        ra = dig(dat, venue.reserve_a_path or [])
        rb = dig(dat, venue.reserve_b_path or [])
        if ra is None or rb is None:
            notes.append("reserve path did not resolve -- run `discover`")
            return None
        reserve_a, reserve_b = int(ra), int(rb)
        if reserve_a > val_a or reserve_b > val_b:
            notes.append(f"RECONCILE FAIL: datum reserves exceed Value "
                         f"({reserve_a}>{val_a} or {reserve_b}>{val_b})")

    elif venue.reserve_source == "value_minus_datum_treasury":
        reserve_a, reserve_b = val_a, val_b
        if venue.treasury_paths:
            dat = get_datum()
            if dat is None:
                notes.append("datum unavailable; treasury NOT subtracted")
                return None
            for pa, pb in venue.treasury_paths:
                ta, tb = dig(dat, pa), dig(dat, pb)
                if ta is None or tb is None:
                    notes.append(f"treasury path {pa}/{pb} did not resolve -- run `discover`")
                    return None
                reserve_a -= int(ta)
                reserve_b -= int(tb)
        else:
            notes.append("NO treasury paths configured for this venue -- "
                         "reserves are Value only and are almost certainly WRONG")
        if pool.asset_a == LOVELACE:
            reserve_a -= venue.min_pool_ada
        elif pool.asset_b == LOVELACE:
            reserve_b -= venue.min_pool_ada

    else:  # "value"
        reserve_a, reserve_b = val_a, val_b
        if pool.asset_a == LOVELACE:
            reserve_a -= venue.min_pool_ada
        elif pool.asset_b == LOVELACE:
            reserve_b -= venue.min_pool_ada

    if reserve_a <= 0 or reserve_b <= 0:
        notes.append(f"non-positive reserve after adjustment ({reserve_a}, {reserve_b})")
        return None

    # ---- LP supply ----
    if venue.lp_supply_source == "datum":
        dat = get_datum()
        if dat is None:
            notes.append("datum unavailable; LP supply unreadable")
            return None
        raw_lp = dig(dat, venue.lp_supply_path or [])
        if raw_lp is None:
            notes.append("lp_supply_path did not resolve -- run `discover`")
            return None
        lp = int(raw_lp)
        # Independent second reading: the pool holds the unissued LP, so
        # max_lp_supply - held must equal the datum figure.  Two sources that
        # can only agree if both assumptions still hold.
        if venue.max_lp_supply and pool.lp_asset:
            held = value_of(out, pool.lp_asset)
            if held:
                # The pool holds every LP unit it has not issued, plus the
                # locked burn liquidity, which is counted in total_liquidity
                # but never leaves the pool.  Hence the exact identity
                #     max_lp_supply - held + lp_locked == total_liquidity
                remainder = venue.max_lp_supply - held + venue.lp_locked
                if remainder != lp:
                    notes.append(
                        f"LP CROSS-CHECK FAIL: datum total_liquidity={lp} but "
                        f"max_lp_supply-held+lp_locked={remainder} "
                        f"(held={held}, lp_locked={venue.lp_locked}, "
                        f"off by {lp - remainder}); "
                        "one of the two assumptions is wrong")
            else:
                notes.append("no LP token held in the pool output -- "
                             "cross-check on total_liquidity skipped")

    elif venue.lp_supply_source == "pool_holds_remainder":
        if not pool.lp_asset:
            notes.append("lp_asset required for pool_holds_remainder")
            return None
        held = value_of(out, pool.lp_asset)
        lp = venue.max_lp_supply - held
    elif venue.lp_supply_source == "mint_history":
        if not pool.lp_asset:
            notes.append("lp_asset required for mint_history")
            return None
        lp = lp_supply_from_mint_history(bf, pool.lp_asset, tx_row["block_time"],
                                         earliest_ts, lp_cache, verbose)
        if lp is None:
            notes.append("LP mint history empty at this timestamp")
            return None
    else:
        notes.append(f"unknown lp_supply_source {venue.lp_supply_source}")
        return None

    if lp <= 0:
        notes.append(f"non-positive LP supply ({lp})")
        return None

    return State(pool.label, tx_row["block_time"], tx_row["tx_hash"],
                 reserve_a, reserve_b, lp, notes)

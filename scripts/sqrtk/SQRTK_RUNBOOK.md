# √k Snapshot — Developer Runbook

ADApose Labs, Inc. · scripts: `sqrtk_snapshot.py` (deep snapshot), `sqrtk_tick.py` (periodic collector) · last updated 30 Jul 2026

---

## 1. What this measures and why it exists

For a constant-product pool the invariant is `k = x · y`. A swap holds `k` fixed
by construction: the trader puts in `Δx` and takes out exactly enough `Δy` to
leave the product unchanged. Fees are *not* part of that trade — they are added
to the reserves afterwards. So `k` only ever grows, and it only ever grows from
fees.

That gives us a quantity with unusually good properties:

```
sqrt_k_per_lp  =  sqrt(reserve_A × reserve_B) ÷ lp_total_supply
```

It is **unchanged by a swap** (k is fixed, LP supply is fixed). It is
**unchanged by a deposit or a withdrawal** (reserves and LP supply scale
together). It is **unchanged by price movement** (that moves x and y along the
curve, not off it). The only thing that moves it is fee accrual. Its growth
rate is therefore the impermanent-loss-free fee yield, per LP token, read
directly from chain state.

This matters because the dispersion work so far runs on DefiLlama's `apyBase`,
which *claims* to be the same quantity but is derived from reported volume via
each venue's community-maintained adapter. We already know two of those
adapters are wrong (SundaeSwap, commit `548cd1db`, 2026-05-20; Splash, a ~6×
unit double-conversion). `apyBase` is a hypothesis. This script is the
measurement.

The output is an annualised rate over each lookback window:

```
fee_apr = ((sqrt_k_per_lp[t1] / sqrt_k_per_lp[t0]) ** (365/days) - 1) × 100
```

---

## 2. Prerequisites

Python 3.9 or newer. **No third-party packages** — the script is standard
library only (`urllib`, `json`, `csv`, `decimal`, `bisect`, `dataclasses`). No
`pip install` step, no virtualenv needed, nothing to audit for supply-chain
risk.

A Blockfrost project ID for **mainnet**. Check your plan's daily request cap
and per-second limit on your Blockfrost dashboard before a large run; the
script self-throttles to 8 requests/second, and section 7 gives the arithmetic
for estimating how many requests a run will consume.

---

## 3. Credentials

Copy `env.example` to `.env` in the same directory as the script and fill in
the project ID:

```
BLOCKFROST_PROJECT_ID=mainnet...
BLOCKFROST_BASE_URL=https://cardano-mainnet.blockfrost.io/api/v0
```

The `.env` stays on the machine that runs the script. The key is never printed,
never written to the CSV, and is stripped from HTTP error text before any
exception surfaces (`Env.redact`). A shell `export` of either variable
overrides the file, which is what you want in CI.

**Add `.env` to `.gitignore` before the first commit.** Do not paste the key
into chat, tickets, or logs.

---

## 4. Step 0 — verify the script before pointing it at anything

Three checks run with **no network and no key**. Run all of them; they take
under a couple seconds total and they are the difference between "it
executes" and "the arithmetic is right".

```bash
python3 sqrtk_snapshot.py selftest
python3 mock_run.py
python3 mock_tick.py
```

`selftest` covers address decoding (including that the enterprise `0x71` and
base `0x11` forms of the *same* script yield the same payment credential), pool
output selection (including a decoy key address whose 28-byte credential
deliberately collides with the script hash — a matcher that ignores the header
byte returns the wrong UTxO), datum path walking, the invariant algebra, and
the paged binary search over transaction history.

`mock_run.py` fabricates 400 days of pool history with a known fee rate of
0.02%/day baked in, plus two deposits that mint LP, plus a treasury accumulator
growing inside the same Value. It then runs the real `measure` code path over
that fake chain and asserts the reported APR comes back at 7.572% on every
window. It also re-runs with deliberately broken venue rules to confirm the
guard rails fire and the process exits non-zero.

`mock_tick.py` covers the periodic collector (section 8): diffing against a
prior row instead of re-deriving history, skipping an unverified venue with
zero network calls, still *writing* a decreasing reading while flagging it as
a problem, and correctly doing nothing when the last row on file is too
recent to say anything new. It reuses `mock_run.py`'s own fixture for the
bootstrap case rather than duplicating it, since bootstrapping literally is
`measure`'s lookback sweep, unmodified.

All three must print a clean pass before you spend a single API call.

---

## 5. Step 1 — build `pools.json`

**Primary path: enumerate, don't hand-fill.** `enumerate_minswap.py` and
`enumerate_wingriders.py` read live chain state and build real, evidenced
entries directly — `script_hash`, `nft`, `track_asset`, `lp_asset`,
`asset_a`/`asset_b` — no guessing:

```bash
python3 enumerate_minswap.py --top 60 --out pools.json
python3 enumerate_wingriders.py --top 40 --out pools.json
```

Both **merge into `--out`, never overwrite it.** Identity is `(venue,
track_asset)`, not `label` and not `address` — see why below. A pool already
on file is left exactly as it is; the run only adds ones it hasn't seen
there before. Both default `--out` to the same `pools.json`, so running
either (in any order, any number of times) builds one shared file, not one
per venue. Safe to re-run any time — to raise `--top` and reach further down
the size ranking, or to pick up pools created since the last run.

Fields each script fills in:

| Field | Meaning | How it's derived |
|---|---|---|
| `label` | Human-readable pool name, used in output | Ticker pair decoded from the on-chain asset name (plain ASCII, or a CIP-67 labeled token with its 4-byte prefix stripped); numbered suffix on a collision |
| `venue` | Key into `VENUES` in the script | Set by whichever `enumerate_*.py` produced the entry |
| `script_hash` | **Payment credential** of the pool address | Read from the live UTxO's address — never the full address, see below |
| `nft` | `policyid + hexname` of the pool's on-chain marker | Minswap: the venue-wide MSP token. WingRiders: the venue-wide validity ("L") token. **Neither identifies one specific pool** — that's `track_asset`'s job |
| `track_asset` | `policyid + hexname` of the asset whose tx history IS this pool's history | The pool's own unique LP/share token. **Required** whenever `nft` is venue-wide — `load_pools` refuses to load an entry missing it |
| `lp_asset` | Same value as `track_asset` today | Kept as its own field in case a future venue's identity and LP tokens ever differ |
| `asset_a`, `asset_b` | `lovelace`, or `policyid + hexname` | Minswap: derived for free by reproducing the observed LP token name from candidate pairs, falling back to the datum for the rest. WingRiders: read from the datum directly, in the contract's own A/B order — order matters, treasury subtraction is per-side |

`script_hash` is the payment credential and **never** the full address. This is
not pedantry: of the 119 live WingRiders V2 pools read 29 Jul 2026, 20 sit at
enterprise (`0x71`, script payment, no stake) addresses and the rest at base
(`0x11`, script payment plus script stake) addresses — the *same* script, two
address forms. Whitelisting full addresses silently drops one in six pools,
with no error. **Addresses aren't even unique per pool** — a live
`enumerate_wingriders.py --top 40` run (30 Jul 2026) found two genuinely
different pools (differing in `asset_b`, one NIGHT/USDM and one NIGHT/USDA)
sharing one on-chain address. `(venue, track_asset)` is the only safe identity
key anywhere in this pipeline — never `address`, never `label`.

Note the WingRiders LP policy is **shared** between the CPMM and stableswap
families at V2 (`6fdc63a1d71dc2c65502b79baae7fb543185702b12c3c5fb639ed737`) —
the V1 trick of separating families by LP policy does not carry forward, and
the stableswap pools are not constant-product — do not measure them with this
script.

**Fallback path:** copy `pools.example.json` and fill an entry by hand — still
the right move for a venue that doesn't have its own `enumerate_*.py` yet.
Everything marked `TODO` in that file is genuinely unknown to us and must be
filled in from chain.

---

## 6. Step 2 — `discover`, before trusting any venue rule

**Minswap V2 and WingRiders V2 are `verified=True` today** — field paths cited
against contract source (not guessed), and confirmed by a live, correctness-
check-clean run across 100 pools (30 Jul 2026): `sqrt(k)/LP` non-decreasing
for every one, zero violations. **WingRiders V1 and the `generic-cpmm`
fallback remain `verified=False`, treasury field paths still empty.** The
discovery discipline below is exactly how the two verified venues got that
way, and it's what onboarding the next venue (WingRiders V1, or a new DEX
entirely) still requires — guessing datum indices is precisely how you get a
number that is plausible and wrong.

```bash
python3 sqrtk_snapshot.py discover --pools pools.json --pool WR2-ADA-XXX
```

This prints, for the pool's most recent UTxO: the address, its decoded payment
credential, whether the payment part is a script, the full Value, and the datum
as Blockfrost's PlutusData JSON. Read the datum against the contract source,
identify each treasury accumulator, and write the paths into the `Venue` entry
in the script as lists like `["fields", 2, "int"]`. Then set `verified=True`
for that venue.

WingRiders V2 runs **three** treasury accumulator pairs — `treasury`,
`projectTreasury`, `reserveTreasury` — so `treasury_paths` for that venue takes
three `[path_a, path_b]` pairs. Subtract all three unconditionally.
`reserveFeeInBasis` reads 0 on all 119 live pools today, meaning
`reserveTreasury` is currently 0 everywhere, which is exactly the trap: an
adapter that forgets that pair reconciles perfectly against every pool in
existence right up until the day one pool turns the fee on, and then it is
quietly wrong for that pool only.

How wrong does forgetting a treasury pair get you? In the mock, where the true
answer is **7.572%**, dropping a single accumulator reports **8.804%**. It does
not crash, it does not look absurd, and it is off by 16%.

---

## 7. Step 3 — `measure`

```bash
python3 sqrtk_snapshot.py measure --pools pools.json --out sqrtk.csv --days 7,14,30,60
```

**Appends to `--out`, never overwrites it.** A fresh/missing path still gets a
header; an existing one is extended in place. Safe to re-run any time — to add
more history for pools already on file, or to onboard new ones into the same
durable file — and it's the reason `sqrtk.csv` is meant to be one shared,
ever-growing file rather than something a run replaces.

For each pool the script finds the chain tip, then for each lookback point
locates the newest transaction touching the pool's *tracking asset*
(`track_asset` if set, else `nft`) at or before that timestamp. That
transaction isn't necessarily a pool-state change, though — the tracking asset
can move in an ordinary wallet-to-wallet transfer that never touches the pool
output at all — so the script walks backward from there, skipping non-pool
transactions, until it finds one that actually is the pool. Nothing changed in
between by definition, so the state found is still correct for the requested
timestamp; only its recorded `from_ts` is a little older. From there it pulls
that transaction's UTxOs, selects the pool output, computes reserves and LP
supply per the venue rule, and derives `sqrt_k_per_lp`. It then annualises
growth from each earlier point to the most recent one.

The finding step matters for cost. `/assets/{asset}/transactions` is
newest-first at 100 rows per page and a busy pool has thousands of pages, so
rather than paging the lot the script brackets the target timestamp by
doubling the page index, then binary-searches — roughly `2·log₂(pages)`
requests per lookback point instead of `pages`.

**LP supply, both verified venues today: `pool_holds_remainder`.** Minswap V2
and WingRiders V2 both hold their own unissued LP/share reserve inside the
pool UTxO, so circulating supply is `max_supply − held`, read directly off the
same Value already fetched for reserves — no extra requests, no history walk.
(A different mechanism, `mint_history` — reconstructing supply from mint/burn
events, walked backward from current supply since Blockfrost's history
endpoint doesn't carry block times — still exists in the script for
`wingriders-v1`/`generic-cpmm`, the two venues that remain `verified=False`.
It used to be WingRiders V2's mechanism too, before its actual on-chain
behaviour was confirmed against contract source; if you're reading old notes
or an old mock run that assumed mint-history costs for WingRiders V2, they're
stale.)

### Estimating request count

Per pool, roughly:

```
1                                    chain tip (once per run, not per pool)
+ per lookback point:  2·log₂(pages) page reads     ≈ 18–22 for a busy pool
                     + 1              tx UTxOs
                     + 1              datum (if the venue needs one for
                                       reserves/treasury/LP supply)
                     + a few          for any non-pool txs skipped while
                                       walking back to a genuine pool tx
```

Observed, not estimated: a 100-pool run (60 Minswap V2 + 40 WingRiders V2, 30
Jul 2026) used 2,545 + 1,364 = 3,909 calls for 371 rows — roughly 35–40
requests per pool for up to five points, comparable between the two venues
now that neither needs a mint-history walk. The mock run reports its own
exact call count at the end; use that shape to sanity-check a real run before
scaling to the full pool list.

If you are near a daily cap: measure Minswap V2 first, and shorten to
`--days 30` for a first pass. Two points are enough to produce a rate.

### Output columns

| Column | Meaning |
|---|---|
| `pool`, `venue` | From your config |
| `track_asset` | The pool's stable identity (`pool.identity` — `track_asset` if set, else `nft`), **not** `pool`/`label`. Use this, never the label, to join a pool's rows across runs or over time — labels can change (a re-enumeration with better ticker resolution, a manual rename); this doesn't |
| `from_ts`, `to_ts`, `days` | Actual observed timestamps of the two states, and the gap. **Not** exactly the requested lookback — the script snaps to real transactions, so a quiet pool may give you a 34-day window when you asked for 30. Always read `days`, never assume it |
| `sqrtk_per_lp_from`, `sqrtk_per_lp_to` | The measured invariant, 18 decimal places |
| `growth_pct` | Raw growth over the window |
| `fee_apr_pct` | **The number.** Annualised, compounded |
| `reserve_a_to`, `reserve_b_to`, `lp_supply_to` | Latest state, for your own reconciliation |
| `venue_verified` | Always `True` for any row that exists — an unverified venue produces no rows at all (below), so this column is provenance (what the venue's status was at write time), not something you need to filter on |
| `source` | `deep` for every row this script (`measure`) writes — a nested 7/14/30/60-style lookback sweep. The (not yet built) periodic tick tool tags its own rows `tick`. Needed because the two can genuinely mix in one pool's history (a tick run bootstrapping a never-measured pool by invoking `measure` for it), so inferring the source from the `days` pattern alone isn't reliable |

Several lookback points on a quiet pool can land on the same transaction; the
script de-duplicates by transaction hash *within one run* before computing
rates, so you will sometimes get fewer rows than lookback points in a single
`measure` call. That is correct behaviour, not a dropped measurement. It is
**not** cross-run dedup, though — because `--out` is append-only (above), two
`measure` runs close together in time can both land on the same underlying
transaction and each write their own row for it. That's an accepted,
harmless byproduct of never overwriting the file: dedupe at analysis time on
`(pool, from_ts, to_ts)` if it matters for what you're computing, rather than
trying to prevent it at write time.

---

## 8. Step 4 — `sqrtk_tick.py`, the periodic (weekly) collector

```bash
python3 sqrtk_tick.py --pools pools.json --out sqrtk.csv
```

**What it is, and why it's a separate script rather than a `measure` flag.**
`measure`'s lookback sweep exists to reconstruct several historical points
from a single run — necessary the first time a pool is ever measured, and
expensive precisely because it's reconstructing the past (binary search into
transaction history per lookback point). Once a pool already has a real
periodic series on file, that reconstruction is redundant: this week's
current state *is* next week's historical point, for free, the moment it's
read. `sqrtk_tick.py` does exactly that — one current-state read per pool,
diffed against the most recent row already in `sqrtk.csv` for that pool —
and nothing else. Recommended cadence: weekly, run via cron or any scheduler;
nothing about the script assumes a particular interval, but the whole
persistence-testing motivation behind building this (see the project's
design record, not this runbook) is built around week-sized segments.

**Identity for the "most recent row" lookup is `track_asset`, never `pool`.**
Same reasoning as everywhere else in this pipeline — labels can change (a
re-enumeration with better ticker resolution, a manual rename), the pool's
own LP/share token doesn't.

**A pool with no prior row is bootstrapped, not left blank.** Rather than
recording a level with no computable growth yet, the script re-runs
`measure`'s actual lookback sweep for just that one pool — reusing
`cmd_measure` directly, not reimplemented — so a newly-added pool enters the
series with real multi-window depth on day one instead of waiting a month
for enough ticks to accumulate. This is exactly why `sqrtk.csv` has a
`source` column: bootstrap rows this script triggers are tagged `deep`
(they came from `measure`'s code path, unmodified), and this script's own
rows are tagged `tick` — the two genuinely mix within one pool's history,
so inferring which is which from the `days` pattern alone isn't reliable
once bootstrapping is in the picture.

**An unverified venue is skipped, exactly like `measure` refuses to produce
anything for one (section 6).** There's no safe number to compute for an
unconfirmed extraction rule, bootstrap or tick — an unverified venue's pool
is flagged and skipped before any per-pool network call, not measured and
marked provisional.

**The correctness check carries over unchanged.** A fresh reading below the
last one on file is flagged as a problem (non-zero exit) — and still
*written*, same as `measure`'s own behaviour: a drop is signal, never
something to silently drop from the record. A pool ticked again with
nothing new since its last row (same underlying transaction, nothing
happened in between) writes nothing and flags nothing — that's not an
error, just no new information yet.

**Cost, per pool, is dramatically cheaper than the lookback sweep.** A
current-state read is one page lookup (no binary search needed — the target
is "now," which resolves on the first page essentially always), one tx-UTxOs
fetch, and a datum fetch if the venue needs one for reserves/treasury/LP
supply — call it 3–4 requests per already-known pool, versus the ~35–40 a
full lookback sweep costs (section 7). The one call to `latest_block()` is
shared across the whole run, not per pool. Bootstrap calls (new pools only)
still cost the full sweep price, reported by that sub-call's own output.

**Known minor limitation, accepted rather than engineered around:** a
bootstrap sub-call constructs its own Blockfrost client inside `cmd_measure`
rather than sharing this script's rate limiter, so the two aren't perfectly
continuous across that boundary, and their API call counts are reported
separately rather than unified into one number. Reusing `measure`'s
correctness check and append logic completely unmodified was judged more
valuable than a unified call count — the alternative was duplicating that
logic locally, which is exactly the kind of drift this project has already
been bitten by once (`mock_run.py`'s fixture silently going stale when
WingRiders V2's real LP-supply mechanism changed out from under it).

---

## 9. The correctness check, and what a failure means

`sqrt_k_per_lp` must be **non-decreasing** for every pool over every interval.
If it falls, the script reports the drop with both transaction hashes and exits
non-zero. A fall is not noise and must never be averaged away — it means one of
these is true:

The reserve source is wrong. The three candidates are datum-stated reserves,
the raw UTxO Value, and Value minus treasury; picking the wrong one for a venue
makes the series drift for non-fee reasons.

A treasury accumulator was missed, or subtracted twice. Missing one inflates
the rate; double-subtracting can push it negative.

The LP supply source is wrong — for instance using `pool_holds_remainder` on a
venue that mints to the depositor.

The pool is not constant-product at all. Stableswap, weighted, and quadratic
pool families do not have this invariant, and `√k` is meaningless for them.
WingRiders V2 stableswap and Splash's `BalanceFnPool` / `StableFnPool` /
`DegenQuadraticPool` all fall here.

### Problem messages

| Message | Meaning | Action |
|---|---|---|
| `venue ... field paths are UNVERIFIED -- SKIPPED, no row written` | You have not run `discover` and confirmed the datum layout — the pool is skipped entirely, not measured-but-flagged | Do section 6. (If you see a `NO treasury paths configured` message below instead, that's a different, narrower case: `verified=True` was set by hand without actually filling in `treasury_paths` — fix the config, don't just flip the flag) |
| `NO treasury paths configured ... almost certainly WRONG` | Reserves were taken as raw Value | Do section 6 |
| `treasury path [...] did not resolve` | A configured path does not exist in this datum | Datum shape differs from what you mapped; re-run `discover` on *this* pool |
| `RECONCILE FAIL: datum reserves exceed Value` | Datum claims more than the UTxO holds | Wrong reserve paths, or wrong output selected |
| `sqrt(k)/LP FELL x% between ...` | The invariant went backwards | See above. Do not use the APR |
| `no pool output in <tx>` | NFT moved but nothing landed at the configured credential | Check `script_hash` is the payment credential, not the full address |
| `non-positive reserve after adjustment` | Over-subtraction | `min_pool_ada` wrong, or a treasury pair counted twice |
| `LP history empty at this timestamp` | Pool younger than the lookback point | Shorten `--days` |
| `history exceeds 50k events in the lookback window` | Safety cap hit | LP supply is unreliable; raise the cap deliberately or shorten the window |

Exit code is 0 only when no problems were flagged at all.

---

## 10. What this does *not* measure

`sqrt_k_per_lp` growth is fee yield with impermanent loss removed by
construction. That is the right measure for comparing venues and for validating
`apyBase` — and it is **not** an LP's return. An LP in ADA-SNEK also carries
the price path of SNEK and the IL that comes with it. In the DefiLlama
backtest, the pools that repeatedly won on trailing fee yield were exactly the
pairs where that gap is largest. Five points of fee edge is not five points of
return, and this script will not tell you the difference.

It also does not account for batcher fees, the ~2 ₳ per order and the
returnable 2 ₳ request oil, or the round-trip cost of entering and leaving a
position. Those belong in the allocation model, not here.

Finally, it measures pools you point it at. It has no opinion about whether
those pools are the right universe — and on current DefiLlama data, WingRiders,
SundaeSwap and Splash contribute no pools above the $25k floor at all, which is
its own open question.

---

## 11. Known-unverified list

Updated 30 Jul 2026 — the version of this list from before the first live
runs is obsolete; every item it raised about Minswap V2 and WingRiders V2 has
since been closed, evidence below. Carry what's *left* on this list into any
conclusion drawn from output produced before it's closed too.

**Resolved:**
- Datum field paths for Minswap V2 and WingRiders V2 are mapped, cited
  against contract source, and confirmed live: a 100-pool run (60 + 40, 30
  Jul 2026) found `sqrt(k)/LP` non-decreasing across every measured window,
  zero correctness-check violations.
- Minswap V2's pool script hash, pool NFT, and LP asset derivation
  (`lp_name.py`) are filled in and exercised across all 60 enumerated pools.
- `max_lp_supply` for Minswap V2 (assumed maxBound Int64) is confirmed
  on-chain, not just assumed: `held + total_liquidity − MAX = 10` reproduces
  exactly against a live pool (see the `minswap-v2` `Venue` entry's own
  comment for the tx/block cited).
- WingRiders V2's LP/share asset is **not** derivable from a formula — 27
  constructions were tried against published inputs and all failed — so it's
  read per-pool from the datum instead. That's not a workaround still owed;
  it's what `enumerate_wingriders.py` actually does today, for all 40
  enumerated pools.
- The script has been run against live Blockfrost extensively, not just
  synthetic fixtures — thousands of real calls across two venues, real
  response shapes observed and handled (including WingRiders' shared-address
  and venue-wide-NFT quirks, both discovered from real data, not the API
  docs).

**Still open:**
- WingRiders V1's address structure is unconfirmed, and its `Venue` entry
  (`wingriders-v1`) is still `verified=False`, treasury paths empty —
  untouched since this venue was first stubbed in.
- The `generic-cpmm` fallback venue is deliberately never verified — it's an
  escape hatch for a pool with no treasury accumulator at all, correct only
  by construction, not by discovery.
- Splash and SundaeSwap have no `Venue` entry, no `enumerate_*.py`, nothing —
  onboarding either is a from-scratch pass through Steps 1–2 above, same as
  Minswap V2 and WingRiders V2 originally were.

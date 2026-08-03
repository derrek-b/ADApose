# √k Snapshot — Developer Runbook

ADApose Labs, Inc. · scripts: `sqrtk_core.py` (shared primitives), `fetch_snapshots.py` (the recurring, DB-driven pipeline — also handles a manual deepen/catch-up via `--target-days`), `discover_venue_datum.py` (onboarding a new venue) · last updated 2026-08-03

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

Python 3.9 or newer. **Standard library only** (`urllib`, `json`, `csv`,
`decimal`, `bisect`, `dataclasses`) for everything except `fetch_snapshots.py`,
which reads the `pools` registry and each pool's latest state from Postgres
and needs `psycopg` for that — install it into a venv, never system Python:
`python3 -m venv .venv && .venv/bin/pip install -r requirements-db.txt`.
Every other file in this toolkit
(`sqrtk_core.py`, `discover_venue_datum.py`, `enumerate_*.py`, `selftest.py`,
all `mock_*.py`) stays dependency-free.

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

`fetch_snapshots.py` additionally needs `DATABASE_URL` in the same `.env` —
read-only in principle (it only ever issues SELECTs), though that's enforced
by the code today, not yet by the credential itself; there's no separate
read-only Postgres role set up.

The `.env` stays on the machine that runs the script. The key is never printed,
never written to the CSV, and is stripped from HTTP error text before any
exception surfaces (`Env.redact`). A shell `export` of either variable
overrides the file, which is what you want in CI.

**Add `.env` to `.gitignore` before the first commit.** Do not paste the key
into chat, tickets, or logs.

---

## 4. Step 0 — verify the script before pointing it at anything

Five checks run with **no network and no key**. Run all of them; they take
under a couple seconds total and they are the difference between "it
executes" and "the arithmetic is right".

```bash
python3 selftest.py
python3 mock_wingriders.py
python3 mock_minswap.py
python3 mock_enumerate.py
python3 mock_fetch_db.py
```

`selftest.py` covers address decoding (including that the enterprise `0x71`
and base `0x11` forms of the *same* script yield the same payment
credential), pool output selection (including a decoy key address whose
28-byte credential deliberately collides with the script hash — a matcher
that ignores the header byte returns the wrong UTxO), datum path walking,
the invariant algebra, and the paged binary search over transaction history
— all against `sqrtk_core.py`, the shared module every other file in this
toolkit imports from.

`mock_wingriders.py` (renamed from `mock_run.py`) fabricates 400 days of pool
history with a known fee rate of 0.02%/day baked in, plus two deposits that
mint LP, plus a treasury accumulator growing inside the same Value. It then
calls `fetch_snapshots.collect_snapshots` directly over that fake chain and
computes the annualized rate from the raw returned snapshots (there's no more
precomputed `fee_apr_pct` column — that figure is only ever computed at
display time now), asserting it comes back at 7.572% for every window. It
also re-runs with deliberately broken venue rules to confirm the guard rails
fire (a non-empty `problems` list), and with the unverified-venue case
removed entirely — `collect_snapshots` doesn't check `venue.verified` at all
anymore, that moved to `fetch_snapshots.cmd_fetch`'s own per-pool loop,
covered by `mock_fetch_db.py` instead.

`mock_minswap.py` covers what the WingRiders-shaped fixture in
`mock_wingriders.py` cannot: reserves and circulating LP read from the pool
datum rather than the Value, the `max_lp_supply − held == total_liquidity`
cross-check, and the venue-wide-NFT problem — Minswap V2 shares one NFT
across every pool, so history must be paged by the pool's own LP asset,
never by that shared token; a regression back to NFT-paging fails loudly
here. Same `collect_snapshots`-based adaptation as `mock_wingriders.py`.

`mock_enumerate.py` is an offline dry-run of `enumerate_minswap.py` against a
fabricated address listing built to hit every case the enumerator has to
handle: reverse-ordered pairs, a pair only recoverable from the datum, a
stray airdropped token alongside a real pair, duplicate asset-name labels,
a decoy output with no MSP NFT, and a listing longer than `--top`. Untouched
by the snapshot-model change apart from a one-line import fix.

`mock_fetch_db.py` covers `fetch_snapshots.cmd_fetch`'s own orchestration, as
distinct from chain-reading correctness: no prior snapshot triggers a
new-pool backfill (`--new-pool-days`); a routine pool whose every requested
calendar day already has a `pool_snapshots` row skips with exactly one API
call total (the chain-tip fetch — the covered-days check is a pure DB read,
no Blockfrost calls); partial coverage (some requested days already have a
row, some don't) fetches only the genuinely-missing ones; an unverified
venue is skipped before any covered-days work; a fresh reading below the
DB's latest known value is still written, flagged as a problem; a large
manual `--target-days` override against a pool with some days already
covered still only walks the missing ones (the retired
`migrate_snapshots_gap.py`'s old "deepen an existing pool" job, now just a
bigger flag value against this same script). It monkeypatches
`sqrtk_core.Env`/`Blockfrost` plus `fetch_snapshots.load_database_url`/
`psycopg.connect`/`load_pools_from_db`/`load_latest_snapshots_from_db`/
`load_covered_days_from_db`, so no real DB connection or `.env` is ever
touched, and reuses `mock_wingriders.py`'s fixture by import rather than
duplicating it.

All five must print a clean pass before you spend a single API call.

---

## 5. Step 1 — build `pools.json`

**Primary path: enumerate, don't hand-fill.** `enumerate_minswap.py` and
`enumerate_wingriders.py` read live chain state and build real, evidenced
entries directly — `script_hash`, `nft`, `track_asset`, `lp_asset`,
`asset_a`/`asset_b` — no guessing:

```bash
python3 enumerate_minswap.py --top 20 --out pools.json
```

WingRiders tracking is currently deferred — `pools.json` is Minswap-only,
top 20 by TVL, as of the 2026-08-01 cleanup (all prior WingRiders entries,
and Minswap pools ranked 21+, were deliberately dropped along with their
`measurements`/`current_readings` rows). `enumerate_wingriders.py --top N
--out pools.json` still works exactly the same way and would resume
WingRiders tracking; that's a deliberate decision to make, not a routine
step in this build sequence right now.

Both **merge into `--out`, never overwrite it.** Identity is `(venue,
track_asset)`, not `label` and not `address` — see why below. A pool already
on file is left exactly as it is; the run only adds ones it hasn't seen
there before. Both default `--out` to the same `pools.json`, so running
either (in any order, any number of times) builds one shared file, not one
per venue. Safe to re-run any time — to raise `--top` and reach further down
the size ranking, or to pick up pools created since the last run.

**`pools.json` is not what the recurring pipeline reads.** `fetch_snapshots.py`
reads the `pools` registry table in Postgres, read-only — a new entry added
here needs a separate (currently manual, one-off) sync step into that table
before `fetch_snapshots.py` will ever pick it up. `pools.json` is purely this
step's own output/hand-off format for the discovery workflow, same role a
CSV plays elsewhere in this toolkit's hand-off conventions.

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
python3 discover_venue_datum.py --pools pools.json --pool WR2-ADA-XXX
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

## 7. Step 3 — `fetch_snapshots.py`, the recurring pipeline

```bash
.venv/bin/python3 fetch_snapshots.py --out /tmp/run.csv
# deepen/resume an existing pool's history (cheap even at a large N -- see
# the covered-days mechanism below):
.venv/bin/python3 fetch_snapshots.py --out /tmp/deep.csv --target-days 35
```

**One tool now, not two.** The old design split this into `measure` (a
multi-window lookback sweep, for onboarding) and `sqrtk_tick.py` (a periodic
current-state diff, for pools already on file) — two commands producing two
different row shapes (a comparison-pair: `from_ts`/`to_ts`/precomputed
`growth_pct`/`fee_apr_pct`). That comparison-pair design broke silently under
an ongoing daily cadence: a display layer picked whichever single row's own
window was "closest to nominal 7/30 days," but a daily diff only ever
produces ~1-day-window rows, so the picked row — and the displayed APR —
would freeze forever after the first sweep and never update again. A later
design (`migrate_snapshots_gap.py`, since folded back into this file — see
below) split things a second time, for a different reason: a one-time
"rebuild N days of density" tool separate from the routine tick. Calendar-
anchoring (next paragraph) removed the reason for that split too.

The fix: store bare point-in-time snapshots instead (pool, timestamp,
`sqrt(k)/LP`, reserves, LP supply — no comparison baked in at all). Any
window's APR gets computed **fresh**, at display time, by picking two
snapshots and computing growth between them on the spot (see
`web/src/db/schema.ts`'s `pool_snapshots` comment). That collapses onboarding
and ongoing collection into one function, `collect_snapshots(bf, pool,
venue, targets, source, problems)`, called with a different `targets` list
depending on the case.

**Targets are calendar-anchored to UTC midnight**, not relative to whatever
moment the script happens to run: `today_midnight = (now // DAY) * DAY`.
Why this matters: the displayed APR diffs the *latest* snapshot against an
*N-days-ago* one, so if "latest" drifts around with whatever time a human
(or eventually a cron) happened to invoke this, the real measured window
drifts with it too — one day's "7D APR" might really be measured over 6.5
days, the next over 8, independent of anything about the chain itself. See
`docs/decisions.md`'s 2026-08-03 D30 addendum for the full reasoning,
including why the walk stays strictly backward ("at or before" the target,
never forward, and no hard cutoff on how far back it's allowed to search) —
`sqrt(k)/LP` is monotonically non-decreasing by design, so accepting a
transaction from *after* the nominal boundary would systematically bias the
reported value upward, not just measure it imprecisely.

- **A pool with no prior snapshot at all** — backfilled with `--new-pool-days`
  (default 35, replacing the old `--backfill-days`) worth of calendar-
  anchored *spread*: daily snapshots at offsets 0 through N days back from
  today's midnight (N+1 points, so the oldest point is genuinely N days old,
  not N−1 — a fencepost bug fixed 2026-08-01). 35 rather than a bare 30 is
  deliberate: the D30 addendum's 30D APR tolerance band is `target=30,
  max=45`, and having 5 candidate points inside that band instead of 1 means
  a single quiet stretch near day-30 doesn't leave the 30D window empty.
- **A pool with a prior snapshot** — checked per calendar day, not per pool:
  a new "covered days" query (`load_covered_days_from_db`) loads, in one
  round trip, every UTC day that already has a `pool_snapshots` row for any
  pool in the registry. Each pool's target list (`--target-days`, default 7)
  is filtered down to only the days NOT already covered before any
  Blockfrost call happens — a day already on file costs nothing. This
  replaces the old flat "skip if the last reading is under 0.5 days old"
  check, and it's what makes a large manual `--target-days` override (the
  retired `migrate_snapshots_gap.py`'s old job) cheap: only the genuinely-
  missing days get walked, not a full unconditional rebuild.
- **Why `--target-days` defaults to 7, not 1:** a true daily steady state
  only ever needs *today's* one new point — yesterday's is already covered
  by yesterday's run. 7 is sized for right now, while nothing schedules this
  yet and a human runs it manually: since asking for extra already-covered
  days is free, a 7-day default means "run it at least once a week" is a
  safe operating assumption, with nothing silently missed, and no need to
  remember exactly when it last ran. Once real scheduling exists and it
  runs truly daily, this costs nothing extra and doesn't need lowering.
- **Whichever branch fires** — every newly-fetched row is compared against
  the last known value (oldest new row vs. the DB's prior reading) purely to
  flag (not gate) a decreasing reading.

The actual finding/reading mechanics are unchanged from the old `measure`:
for each target timestamp, the newest transaction touching the pool's
*tracking asset* (`track_asset` if set, else `nft`) at or before it is
located, walking backward past any non-pool transaction (a wallet transfer,
a farm deposit — the tracking asset moving without the pool being touched)
until a genuine pool-state transaction is found. `/assets/{asset}/transactions`
is newest-first at 100 rows per page and a busy pool has thousands of pages,
so rather than paging the lot, the search brackets the target by doubling
the page index, then binary-searches — roughly `2·log₂(pages)` requests per
target instead of `pages`.

**LP supply, both verified venues today: `pool_holds_remainder`.** Minswap V2
and WingRiders V2 both hold their own unissued LP/share reserve inside the
pool UTxO, so circulating supply is `max_supply − held`, read directly off the
same Value already fetched for reserves — no extra requests, no history walk.
(A different mechanism, `mint_history` — reconstructing supply from mint/burn
events, walked backward from current supply since Blockfrost's history
endpoint doesn't carry block times — still exists for `wingriders-v1`/
`generic-cpmm`, the two venues that remain `verified=False`.)

### Estimating request count

Per pool, roughly:

```
1                                    chain tip (once per run, not per pool)
+ per target day:      2·log₂(pages) page reads     ≈ 18–22 for a busy pool
                     + 1              tx UTxOs
                     + 1              datum (if the venue needs one for
                                       reserves/treasury/LP supply)
                     + a few          for any non-pool txs skipped while
                                       walking back to a genuine pool tx
```

Observed, not estimated (from the old `measure`, same underlying mechanics):
a 100-pool run (60 Minswap V2 + 40 WingRiders V2, 30 Jul 2026) used
2,545 + 1,364 = 3,909 calls for 371 rows — roughly 35–40 requests per pool
for up to five target points. A routine tick against an already-known pool
whose target day(s) aren't yet covered costs a small fraction of that per
day (one page lookup, one tx-UTxOs fetch, a datum fetch if needed — call it
3–4 requests), or literally zero extra calls per day the covered-days check
above already has on file.

### Output columns (flat CSV, one row per snapshot)

| Column | Meaning |
|---|---|
| `venue`, `pool_label` | From the `pools` registry |
| `track_asset` | The pool's stable identity (`pool.identity` — `track_asset` if set, else `nft`), **not** `pool_label`. Labels can change (a re-enumeration with better ticker resolution, a manual rename); this doesn't |
| `ts` | The snapshot's own on-chain timestamp — **not** necessarily the requested target. The search snaps to a real transaction, so a quiet pool's "7 days ago" target may resolve several days further back. Always read `ts`, never assume the target was hit exactly |
| `sqrtk_per_lp` | The measured invariant, 18 decimal places. **No `growth_pct`/`fee_apr_pct` here anymore** — those are computed fresh from a pair of snapshots at display time, never stored per-row |
| `reserve_a`, `reserve_b`, `lp_supply` | Raw state at `ts`, for independent reconciliation |
| `venue_verified` | Always `True` for any row that exists — an unverified venue produces no rows at all, so this column is provenance, not something to filter on |
| `source` | `backfill` (a brand-new pool's initial `--new-pool-days` depth), `live` (any already-known pool's fetch — the routine default *or* a large manual `--target-days` deepen, both use this same branch/tag), or `migration` (carried over from the old comparison-pair `measurements` table during the cutover — see `web/scripts/migrate-measurements-to-pool-snapshots.mts`) |

Several target days on a quiet pool can land on the same transaction;
`collect_snapshots` de-duplicates by transaction hash *within one call*
before returning rows, so you may get fewer rows than targets requested —
correct behaviour, not a dropped measurement. Cross-run duplication is a
non-issue by construction now: `pool_snapshots` has a unique constraint on
`(venue, track_asset, ts)`, and `ingest-snapshots.mts` upserts with
`ON CONFLICT DO NOTHING` against it — re-running this script, or re-ingesting
the same CSV, is always safe.

---

## 8. The correctness check, and what a failure means

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
| `LP history empty at this timestamp` | Pool younger than the lookback point | Shorten `--target-days`/`--new-pool-days` |
| `history exceeds 50k events in the lookback window` | Safety cap hit | LP supply is unreliable; raise the cap deliberately or shorten the window |

Exit code is 0 only when no problems were flagged at all.

---

## 9. What this does *not* measure

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

## 10. Known-unverified list

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

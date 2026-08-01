# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ADApose Labs (renamed from Pomona Finance — "Pomona Capital" was already
taken) — Cardano DeFi automation. **Current direction (D26, 2026-07-30):** a
fee-accrual allocation model, measured via the constant-product pool
invariant `√k = √(reserve_A · reserve_B)` (rises only from trading fees,
unaffected by swaps/deposits/withdrawals/price) — design docs in
`docs/mechanism-sqrtk.md` (the invariant, vault state, share issuance),
`docs/fee-crystallization.md` (the fee model), `docs/workflows/` (per-action
contracts, `docs/workflows/README.md` is the index). This replaces a
farm-emissions auto-compounding vault (Minswap V2, pooled-vault design) that
was the product through D1–D25: real numbers showed that market too small to
build a business on at any achievable share, not a technical failure. That
design is fully preserved, unedited, in `legacy/` — see `legacy/README.md` —
in case auto-compounding becomes viable again later, as an add-on or on its
own.

**Narrowed further (D27/D28, 2026-07-31):** vault custody is per-user
(individual, one UTXO per owner), not pooled — no farm layer forces
commingling in this model the way it did for the old one, and user-defined
strategy parameters (a "Lend & Earn"-style composed strategy is the worked
example) need per-user state a pooled/fungible-share vault can't represent.
The √k invariant survives as a measurement primitive, but is one building
block in a growing strategy library now, not the whole product —
`mechanism-sqrtk.md`'s "share issuance" math specifically is pooled-only and
doesn't apply to the vault being built (flagged in that doc directly).
**v1 target is a cross-DEX LP aggregator + one-click zap-in** ("DexHunter
for liquidity positions") — pool discovery/comparison across DEXs (TVL,
volume, √k-based fee APR) with direct zap-in execution, before any
managed-strategy automation ships. Pooled vaults aren't abandoned, just
deferred to a distinct later service — `docs/v2-ideas.md`.

`docs/adapose-sqrtk-vault-brief.md` was the original proposal document that
started this direction — it's owned by this project now (not a bridge
document from elsewhere anymore), being actively phased out as each piece
gets a proper doc per the list above. Don't treat it as current for anything
that's since moved out of it; check `docs/workflows/README.md`'s "Relationship
to the brief" note for what's left and why.

**Status: the on-chain/off-chain architecture for the √k model is not yet
designed.** No validator, no executor, no web app exist for it yet — don't
assume `legacy/`'s shapes (datum layout, redeemer set, invariants) carry
over; they were built for a materially different accounting model
(vault-level HWM crystallization vs. batch-rate share minting) and a
materially different custody target. What **does** exist and is real,
tested, mainnet-verified code: `scripts/sqrtk/` — a toolkit that measures √k
fee-accrual directly on-chain across Minswap V2 and WingRiders V2, both
pool enumeration and a growing historical dataset (`scripts/sqrtk/sqrtk.csv`).
Read `scripts/sqrtk/SQRTK_RUNBOOK.md` before touching anything there.
`scripts/dispersion/` is a separate, standalone side-tool — a DefiLlama-derived
cross-sectional read, explicitly not the gold-standard measurement; it shares
no code or files with `scripts/sqrtk/`.

`docs/decisions.md` is the authoritative design record (D1–D26+; several
early entries are marked SUPERSEDED — always check headers, and D26 is
itself the pivot, not a normal incremental decision) — read it before
implementing anything, and update it (dated entries) when a design decision
is made or changed. It was never split when `legacy/` was carved out — it's
the one continuous history covering both the old design and why it stopped
being the active product, and stays that way going forward. `docs/v2-ideas.md`
is the parked-features ledger for the *current* direction (not commitments) —
started fresh at the pivot; the prior architecture's fourteen parked ideas
live in `legacy/docs/v2-ideas.md` instead, check both before re-deriving a
deferred feature that sounds architecture-specific.

Use `/commit` to commit (it also checks code-coupled docs for staleness
afterward) and `/update-brain` at the end of a working session (captures
decisions into `docs/decisions.md`, session history into `CHANGELOG.md`).
`docs/crib_sheet.md` is a frozen interview artifact and `legacy/` is a frozen
historical snapshot (see its own README) — neither has a live upstream to
track, so neither gets edited in place; if `legacy/` is ever revived that's
an active decision requiring its own fresh verification pass (chain state,
dependency versions, and ecosystem facts will have moved on since it was
archived), not an update-in-place. `reference/` is different: it vendors
copies of *live* external sources (Minswap/WingRiders code, docs, SDKs) that
keep existing and changing out in the world, and gets read for the current
direction's own work too, not just conditionally on a revival. Never
hand-edit vendored content to insert our own opinions or fixes — but when
the actual upstream source updates its own claim, curate that update into
the vendored copy with a clear, dated citation (matching
`docs/adapose-sqrtk-vault-brief.md`'s own inline "Correction (dated)"
convention) rather than leaving a known-stale claim in place. Re-vendoring a
new version/commit is expected, not a rule violation.

## Commands

**`scripts/sqrtk/` (Python 3.9+, standard library only — no `pip install`):**
the active toolkit. Full usage in `scripts/sqrtk/SQRTK_RUNBOOK.md`.
```bash
cd scripts/sqrtk
python3 sqrtk_snapshot.py selftest   # offline, no network — run before anything else
python3 mock_run.py                  # offline end-to-end mock of the deep-snapshot tool
python3 mock_minswap.py              # offline mock: Minswap-specific datum/NFT paths
python3 mock_enumerate.py            # offline dry-run of enumerate_minswap.py
python3 mock_tick.py                 # offline end-to-end mock of the periodic collector
python3 enumerate_minswap.py --top 60 --out pools.json      # build/extend the pool list
python3 enumerate_wingriders.py --top 40 --out pools.json   # merges, never overwrites
python3 sqrtk_snapshot.py measure --pools pools.json --out sqrtk.csv --days 7,14,30,60
python3 sqrtk_tick.py --pools pools.json --out sqrtk.csv    # weekly: one current-state
                                                              # reading per pool, appended
```
Needs `scripts/sqrtk/.env` (gitignored) with `BLOCKFROST_PROJECT_ID` and
`BLOCKFROST_BASE_URL` — mainnet, not preprod.

`scripts/dispersion/` holds one standalone script (`defillama-dispersion-script.py`,
run the same way: `cd scripts/dispersion && python3 defillama-dispersion-script.py`)
— a fast DefiLlama-derived cross-sectional read, not the gold-standard
measurement and not wired to anything in `scripts/sqrtk/`.

**Everything else (validators, executor, web) does not exist yet for the
current direction.** For the archived app's own toolchain (Aiken, Node/TS —
useful only if reviving `legacy/`, not for current work), see
`legacy/README.md`.

## Critical toolchain fact (carries forward, nothing built against it yet)

When Cardano tx-building code gets written for the current direction, it
should use **@spacebudz/lucid v0.20 (SpaceBudz Lucid), NOT Lucid Evolution**
— @minswap/sdk's API is built on SpaceBudz Lucid (decision D7), and nothing
about the pivot changes that. It's published on JSR (`npm:@jsr/spacebudz__lucid`,
needs a `.npmrc` pointing `@jsr` at `https://npm.jsr.io`, same as `legacy/executor/`
had). Don't reach for lucid-evolution or lucid-cardano.

## Architecture

**Not yet designed** for the current direction — no datum shapes, no
redeemer set, no invariant list exist yet. What's real:

- **Vault custody: individual (per-user), not pooled** — `docs/decisions.md`
  D27 is the decision record entry (reference architecture, reasoning, what
  simplifies as a result). No datum/redeemer shapes exist yet.
- **The √k measurement mechanism** — `docs/mechanism-sqrtk.md` is the design
  doc (now one building block/strategy among several, not the whole
  product — see D27); `docs/decisions.md` D26 is the market-size finding and
  on-chain verification behind using it at all; D28 is the v1 product
  sequencing decision (cross-DEX aggregator + zap-in first, ahead of any
  strategy automation).
- **`web/`** — scaffolded (D29): Next.js (App Router, TypeScript), Tailwind +
  shadcn/ui, TanStack Query/Table + Server Components (no Redux). Reads
  `scripts/sqrtk/pools.json`/`sqrtk.csv` directly — no API/DB layer yet, to
  conserve Blockfrost usage. First slice per D28 (pool discovery/comparison)
  not yet built — only the verified scaffold exists so far.
- **`scripts/`** — the working toolkit. `sqrtk_snapshot.py` does deep,
  multi-window historical measurement (onboarding a pool/venue, or an
  occasional deep-dive); `sqrtk_tick.py` is the periodic (weekly) collector,
  one current-state reading per pool appended to the same growing
  `sqrtk.csv`; `enumerate_minswap.py`/`enumerate_wingriders.py` build and
  extend `pools.json` from live chain enumeration, never overwriting what's
  already known. All of it mainnet-verified, not just unit-tested — see the
  runbook for the actual evidence (100-pool clean runs, zero correctness
  violations).
- **`reference/`** — vendored read-only material: Minswap AMM V2 spec,
  formula.md, farm docs, a full @minswap/sdk snapshot (`reference/sdk`,
  pinned commit in `VENDORED_COMMIT`). Still relevant — the √k model reads
  the same pools and will need the same DEX mechanics for whatever
  deposit/rebalance/redeem flow it ends up with.
- **`docs/dex-adapters.md`** — Minswap-vs-WingRiders order-construction field
  comparison (deposit-order shapes, cancel-tx building). Written during the
  old architecture's design but not moved to `legacy/` — the underlying DEX
  mechanics it documents are venue facts, not old-architecture-specific, and
  the current direction will need the same research.

## Dev loop

For `scripts/`: `selftest` + all `mock_*.py` (offline, no key, no network) →
`discover` a venue's datum shape before trusting any field mapping → `measure`
or `tick` against real mainnet data. Nothing here touches preprod or an
emulator — it's read-only chain measurement, not transaction building.

For whatever gets built next (validator, executor, web): no dev loop exists
yet because nothing exists yet to loop on. The old app's dev loop (`aiken
check` → Lucid emulator → Yaci DevKit → preprod → mainnet) is preserved in
`legacy/README.md` as a reference shape, not a current instruction.

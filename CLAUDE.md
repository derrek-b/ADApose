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
`reference/` is vendored read-only; `docs/crib_sheet.md` is a frozen
interview artifact — never edit either. `legacy/` is frozen by design (see
its own README) — treat it the same way: consult, don't edit.

## Commands

**`scripts/sqrtk/` (Python 3.9+, standard library only — no `pip install`):**
the active toolkit. Full usage in `scripts/sqrtk/SQRTK_RUNBOOK.md`.
```bash
cd scripts/sqrtk
python3 sqrtk_snapshot.py selftest   # offline, no network — run before anything else
python3 mock_run.py                  # offline end-to-end mock of the deep-snapshot tool
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

- **The √k measurement mechanism** — `docs/mechanism-sqrtk.md` is the design
  doc; `docs/decisions.md` D26 is the decision record entry citing the
  market-size finding and the on-chain verification behind it.
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

# Changelog

Session-level history, maintained by `/update-brain`. Root-level single file while
components share one repo lifecycle; split per-component if they diverge.

## [Unreleased]

### `fetch_snapshots.py` unified with `migrate_snapshots_gap.py` — calendar-anchored targets (2026-08-03)

- **Diagnosed a real ~1.7-day data gap and a design bug behind it:** targets
  were computed relative to whenever the script happened to run, so the
  displayed APR's actual measured window drifted independent of the chain.
  Fixed by calendar-anchoring every target to UTC midnight. See D31.
- **Two scripts merged into one:** `migrate_snapshots_gap.py` deleted; its
  old "deepen an existing pool" job is now just `fetch_snapshots.py
  --target-days <bigger N>`, made cheap by a new per-calendar-day "covered
  days" check (`load_covered_days_from_db`) that replaces the old flat
  0.5-day freshness literal.
- New flags: `--target-days` (default 7) and `--new-pool-days` (default 35,
  replacing `--backfill-days`).
- **A real bug found via the actual mainnet dry run, not mocks:** the
  decreasing-value check wrongly assumed the oldest newly-fetched row is
  always the DB's last-known value's immediate successor — produced 5
  false "FELL" flags before being fixed (merge-by-timestamp instead of
  assumed adjacency). New regression test added using realistic probed
  values, since the existing mocks' synthetic values happened to mask this
  class of bug.
- `mock_fetch_db.py` rewritten (8 cases, 2 new); `SQRTK_RUNBOOK.md` and
  `CLAUDE.md` updated to match.
- Real-data verification: gap closed, idempotency confirmed at the data
  level, a 35-day manual deepen added 78 new historical rows across 20
  pools at 1888 API calls.

### Wallet connection — CIP-30 discovery, modal picker, `@spacebudz/lucid`, persistence (2026-08-03)

- Header's "Connect Wallet" button wired end-to-end: a modal wallet picker
  (shadcn Dialog) lists detected CIP-30 wallets, connects via
  `@spacebudz/lucid`'s `selectWalletFromApi`, decodes the bech32 address,
  and reads (never gates on) the connected network for display.
- SSR/WASM boundary, three files: `connect-wallet-button-dynamic.tsx` (the
  only legal place for `next/dynamic(..., {ssr:false})`, confirmed against
  vendored Next 16 docs) → `connect-wallet-button.tsx` (the real
  Lucid-touching logic) → `wallet-context.tsx` (pure state, zero Lucid
  import, even type-only).
- Address display truncates to `<prefix><4 chars>...<4 chars>` (e.g.
  `addr1qx2f...8k9v`); network shown as a plain "Mainnet"/"Testnet" label
  alongside it.
- Reconnect-on-refresh: a zero-storage design (CIP-30 `isEnabled()` scan)
  was tried first and disproven in live testing against Lace; shipped as
  remembering the last-connected wallet's key in `localStorage` (cleared on
  disconnect) instead. See `docs/decisions.md` D29 addenda (2026-08-03) for
  both this and the Turbopack/WASM findings.
- `web/.npmrc` + `@spacebudz/lucid` (`npm:@jsr/spacebudz__lucid@0.20.14`,
  the same version already proven in `legacy/executor`/`reference/sdk`)
  added to `web/package.json`.

### `pool_snapshots` replaces `measurements` — √k pipeline rebuilt end-to-end (2026-08-02)

- **Diagnosed and fixed a real bug:** the old comparison-pair `measurements`
  table would have frozen 7D/30D APR forever under daily ticking (never
  refreshing past the initial deep-sweep). Replaced with point-in-time
  `pool_snapshots`; APR computed fresh at display time from any two
  snapshots. `current_readings` FK columns swapped to from/to
  snapshot-ID pairs. See D30.
- **Python toolkit (`automation/sqrtk/`) rewritten to match:**
  `sqrtk_snapshot.py`/`sqrtk_tick.py`/`sqrtk_tick_db.py`/`mock_run.py`/
  `mock_tick.py` deleted; new `sqrtk_core.py` (shared primitives),
  `fetch_snapshots.py` (recurring pipeline), `discover_venue_datum.py`,
  `migrate_snapshots_gap.py` (one-time), `selftest.py`, renamed/rewritten
  mocks.
- **Two real bugs fixed during the rewrite:** Blockfrost retry logic didn't
  catch connection resets (`ConnectionError`/`RemoteDisconnected`, missed by
  a narrower `except urllib.error.URLError`); a fencepost bug meant "N days
  of backfill" only ever produced N−1 days of real spread.
- **Live migration executed:** 40 historical points extracted from the old
  `measurements` table, a corrected 30-day mainnet gap-fill run (6,806
  Blockfrost calls, 617 rows), one anomalous reading excluded after manual +
  automated-check confirmation (see D30).
- `web/scripts/refresh-minswap-readings.mts` rewritten: `pickWindow` is now
  floor-only (never accept a candidate under the nominal window — D30
  addendum); `decimal.js` added as a dependency for precision parity with
  the Python side.
- Pre-existing `web/tsconfig.json` scoping bug fixed (excluded `scripts/`
  from Next's typecheck, unblocking `npm run build`).

### Pool comparison table — styling pass + APR-mismatch display (2026-08-02)

- Brand colors centralized in `globals.css` as named Tailwind v4 theme
  tokens (`--brand-crimson`, `--brand-cardano-blue`) instead of hex literals
  scattered across components.
- Table: borders, alternating-row tint, crimson header (removed an
  inherited hover-highlight that didn't apply to a non-interactive header).
- 7D/30D APR cells: a value whose actual measured window doesn't match its
  nominal label now shows a small `*` marker (visible without hovering)
  opening a tooltip with the real figure and a one-line reason — added
  shadcn's Tooltip component (`@base-ui/react`-backed) and wired
  `TooltipProvider` into the app's provider tree.

### `web/` scaffolded — Next.js foundation for the aggregator (2026-07-31)

- **D29: frontend foundation decided and built.** Next.js (App Router,
  TypeScript), Tailwind + shadcn/ui, TanStack Query/Table + Server
  Components — deliberately not Redux (no cross-cutting client state yet)
  and not Bootstrap (FUM's stack, not copied wholesale). Reads
  `scripts/sqrtk/pools.json`/`sqrtk.csv` directly for now; no API/DB layer,
  specifically to conserve Blockfrost usage while that stays the only data
  source. `QueryClientProvider` wired into the root layout for real, not
  left an inert dependency; shadcn's `table` component added alongside
  TanStack Table. Both `npm run build` and `npm run dev` verified clean.
- **npm audit surfaced 3 high-severity findings** (old `postcss`/`sharp`
  nested inside Next 16.2.12's own dependency tree) — npm's suggested fix
  would downgrade Next to 9.3.3, rejected as nonsensical. Accepted as-is:
  no untrusted CSS/source-map input, no user-uploaded images. Revisit
  trigger recorded (D29 addendum): only if the app ever renders
  third-party-sourced image content through `next/image`.
- **`create-next-app` generated its own `AGENTS.md`/`CLAUDE.md` pair** in
  `web/` flagging that the installed Next.js version may have API changes
  past an LLM's training data — kept as-is, not overwritten.

### Vendored `@minswap/sdk-v2` upgraded to byte-exact via `npm pack` (2026-07-31)

- The first vendoring pass went through WebFetch and, checked against a
  real `npm pack @minswap/sdk-v2` afterward, had introduced two real
  inaccuracies: `LICENSE` said "Minswap **Labs**" (real text has no "Labs"),
  and `UPSTREAM_README.md` had an AI-introduced mid-line wrap. Both fixed.
  Added `npm-dist/index.d.ts` and `npm-dist/index.js` (named `npm-dist/`,
  not `dist/`, to dodge the root `.gitignore`'s blanket `dist/` rule) — real,
  unminified, JSDoc-annotated output, the closest thing to source available
  without repo access. Lesson banked: WebFetch is fine for research, not for
  anything meant to be byte-exact.

### `/commit` skill restructured — doc pass now runs before any commit

- Previously: commit code, then check doc staleness against the commit that
  just landed, then a second trailing doc commit. Now: stage, run the
  staleness check and doc pass against what's staged (not yet committed),
  and only then decide commit structure — single, per-scope with docs
  folded in, or a wholly separate docs commit — with the full diff (code +
  docs) in view before anything is committed.

### Vault custody + v1 product re-scoped — individual vaults, aggregator-first (2026-07-31)

- **Individual (per-user) vault custody chosen over pooled for the √k model
  (D27)** — no farm layer forces commingling here the way it did for the old
  design, and user-defined strategy parameters (a "Lend & Earn"-style
  composed strategy is the worked example) need per-user state a pooled
  vault can't represent. Reference architecture: FUM (`~/code/fum_project`),
  a separate local project — individual position vaults, strategy-as-
  parameters, executor capped by a destination-whitelist validator
  registry, same owner/executor asymmetry as this project's own D2. √k the
  invariant survives custody-agnostic; the pooled-only share-mint/burn math
  (`mechanism-sqrtk.md`'s "Share issuance" section) does not.
- **v1 target re-scoped to a cross-DEX LP aggregator + one-click zap-in
  ("DexHunter for liquidity positions"), ahead of any managed-strategy
  automation (D28).** Pool discovery/comparison across DEXs (TVL, volume,
  √k-based fee APR) with direct zap-in execution into an individual vault,
  no strategy running yet. Re-checked the competitive landscape this
  session: DexHunter itself confirmed still swap-only; MuesliSwap's
  "Liquidity Hub" (Catalyst F14, previously recorded as rejected/empty-space
  at D17) claims a working MVP of a near-identical concept — Catalyst
  funding not approved, live status unverified, flagged for a harder check.
- **Pooled vaults parked, not abandoned** — a distinct future service for
  cost-amortization on small positions, `docs/v2-ideas.md`, with a
  shared-library-not-shared-validator guardrail already agreed for if/when
  it's built.
- `docs/mechanism-sqrtk.md`, `docs/fee-crystallization.md`, and
  `docs/workflows/rebalance.md` each got a dated note flagging what's now
  stale for the individual-vault model (the crystallization apparatus
  simplifies to withdrawal/rebalance-only; the mid-flight multi-holder
  question in rebalance.md dissolves) — the actual rewrite pass is still
  pending.

### Minswap farm co-sign confirmed key-optional; `@minswap/sdk-v2` vendored (2026-07-31)

- Minswap team confirmed (Discord) the farm co-sign GraphQL API needs no
  provisioned API key — current rate limit covers almost all use cases. Closes
  the "provision key-API access" prerequisite D19/week1-verify.md's dust-cycle
  list assumed. Does not reopen D26 (the pivot was a market-size finding, not a
  technical one) — recorded for a possible future legacy revival.
- `reference/farm-docs/minswap-farm.md` §4 got a dated correction note for the
  above, directly in the vendored doc (original text kept, not erased) — the
  source itself updated its answer, so the vendored copy was updated to
  match; not the same thing as editing frozen/historical material.
- New `reference/minswap-sdk-v2/` — vendors `@minswap/sdk-v2` (npm v1.0.0), the
  Lucid-free successor to `@minswap/sdk` (`reference/sdk`, D7) with a typed
  `sdk.farm` module. npm-only vendoring (no reachable git source); full caveats
  and evidence tags in that directory's own README. Full detail: D19 addendum,
  `docs/decisions.md`.

### D26 pivot — legacy archive, √k design docs, scripts/ toolkit reorg (2026-07-29/30)

- Old auto-compounding app (validators/, executor/, its docs/workflows/) moved
  intact to legacy/, frozen — see legacy/README.md. Supersedes D20; full
  rationale in docs/decisions.md D26. Repo-wide Pomona → ADApose rename
  landed same day, scoped to prose/identifiers.
- docs/adapose-sqrtk-vault-brief.md decomposed into living design docs —
  mechanism-sqrtk.md, fee-crystallization.md, workflows/{rebalance,deposit,
  redeem}.md, each edited in place going forward. Brief shrunk ~410→~140
  lines, kept only for still-open decision-track material (§1, §8).
- scripts/ split into scripts/sqrtk/ (the interoperating measurement
  toolkit) and scripts/dispersion/ (standalone DefiLlama script, no shared
  code).
- New command sqrtk_tick.py — periodic (weekly) collector, appends one
  current-state reading per pool to the same sqrtk.csv the deep-snapshot
  tool writes to. New CSV columns: track_asset (safe cross-tool pool-identity
  join key) and source (deep/tick).
- measure now refuses unverified venues outright — zero API calls spent,
  instead of computing and flagging.
- enumerate_*.py now merge into pools.json instead of overwriting — full
  WingRiders set (40 pools, up from a top-20 cut).

### Deposit web-side function decomposition + WingRiders adapter evidence (2026-07-26)

- **`deposit.md` Steps A (place order) and B (order lifecycle/cancel) now have
  a full client-side function decomposition**, each function classified as
  DEX-specific (behind the adapter), must-match-the-validator-bit-for-bit
  (`shared/`, D22), or purely web-local: `quoteDeposit`/`buildDepositOrder`/
  `buildCancelTx` (adapter); `previewShares`/`resolveTolerancePct`/
  `parseVaultDatum`/`encodeOrderDatum` (`shared/`); `resolveDeadline`,
  `checkLegStatus`, `listMyLegs`, `cancelOrder`/`cancelLegs` (web-local).
  `buildDepositOrder` returns `Order[]` (not a single order) and `quoteDeposit`
  returns `{expectedLP, minimumLP}` — both decided now, before WingRiders
  exists, so its eventual adapter doesn't force a breaking interface change.
- **D22 corrected**: adapters are cross-consumed (web + executor), not
  executor-scoped — the web calls adapter functions directly for the user's
  own client-signed txs. Practical implication: `adapters/` needs its own
  workspace package, not nested under `executor/src/`.
- **New `docs/dex-adapters.md`** — full Minswap-vs-WingRiders deposit-order
  field comparison backing the adapter interface, including tracing that
  `buildCancelTx(orderRef)` generalizes to WingRiders by construction (no
  official cancel/reclaim tx-builder exists anywhere in their ecosystem —
  checked `@wingriders/cab` directly, confirmed absent, not assumed).
- **WingRiders evidence base deepened** (still not being implemented — Phase
  1 is Minswap only, D20): vendored `Pool.hs`/`ConstantProduct.hs` (the
  actual deposit LP-mint math, incl. a real product gap — two-sided
  imbalanced deposits take a haircut instead of a swap, unlike Minswap) and
  both official TS packages (`dex-serializer`, `dex-blockfrost-adapter`) —
  confirmed neither has a deposit-quote or cancel-tx-building function.
- **`vault-init.md`** gains two open questions: pool-registry recording
  (durable thread-NFT config, since it's generated at init, not derivable
  from `plutus.json`) and a CIP-68-style datum extensibility field (decided
  now — see D20 addendum, `docs/decisions.md`).
- Fixed stale D21/D23 batcher-fill-policy text in `deposit.md` that predated
  D24's mainnet resolution (was still reading "preprod dust test pending").

### Batcher fill-policy test — RESOLVED (2026-07-25)

- **THE open structural bit is settled: the licensed Minswap batcher DOES fill
  orders whose `successReceiver` is a third-party script.** Preprod attempt
  first (control + probe DEPOSIT orders) sat unfilled 20+ hours — inconclusive;
  MinTeam confirmed preprod batcher reliability isn't guaranteed. Escalated to
  a real mainnet probe: a DEPOSIT order with `successReceiver` = a throwaway
  script filled in ~90 seconds, confirmed 4 independent ways against raw chain
  state (order spent, new UTXO at the receiver, inline datum matches our
  marker byte-for-byte, fill tx distinct from our own submission).
- **All three things this bit gated (D23) are now settled (D24):** deposit UX
  stays D21's chained one-signature path; compound shape stays D23's
  HarvestDeposit absorb; `RecordHarvest` is DELETED (not kept as alternate) —
  the vault redeemer set is final.
- **First real-money mainnet transaction of the project** (~9.5 ADA, fully
  recovered via reclaim). Test spikes (stub validators, throwaway wallet
  generator, control/probe/status scripts) deleted after the result was
  captured — the on-chain txs are the permanent record, not the harness.
- Tooling gotcha found along the way (D25): SpaceBudz Lucid's
  `utxosByOutRef()` is spend-status-blind (queries a Blockfrost endpoint that
  ignores spend state) — never use it to detect a fill; use `utxosAt` instead.
  Directly relevant to the future `chain/indexer`.

### Validator

- Vault validator sketch: Deposit / Withdraw / Compound paths per D1/D2 invariants
- Rescue redeemer added for stray UTxOs — treasury-signed, reachable only when the
  datum is missing or fails to cast to `VaultDatum` (D10)
- Design settled (D11–D14): one validator per DEX with pool bound in datum; slippage
  split into on-chain floor parameter + adaptive executor tolerance (dropped from
  datum); fees accrue per-vault in LP units (`fee_owed`), settle only on withdraw;
  v1 is full-withdraw-only, v2 adds treasury Collect redeemer

### Executor

- Toolchain settled: @minswap/sdk + @spacebudz/lucid v0.20 via JSR registry —
  replaces Lucid Evolution (D7)
- Smoke test verifies .env.local + Blockfrost preprod + Lucid + executor wallet;
  both project wallets faucet-funded
- Service skeleton stubbed: indexer, trigger, compound_batch, scheduler, adapters

### DEX target research

- Minswap V2 farming confirmed GATED for auto-compounding (D6): script addresses
  can't own farm positions + every farm spend needs Minswap's hardcoded admin co-sign
  (390+ mainnet spends verified) — workable only via a co-sign API or platform
  collaboration (Discord answer pending). Deployed farm script decoded, vendored at
  `reference/farm-onchain/`.
- Five-DEX pivot survey (D15): SundaeSwap (off-chain team-computed rewards) and Danogo
  (no LP farm) ruled out; Splash not live; **WingRiders is the leading candidate**.
- WingRiders V2 deep-dive (D16): open-source contracts read + Shares Lock farm-lock
  decoded + confirmed on mainnet (Blockfrost). Farm positions are pubkey-owned (script
  can't own — like Minswap), WRT rewards are pushed into position UTXOs by WingRiders'
  agent, owner-reclaim is owner-signed with no admin co-sign. ⇒ executor-keyed farm layer
  required but VIABLE (works where Minswap's didn't); custody-mitigated, not sovereign.
  Artifacts at `reference/wingriders-onchain/` and `reference/dex-survey/`. Revises D8.
- Fallback product option (D17): cross-DEX LP position router. Verified Minswap AMM
  order path (`reference/minswap-amm/`) is non-custodial/un-gated (licensed-batcher
  liveness dependency, script owners can cancel) — same as WingRiders. Fully automatable
  because it avoids farms entirely; fee-yield only (non-custodial), farm APR optional.
- Competitive landscape re-verified (D17 addendum): cross-DEX LP routing/management
  field confirmed EMPTY on Cardano as of 2026-07 — nothing live, nothing on testnet.
  New finding: MuesliSwap's F14 "Liquidity Hub" (same concept) was rejected by Catalyst
  voters, as were two similar proposals — concept validated by established teams, but
  never market-tested; committee should expect the "why did others fail" question.

### Pooled vault pivot — D20 (2026-07-18)

- **Per-user vaults abandoned (supersedes D1):** research showed the farm layer is
  necessarily a pooled executor-keyed position (Minswap: one position per owner per
  pool), the custody story is identical either way, and the per-user design had grown
  to contain share math PLUS a state machine. New design: one pooled vault per pool,
  fungible share tokens, datum-tracked exchange rate, order-based deposits/redemptions,
  fee as treasury share mint at compound (kills the fee_owed ledger — D13/D14
  superseded). D3 trigger restated pool-level. Phase 1 re-scoped: pooled NIGHT/ADA
  vault on Minswap, pitch-day demo, build from 2026-08-17.
- **Five non-negotiable invariants (D20-N)** documented in decisions.md, CLAUDE.md, and
  the vault.ak header: N1 datum-truth accounting, N2 dead shares, N3 house-favored
  rounding, N4 owner-cancellable orders only, N5 custody honesty. Each requires a named
  validator check + matching test.
- vault.ak rewritten as the pooled-design sketch with the N-invariants as its header.

### Minswap resolution (2026-07-18)

- Minswap answered all four integration questions (doc vendored at
  `reference/farm-docs/minswap-farm.md`, GraphQL endpoint + mutations verified live):
  official co-sign API for farm spends, trustless owner-only emergency withdraw
  (constructor 3 — corroborates our decode's untraced branch), script positions
  confirmed unsupported, composability welcomed. **Auto-compounding on Minswap is
  viable** via executor-keyed positions (D19); D8's Minswap Phase-1 target restored.
  Minswap-vs-WingRiders is now a product choice, not a technical gate.

### Executor security posture (2026-07-18)

- Universal signing gate (D19 addendum): the "never blind-sign server-built CBOR" rule
  generalized beyond the Minswap API to ALL unaudited builders in the signing path
  (@minswap/sdk, Lucid, npm/JSR tree). Nothing is signed unless an independent verifier
  re-parses the raw CBOR and checks it against pre-stated intent; fail closed. Blast
  radius stays confined to the executor-custody (Tier-3) zone — user vault funds remain
  protected on-chain regardless.
- Dependency pinning: all executor direct deps pinned to exact versions (dropped
  `latest`/`^`); `npm ci` (not `install`) is now the documented install for the
  key-holding service.

### Validator design — executor-keyed variant

- D18: systematic invariant redesign for the executor-keyed WingRiders variant. Vault
  becomes a claim state machine (Idle → Entering → Farming → WithdrawRequested);
  Compound redeemer dies (cycle never touches vaults), replaced by Enter / Reconcile /
  Settle; D2's "executor cannot extract" is explicitly superseded for farmed value
  (mitigation: MPC key + capped capital + public proof-of-reserves monitor). Fee
  computed once at Settle in LP units — `fee_bps × (LP_returned − LP_principal)` —
  which isolates compounded emissions exactly (in-pool trading-fee appreciation rides
  untaxed). New Reconcile mechanism reads actual LP principal from the farm position
  as a reference input; depends on stake-credential tagging (top dust-test priority).

### Docs & tooling

- CLAUDE.md created; /commit and /update-brain skills ported from fum_project

### Deposit & redeem workflows designed — D21/D22 + redeem path (2026-07-18/19)

- **N6 thread-NFT authenticity** joins D20-N (six invariants now): a one-of-one state
  NFT minted at init identifies THE vault UTXO; validator and share-mint policy key on
  the NFT, never the address — kills counterfeit-vault share minting. Test `n6_`.
- **D21 deposit path:** any mix of {pool asset A, pool asset B, LP} in one signature —
  asset leg rides a Minswap DEPOSIT order whose `successReceiver` is our order
  validator (delivery + exact inline datum on-chain-enforced, verified from Minswap
  source: `reference/minswap-amm/order_validation.ak`). Addenda: canceller/payout
  split, ONE order validator for all pools (`pool_nft` in datum), order-validator
  Rescue, harvest-priority sequencing, value-derived amounts + pass-through payout.
- **D22 off-chain structure:** DEX-specific tx construction behind adapter interfaces
  with the CBOR verifier OUTSIDE the adapter boundary; `shared/` workspace package for
  datum codecs / floor-rounding rate math / config; CIP-57 blueprint (`plutus.json`)
  as the validators↔TS bridge — addresses and schemas derived, never hand-copied.
- **Validator: `ExitFarm` redeemer added** (D20 addendum 2026-07-19) — EnterFarm's
  mirror; closes the farm-custody one-way valve that made buffer-miss redemptions
  unservable. Named check `solvency` (`0 <= farmed_lp <= total_lp`). Deliberate
  absences recorded: no wind-down path, no migrate redeemer.
- **Uniform pre-batch rate adopted** (D20 addendum 2026-07-19): every order in an
  ApplyOrders batch — mixed deposit+redeem included — prices at the input datum's
  totals; net-sum updates. Safe by rate-neutrality + the double-floor round trip.
- **Redeem path designed** (redeem.md): shares redeem recorded yield only (pending
  emissions forfeited to the pool — N1); v1 pays LP out with optional user-signed
  convert; unfarmed `BUFFER_PCT` buffer + three-tier Minswap-dependency honesty
  (buffer-covered / co-sign API / emergency-withdraw escalation policy).
- **Docs:** workflow suite grew — redeem.md, value-flow.md (UTXO/value trace study
  guide), emergency-withdraw.md + vault-init.md stubs; docs/v2-ideas.md parking lot
  created (chained exit, zap deposits, WingRiders venue #2, CIP-26, permissionless
  init).

### Vault ↔ farm boundary designed — enter-exit-farm (2026-07-23)

- **Two-hop finding:** the co-sign API builds server-side and spends only *owner*
  UTxOs (`inputsToChoose`) — a vault script input can't ride along, so every
  vault↔farm crossing is TWO txs with the executor address as midpoint
  (EnterFarm → API stake; API withdraw → ExitFarm). The in-flight custody window
  is Tier-3, capped by `MAX_INFLIGHT_LP`, one crossing per pool at a time.
  ⚠️ inferred from schema; dust-cycle item (e) confirms.
- **`farmed_lp` semantics refined:** "LP outside the vault under executor
  farm-custody" (farm position + in-flight) — the ledger moves at the VAULT
  boundary, keeping vault-held == total_lp − farmed_lp exact and giving
  proof-of-reserves its reconciliation target.
- **Vault-spend precedence order** (D21 addendum): serialization is physical (one
  vault spend per tx, chained); queue order is RecordHarvest → ExitFarm + the
  batch it unblocks → other ApplyOrders → EnterFarm, with the
  enter-counts-pending-redeems corollary.
- **Policies resolved:** buffer-restore = wait-for-deposits (adaptive management
  parked in v2-ideas); first-stake = lazy with a permanent position-existence
  predicate (withdraw-all/emergency destroy the position; no farm duty at init;
  no first-depositor exposure — the farm has no share ratio and adds are
  owner+Minswap-gated); emergency policy = return-to-vault unconditional,
  re-stake per-reason (aftermath table in the stub).
- **Dust-cycle checklist consolidated:** week1-verify's D19 item is now the single
  mainnet dust-cycle question list (a–g) — API cycle incl. partial withdraw and
  position-destroy/recreate, verifier exercise, pending-rewards readability,
  two-hop confirmation, position-as-reference-input, cost measurements.

### Rescue workflow designed (2026-07-23)

- rescue.md consolidates D10 + the order-validator addendum into one contract:
  cast-failure as the non-widenable security boundary (anything that casts is
  never treasury-reachable), the four stray classes (hash-datum strays are
  unspendable at the protocol level, not ours to fix; castable garbage incl.
  counterfeit vaults = permanently stuck, accepted), detection via the same
  `shared/` codec cast the validator performs, and rescue txs living entirely
  outside the vault-spend precedence queue (the vault can't be an input — it
  casts).
- **New policy — return on claim:** rescued value held at treasury; best-effort
  manual return on a two-part proof (funding tx identifies the key; fresh CIP-8
  `signData` challenge proves present control). Exchange-withdrawal and
  script-sender holes documented. **Flat handling fee + network costs**,
  deducted, published in advance; verified claims process independent of the
  sweep cadence. Discretionary, never promised (N5).
- Treasury identity clarified: the cold high-privilege key (fee shares, Rescue,
  emergency authorization, CIP-68 ref NFT) — never the executor hot key; its
  form (single/multisig/threshold) added to vault-init's key-encoding cluster.

### Emergency withdraw designed (2026-07-23)

- emergency-withdraw.md graduated stub → full workflow. **Self-built variant
  only** — the API variant (`buildEmergencyWithdrawV2`) depends on the
  counterparty the path exists to escape; we engineer, dust-test, and shelve
  the owner-only build (constructor 3, own collateral).
- Unifying trigger condition: **co-sign unavailable, untrusted, or refused** —
  a healthy-API venue wind-down uses the normal harvest + withdraw-all path,
  forfeiting nothing; emergency is never the preferred exit.
- Forfeiture documented as structural: pending emissions live in
  Minswap-controlled reward reserves (harvest spends THEIR funds, hence their
  co-sign); owner-only exit touches only our staked value — which is exactly
  what makes it trustless. No vault ledger entry needed (emissions never
  landed — N1); dust-cycle item (b) extended to observe this.
- Implementation constraint: `MAX_INFLIGHT_LP` gates *initiating routine
  crossings* only — the emergency ExitFarm blows through it by nature and must
  not be blocked by our own guardrail.
- v1 authorization: human/treasury per runbook (runbook itself = open point,
  written with the vault-init treasury-form decision). Dead-man's-switch
  automation parked in v2-ideas.

### Proof of reserves designed (2026-07-23)

- proof-of-reserves.md: the D18/N5 public custody monitor — read-only,
  stateless, anyone-can-run (open source + public chain data; our dashboard is
  a convenience, the verifiability is the product). Six checks: locate-by-NFT,
  internal value conservation, the headline custody reconciliation
  (`farmed_lp == farm position + executor-address in-flight`), share supply vs
  mint history, rate monotonicity, pending rewards (informational).
- Tolerance design: C3 alone gets a nonzero tolerance, two-dimensional
  (magnitude × duration — routine crossings pass, small-but-persistent leaks
  alarm); everything else zero-tolerance CRITICAL. **No alarm-suppression
  mode** — an emergency withdraw alarms and the incident notice explains it; a
  monitor its operator can mute is worth less (N5). STALE ≠ green. Tier-2
  framing mandatory: detection, never prevention.
- Surfaced the harvest fee-mint bound `t ≤ floor(ΔLP·S/L)` (the
  rate-non-decrease line; C5 is the live alarm behind it) — now enforced in
  the D23 absorb branch. Deployment lean: standalone, not inside the executor
  (the watcher shouldn't share the watched thing's fate).

### D23 — compound via harvest absorb (2026-07-23/24)

- compound-cycle.md drafted (last workflow doc except vault-init). The cycle's
  add-liq order delivers to OUR order validator as a **`HarvestDeposit`** fill;
  ApplyOrders absorbs it: value-derived ΔLP (the fill is the witness — the
  "RecordHarvest lying" enforcement question dissolves), treasury-fee-only mint,
  LP lands unfarmed (replenishes the buffer), EnterFarm skims later.
  **RecordHarvest demoted to alternate shape**; the vault redeemer set shrinks
  by one if the batcher dust test passes.
- The one bit — does the licensed batcher fill third-party-script receivers —
  now decides THREE things: deposit UX, compound shape, final redeemer set.
  **RUN FIRST** (user directive: before code layout). Degraded world = pivot,
  not death (two-step deposits; RecordHarvest compound).
- Swap topology: ONE swap MIN→ADA + single-sided add-liq; topology is
  adapter-level (D22). Chained fills + swap-target evaluation → v2-ideas.
- Review resolutions: harvest-priority hold window is shape-independent (D23
  cost miscount corrected in-entry); swap failure = kill-and-requote loop,
  price drift = yield variance, no hedging v1+ (risk-profile inversion);
  `min_out` ignored in HarvestDeposit (setter == outcome-producer — tautology);
  hold-window config = baseline-then-tune.

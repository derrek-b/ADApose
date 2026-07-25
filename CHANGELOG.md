# Changelog

Session-level history, maintained by `/update-brain`. Root-level single file while
components share one repo lifecycle; split per-component if they diverge.

## [Unreleased]

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

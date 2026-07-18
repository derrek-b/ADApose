# Changelog

Session-level history, maintained by `/update-brain`. Root-level single file while
components share one repo lifecycle; split per-component if they diverge.

## [Unreleased]

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

### Minswap resolution (2026-07-18)

- Minswap answered all four integration questions (doc vendored at
  `reference/farm-docs/minswap-farm.md`, GraphQL endpoint + mutations verified live):
  official co-sign API for farm spends, trustless owner-only emergency withdraw
  (constructor 3 — corroborates our decode's untraced branch), script positions
  confirmed unsupported, composability welcomed. **Auto-compounding on Minswap is
  viable** via executor-keyed positions (D19); D8's Minswap Phase-1 target restored.
  Minswap-vs-WingRiders is now a product choice, not a technical gate.

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

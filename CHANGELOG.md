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

- Minswap V2 farming confirmed unusable for auto-compounding (D6): script addresses
  can't own farm positions + every farm spend needs Minswap's hardcoded admin co-sign
  (390+ mainnet spends verified). Deployed farm script decoded, vendored at
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

### Docs & tooling

- CLAUDE.md created; /commit and /update-brain skills ported from fum_project

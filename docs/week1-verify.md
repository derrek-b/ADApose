# Week 1 Verify List

Every assumption the design record leans on that hasn't been proven against a real
chain yet. Each item cites its decision entry. Check off with date + result; if a
result contradicts the assumption, write the superseding D-entry.

## Architecture-deciding (do first — outcomes change the design)

- [x] ~~**D16 · WingRiders custody model (the go/no-go):**~~ **RESOLVED 2026-07-17**
      (Blockfrost mainnet): farm positions record PUBKEY owners; owner-reclaim tx
      `49bc84d7…` signed by exactly the datum owner pkh (`f873a0f88d…`), no authority
      token, no WingRiders co-sign. Rewards are PUSHED into position UTXOs by WingRiders'
      agent (operational pubkey `addr1q8lj38m…`, token "A"). ⇒ script can't own positions;
      executor-keyed farm layer required, and it WORKS (owner-signed reclaim, no admin
      gate). Custody-mitigated. See D16 confirmed section + `reference/wingriders-onchain/`.
- [x] ~~**D16 · WingRiders current farm model:**~~ **CONFIRMED live** — Shares Lock
      (`0237cc31…` / `addr1wypr0np3…`) actively processed at block 13.67M (agent adding
      WRT to 8–30 positions per batch, continuously). It is the current mechanism.
- [ ] **D16 · Executor-keyed flow mechanics** (from the compounder design pass,
      2026-07-17): (a) can a WR AddLiquidity request deliver LP *directly into* a
      Shares Lock position via `compensationDatum` (beneficiary = SL address), and does
      WingRiders' reward agent pick up externally-created positions? Dust test.
      (b) does the SL owner check ignore the owner address's STAKE credential, leaving
      it usable as an on-chain vault↔position tag? **PROMOTED to load-bearing by D18:
      the Reconcile-via-reference-input mechanism (on-chain principal integrity) depends
      on it — if tagging fails, principal_lp degrades to executor-attested. Run this
      dust test FIRST.** (c) confirm reward pushes continue
      to positions whose payment cred is a previously-unseen pubkey (no allowlist).
- [ ] **D17 · LP-router fallback data layer:** if pivoting to the cross-DEX LP router,
      need a reliable cross-DEX APR/TVL feed to drive placement + profitability-gated
      migration. Scope the indexer/oracle. (Minswap + WingRiders AMM order paths already
      verified non-custodial — D17.)

- [x] ~~**D6 · Farm spike:** can a script address own a Minswap farm position?~~
      **RESOLVED 2026-07-16 — NO** (UPLC decode of deployed script, see D6 addendum +
      `reference/farm-onchain/`): owner auth is txSignedBy(pkh) only, ScriptCredential
      owners fail; positions would be creatable but unspendable. No preprod farm
      deployment exists. No spike needed.
- [x] ~~**D6 · Harvest automation (the successor question)**~~ **RESOLVED 2026-07-18
      (D19):** (a) Minswap DOES offer a co-sign API — official GraphQL integration path,
      mutations verified live by field-probing; composability explicitly welcomed.
      (b) owner-unilateral exit CONFIRMED — `EMERGENCY_WITHDRAW` = constructor 3,
      owner-sig-only, buildable trustlessly (matches our untraced decode branch).
      Auto-compounding on Minswap is viable via executor-keyed positions.
      See `reference/farm-docs/minswap-farm.md` + D19.
- [ ] **D19 · Minswap integration verification:** (a) provision farm key-API access
      with Minswap (they offered — reach out); (b) dust-test emergency withdraw
      (constructor 3, owner-only-signed, self-built) on mainnet — the one claim still
      resting on their word + our decode rather than an executed tx; (c) exercise one
      full API cycle with dust (first-deposit → harvest → stake-more → withdraw-all)
      and build the **CBOR verifier** (never blind-sign server-built txs — check
      rewards→owner, restake amounts, no value leakage, expected signers).
- [ ] **D13 · ΔLP visibility across the two-tx batcher flow:** the compound tx
      creates *order* UTXOs; the LP tokens arrive later, when Minswap's batcher
      fills the deposit order and pays the receiver. So how does the vault validator
      enforce `fee_owed += fee_bps × ΔLP` if ΔLP isn't known at compound-tx time?
      Verify how a filled order pays out: Minswap orders support a receiver +
      receiver-datum (spec §order) — confirm the fill can recreate the vault UTXO
      at the script address with the updated datum, and decide where the accrual
      check actually runs (at order creation with min-receive as the ΔLP lower
      bound, at fill time, or split). **This is the least-validated link in the
      whole invariant chain — the current vault.ak sketch hand-waves it.**

## Invariant plumbing (needed before the validator is real)

- [ ] **D12 · Pool datum parse:** read a live preprod Minswap V2 pool UTXO as a
      reference input; parse reserves from its datum (shape per vendored SDK);
      compute spot price for the slippage-floor check.
- [ ] **D12 · Order min-receive introspection:** confirm the vault validator can
      read the swap order's min-receive from the order output's datum to check
      `min_receive ≥ (1 − floor) × spot`.

## Cost model (D4 — estimates → measurements)

- [ ] **Marginal cost per vault per cycle:** currently 0.1–0.3 ADA derived; measure
      actual bytes + exunits on preprod with a real batch tx. Deterministic.
- [ ] **Vaults per batch tx:** currently ~20–30 from the 16KB / 14M mem / 10B steps
      envelope; confirm with a real multi-vault spend.
- [ ] **Farm harvest net cost:** ~0.5 ADA net per harvest (2 attached, ~1.5 back) —
      verified from docs (D4), confirm on preprod during the D6 spike.

## Toolchain

- [ ] **D7 · Yaci DevKit:** UNVERIFIED — check current state; decide emulator vs
      Yaci vs preprod-only for the dev loop.
- [ ] **D7 · Lucid emulator:** confirm @spacebudz/lucid v0.20 emulator works for
      validator round-trip tests before reaching for a devnet.

## Already verified (for the record)

- [x] Toolchain local: aiken v1.1.23, `aiken check` clean on plutus v3 + stdlib v2
      (D7, 2026-07-16)
- [x] Executor stack: .env.local + Blockfrost preprod + Lucid + executor wallet;
      both wallets faucet-funded (2026-07-16)
- [x] Minswap batcher fee 2 ADA flat (D4 — from vendored SDK source)

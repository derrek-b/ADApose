# Week 1 Verify List

Every assumption the design record leans on that hasn't been proven against a real
chain yet. Each item cites its decision entry. Check off with date + result; if a
result contradicts the assumption, write the superseding D-entry.

## Architecture-deciding (do first — outcomes change the design)

- [ ] **D20-N · Non-negotiable invariant test suite** (pooled design's standing price —
      each must be a named validator check + matching test before any mainnet dust):
      `n1_` datum-truth (exchange rate immune to donated/stray UTxOs), `n2_` dead-shares
      (first-depositor inflation attack fails in emulator), `n3_` rounding property
      tests (mint rounds shares down / redeem rounds assets down, remainder stays —
      fuzz across amounts incl. 1-lovelace edges), `n4_` order cancel always succeeds
      owner-signed + ApplyOrders cannot cherry-pick/skip/reorder to a user's detriment,
      `n6_` a counterfeit vault UTXO at our own validator address (doctored datum, no
      thread NFT) cannot trigger a share mint. (N5 is a comms invariant — no test.)
- [ ] **D20 · Share-token UX check:** DECIDED 2026-07-18 — metadata via **CIP-68 baked
      into vault init** (share token named with CIP-67 `(333)` label; init mints the
      paired `(100)` reference NFT with metadata datum — name is frozen at first mint,
      so this can't be retrofitted). Verify on preprod: Eternl (and Lace if possible)
      actually renders the CIP-68 name/ticker/decimals for a `(333)` token. CIP-26
      registry PR = optional mainnet polish; wallet support for the *testnet* registry
      is spotty and script-policy attestation there is unverified.
- [x] ~~**D21/D23 · Batcher fill policy for script receivers**~~ **RESOLVED
      2026-07-25 — YES, see D24.** On-chain, a fill MUST deliver LP + our exact
      inline datum to our order validator (verified from source 2026-07-18 —
      `reference/minswap-amm/order_validation.ak:1196`); the unproven bit was
      whether the licensed batcher *operationally* fills orders whose
      `successReceiver` is a third-party script. Preprod attempt (2026-07-24/25,
      control + probe orders) sat unfilled 20+ hours — inconclusive (MinTeam
      confirmed preprod batcher reliability isn't guaranteed). Escalated to a
      real mainnet probe: a DEPOSIT order with `successReceiver` = a throwaway
      owner-gated script filled in ~90 seconds, datum match confirmed exact.
      **All three things this bit decided (D23) are settled:** deposit UX stays
      D21's chained one-signature path; compound shape stays D23's HarvestDeposit
      absorb; `RecordHarvest` is DELETED (not kept as alternate) at vault-init.
      Full evidence + tx hashes in D24. Test spikes deleted after the result was
      captured — the on-chain txs are the permanent record.

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
- [ ] **D16 · WingRiders-only mechanics (DEPRIORITIZED by D20 — Phase 1 is Minswap):**
      stake-cred tagging / direct-to-lock / unknown-pubkey reward pushes only matter
      if/when WingRiders becomes venue #2. Park until then.
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
- [ ] **D19 · THE MAINNET FARM DUST CYCLE — consolidated question list.** One session,
      real ADA dust, executor-keyed (no preprod farm exists). Every farm-related ⚠️
      resolves here; other week1-verify items that measure during this cycle point at
      this list. Prereq: (a) provision farm key-API access with Minswap (they
      offered — reach out). Then, in rough execution order:
      - [ ] (b) **emergency withdraw, self-built** (constructor 3, owner-only-signed,
            own collateral) — the one claim still resting on their word + our decode
            rather than an executed tx. Also observe the returned value: staked LP
            (+ functional NFTs) only, pending rewards forfeited — confirming the
            emergency path needs NO vault ledger entry (emissions never landed;
            N1 — emergency-withdraw.md).
      - [ ] (c) **full API cycle**: first-deposit → stake-more → harvest → partial
            withdraw (remaining > 0 rule observed in practice) → withdraw-all →
            first-deposit again (position-destroyed → existence predicate flips,
            enter-exit-farm.md ENTER step 2); build + exercise the **CBOR verifier**
            against every API-built tx (rewards→owner, amounts exact, no value
            leakage, expected signers = owner + Minswap keys — the D19 gate).
      - [ ] (d) **pending-rewards readability**: can accrued-unharvested rewards be
            read (chain data or API) precisely enough to drive the compound trigger,
            the web's dynamic tolerance floor, and the trigger-imminent warning
            (deposit.md Step A/C)?
      - [ ] (e) **two-hop confirmation** (enter-exit-farm.md): API-built farm txs
            spend only owner UTxOs per the schema — verify a vault script input
            CANNOT ride along (if it can, the single-tx crossing supersedes the
            two-hop design).
      - [ ] (f) **position as reference input** — the "referenceable +
            parseable in one vault spend" half is MOOT (RecordHarvest deleted,
            D24). Keep only the **signers observation**: confirm required
            signers on a farm stake are exactly {owner, Minswap keys}, no
            donation path — feeds proof-of-reserves' C3 custody-honesty
            reasoning regardless of redeemer shape.
      - [ ] (g) **cost measurements** (cost-model section below): fees per API tx,
            harvest net cost (~0.5 ADA claimed), full-cycle total (~5–7 ADA
            assumed) — these numbers size `MIN_ENTER_CHUNK` / `MAX_INFLIGHT_LP`
            (enter-exit-farm.md Open point 4) and validate the D3 trigger threshold.
      - [x] ~~(h) **batcher receiver-policy probe**~~ **RESOLVED 2026-07-25,
            ahead of the rest of this list** — ran standalone, didn't end up
            needing prereq (a) or bundling with the farm cycle after all (only
            needed a funded mainnet wallet, not farm API access). See D24 for
            the full result.
- [x] ~~**D13 ΔLP visibility → D20 · RecordHarvest enforcement**~~ **MOOT —
      2026-07-25.** RecordHarvest is deleted, not merely demoted (D24); the
      "what stops RecordHarvest from lying about ΔLP" question and its
      reference-input proposal no longer apply. Dust-cycle item (f) above is
      moot for the same reason (kept there only as the signers-observation
      value, unrelated to this).

## Invariant plumbing (needed before the validator is real)

- [ ] **D12 · Pool datum parse:** read a live preprod Minswap V2 pool UTXO as a
      reference input; parse reserves from its datum (shape per vendored SDK);
      compute spot price for the slippage-floor check.
- [ ] **D12 · Order min-receive introspection:** confirm the vault validator can
      read the swap order's min-receive from the order output's datum to check
      `min_receive ≥ (1 − floor) × spot`.

## Cost model (D4 — estimates → measurements)

(Recast for D20: compound cost is now per-POOL per cycle — vault touches happen only
at ApplyOrders/RecordHarvest — and per-user cost is per-ORDER in a batch.)

- [ ] **Cycle cost per pool:** D20 assumes ~5–7 ADA (API harvest tx + swap order +
      add-liq order + stake tx + batcher fees + RecordHarvest). Measure for real with
      dust once API access lands. → executes as dust-cycle item (g) above.
- [ ] **Orders per ApplyOrders batch:** how many deposit/redeem orders fit in one
      vault spend under 16KB / 14M mem / 10B steps? (Replaces the old ~20–30
      vaults-per-tx estimate.)
- [ ] **Farm harvest net cost:** ~0.5 ADA net per harvest (2 attached, ~1.5 back) —
      verified from docs (D4); confirm during the D19 dust cycle (mainnet — no preprod
      farm exists).

## Toolchain

- [ ] **D7 · Yaci DevKit:** UNVERIFIED — check current state; decide emulator vs
      Yaci vs preprod-only for the dev loop.
- [x] ~~**D7 · Lucid emulator:** confirm @spacebudz/lucid v0.20 emulator works for
      validator round-trip tests before reaching for a devnet.~~ **CONFIRMED
      2026-07-25** — exercised with a real compiled PlutusV3 script (a disposable
      owner-gated spike validator, since deleted along with the rest of the
      batcher dust-test harness, D24): funded and spent entirely in-memory.
      Attacker spend (no owner signature) correctly rejected (script crashed);
      owner spend (signature declared via `addSigner`) correctly succeeded.
      Round-trip works; safe to lean on for real validator dev going forward.

## Already verified (for the record)

- [x] Toolchain local: aiken v1.1.23, `aiken check` clean on plutus v3 + stdlib v2
      (D7, 2026-07-16)
- [x] Executor stack: .env.local + Blockfrost preprod + Lucid + executor wallet;
      both wallets faucet-funded (2026-07-16)
- [x] Minswap batcher fee 2 ADA flat (D4 — from vendored SDK source)

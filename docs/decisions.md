# Design Decisions & Findings

Running log — date each entry. Sources in `../reference/` where vendored.

---

## D1 · ~~Per-user vault UTXOs~~ — SUPERSEDED by D20 (2026-07-18) — 2026-07

Each user = one UTXO at the vault script address, owner pubkey in datum.

- eUTxO-native: no shared-state contention between users; users transact independently
- Smallest audit surface + strongest non-custodial story for an unaudited launch
- Shared share-token vault (Beefy mooToken model) = known scaling path at ~1000s of
  small users; inherits Minswap-style batcher pattern + ERC-4626-class share-math risks.
  Deferred until audit budget exists.
- Withdrawal path requires ONLY the owner's signature — funds never executor-dependent.

## D2 · Validator invariants — 2026-07

**Compound path (executor-signed):** (1) executor authorized; (2) new vault UTXO at same
script address; (3) value conservation — position only grows, minus enforced fee;
(4) datum integrity — owner/pool/bounds immutable, only timestamps + accounting mutate;
(5) slippage bound + fee split (4.5% → treasury) enforced on-chain.

**Withdraw path (owner-signed):** (1) owner signature matches datum; (2) assets flow to
owner (or remainder returns with datum integrity).

Asymmetry is the security model: owner path proves identity, executor path constrains
everything (assumed compromisable). Compromised executor key ⇒ can grief cadence, cannot
extract funds.

## D3 · Trigger rule — profitability as invariant — 2026-07

> Compound a vault only when accrued fee-share ≥ k × marginal cost (k=2).

- Rounds/yr = annual fee ÷ (k·m) ⇒ annual marginal cost = revenue/k. **Margin floor = 50%
  at any vault size / user count / APR.** Floor is k-tunable (k=3 ⇒ 67%).
- Weekly cap for large vaults ⇒ costs freeze (~15.6 ADA/yr) while revenue scales:
  margin → 60% @10K ADA, 87% @30K, 96% @100K.
- Weekly crossover AUM = k·m·52 ÷ (fee% × APR).

## D4 · Cost model constants — 2026-07 (re-verify in Week 1)

| Constant | Value | Status |
|---|---|---|
| Minswap V2 batcher fee | 2 ADA flat / order, all order types | VERIFIED — `reference/sdk/src/batcher-fee/configs.internal.ts` |
| Fixed cost / pool / compound round | ~5 ADA (2 orders + own txs) | derived |
| Marginal / vault / cycle (aggregated farm) | 0.1–0.3 ADA | estimate — bytes + exunits |
| Marginal / vault / cycle (per-user farm positions) | ~0.7–1.0 ADA | estimate — adds ~0.5 net farm harvest fee + farm exec (see D6) |
| Farm harvest mechanics | 2 ADA attached, ~1.5 returned ⇒ ~0.5 net per harvest | VERIFIED — `reference/farm-docs/yield-farming-mechanics.md` |
| Tx limits | 16KB, 14M mem / 10B steps ⇒ ~20–30 vaults/batch tx | verified protocol params |
| Cardano fee formula | 0.155 ADA + 0.000044/byte + exunit pricing | verified |

## D5 · Minswap V2 facts that shape the build — 2026-07

- **Constant product only** (x*y=k) — NO concentrated liquidity. CL is vision/roadmap,
  no shipped spec, no repo, no date. (`reference/amm-v2-specs.md`)
- **Batcher architecture**: user actions = order UTXOs; whitelisted batcher applies them.
  Orders support script owners: "Script Owner Representation (in case Owner is a Smart
  Contract)" — spec §order cancellation.
- **Imbalanced deposits are native** — pool internally swaps to balance any A:B ratio
  (`reference/formula.md` §3 Deposit). Single-sided zap-in = one deposit order, no
  separate swap. (Compound cycle still needs MIN→asset swap order — MIN not in pair.)
- **Fee sharing**: pools may divert 1/6–1/2 of trading fee to protocol treasury; LP share
  auto-compounds in-pool. Minswap skims LPs harder than our 4.5%-of-emissions.
- **SDK coverage**: all DEX order types, `createBulkOrdersTx` (multi-order single tx —
  our batch pattern is first-class), calc helpers incl. `calculateZapIn`,
  Blockfrost/Maestro adapters, expired-order monitor. Vendored at
  `reference/sdk` (commit in `VENDORED_COMMIT`).

## D6 · OPEN — farm integration (the one real unknown) — 2026-07

The Yield Farming contract source is **not published** (searched all 51 minswap org
repos); SDK has zero farm modules. Behavior documented in `reference/farm-docs/`:
per-second accrual, harvest-anytime, deposit/withdraw auto-harvests, LPTs locked in
staking contract, owner-only withdrawal.

**Open question:** can a script address own a farm position?
- Asked in Minswap Discord (2026-07-16) — awaiting answer
- Method 1: decode a live farm position's datum (owner = full Credential vs raw
  PubKeyHash?)
- Method 3: preprod round-trip from a throwaway validator — Week 1 spike, definitive

**2026-07-16 re-check:** still no source in the minswap GitHub org (all repos listed;
`minswap-dex-v2` holds only DEX validators). BUT `minswap/cardano-contracts-registry`
→ `projects/minswap.json` publishes the deployed farm script HASHES (CertiK-audited):
- Staking Contract v1 (Plutus V1): `9b85d5e8611945505f078aeededcbed1d6ca11053f61e3f9d999fe44`
- Harvest Contract v1 (Plutus V1): `98df3b00a1500fcb77daa0520550fb088fc923399788b89637b9de59`
- Staking Contract v2 (Plutus V2): `b15a1a010843e8afb6f963b03d452be815b533dad0cd23d819c2d201`
  (plus MIN/MINt staking + vesting — token staking, not LP farming)
This makes Method 1 concretely executable: query the v2 staking script address via
Blockfrost, decode live position datums for the owner field's shape. On-chain script
CBOR is also fetchable by hash (deployed UPLC, not source — behavior ground truth).

**2026-07-16 Method 1 EXECUTED** (Koios mainnet, read-only; v2 Staking Contract at
`addr1wxc45xspppp73takl93mq029905ptdfnmtgv6g7cr8pdyqgvks3s8`):
- Position datum shape: `Constr 0 [owner_address, staked_asset_class, Int, [(asset, Int)]]`
  where `owner_address` is a FULL Plutus `Address` (Credential + Option<StakeCredential>),
  NOT a raw PubKeyHash. Datums are BY HASH, not inline. Contract active (positions
  created this week).
- **Structural answer: YES-shaped** — `ScriptCredential` (Constr 1) is representable in
  the owner field; the type doesn't preclude script ownership. Consistent with the
  order contract's "Script Owner Representation" (D5).
- **Empirical answer: nobody does it** — scanned 2,000 live positions (oldest 1,000 +
  newest 1,000 of the UTXO set): 2,000 pubkey owners, 0 script owners.
- **What Method 1 CANNOT tell us:** whether the withdraw/harvest path AUTHORIZES a
  script owner (an "owner script spent in same tx" branch like the DEX orders) or only
  checks tx signatories — in which case a script-owned position is CREATABLE but the
  LP is PERMANENTLY STUCK (scripts can't sign). The datum being write-anything makes
  creation proof-free; only spending proves the design. Method 3 (preprod round-trip,
  dust amounts, full deposit→harvest→withdraw cycle BEFORE any design commitment)
  remains the decisive test. Prerequisite: confirm the farm v2 contract is deployed
  on preprod and find its address.

**2026-07-16 RESOLVED via UPLC decode — answer is NO, plus a bigger finding.**
No preprod deployment exists (checked: zero UTXOs ever at v1/v2 staking credentials on
preprod; mainnet control query confirms method). So we fetched the deployed mainnet v2
staking script (2,890 bytes, plutonomy-optimized PlutusTx) and reverse-engineered the
UPLC (artifacts vendored at `reference/farm-onchain/` — raw CBOR, UPLC, pseudocode + helper map):
- **Owner auth = txSignedBy(owner_pkh) ONLY.** The owner-credential extraction has two
  branches: PubKeyCredential → pkh used for signatory check; ScriptCredential → fails
  (no alternative "owner script spent in same tx" path anywhere in the script; the only
  address-equality logic is used for own-input/position matching, not auth).
  ⇒ **script-owned positions are CREATABLE but PERMANENTLY UNSPENDABLE.** Preferred
  design (script-owned aggregate farm position) is DEAD. HIGH confidence (structural).
- **Every farm spend ALSO requires a hardcoded Minswap admin key:**
  `7fe3920105a0aebaaecc1b935cd5ebbd3cc8c28336449d27378825e1` is a compiled-in constant
  (script binding i_68 = "admin ∈ tx signatories"; i_69 = "owner pkh ∈ signatories").
  **Empirically confirmed at scale (2026-07-17):** 390+ distinct mainnet spend txs
  classified by redeemer tag → 100% carry the admin key in required_signers. Breakdown
  of single-tag txs: Constr 0 (n=42+), Constr 1 (n=80+), Constr 2 (n=123+) — admin
  required in ALL. Constr 2 carries an Int (input index → batched op). Recurring second
  key `4f641455…` = likely Minswap ops/batcher.
- **Redeemer Constr 3 is never used by users** (0 occurrences in 390+ spends). Its
  handler could not be isolated by static analysis — the script is plutonomy-CPS-
  obfuscated (Scott-encoded dispatch several selector-combinators deep; both an
  automated symbolic reducer and manual bracket-tracing were inconclusive on the
  tag→branch mapping). The decode DOES show one branch (pseudocode line ~823) that
  guards on owner-sig (i_69) with NO admin check, followed by a return-to-owner output
  fold — SHAPED like an owner-only emergency withdraw — but its reachable redeemer tag
  is unproven. So **"can an owner unilaterally recover principal without Minswap?"
  remains OPEN.** Decisive tests: (a) ask Minswap; (b) mainnet dust round-trip —
  create a position, attempt owner-only-signed withdraw across redeemer variants.
- **Implication — NEW OPEN QUESTION (supersedes the old one):** farm harvests are NOT
  permissionless; they're co-signed by Minswap's backend (their app flow). Even an
  executor-KEYED position cannot be harvested autonomously — our atomic compound tx
  would need Minswap's signature. The fallback design is also impaired. Options to
  evaluate: (a) ask Minswap about their co-sign API / composability intent (Discord
  thread already open); (b) verify whether an owner-only redeemer variant enables
  unilateral exit (funds-not-hostage still holds even if harvest is gated); (c) rescope
  Phase 1 compounding to a DEX with permissionless farming; (d) manual/semi-automated
  harvest cadence through Minswap's app as a bridge.

**Original preferred design if YES (dead, kept for the record):** per-user vault UTXOs
+ ONE script-owned aggregated farm position per pool (custody isolation where it
matters, cost aggregation where the harvest fee lives — saves ~0.5–0.7 ADA/user/cycle).
**Fallback if NO:** executor-keyed aggregate farm position + validator-enforced
accounting; custody trade-off disclosed, mitigate via timelock/multisig recovery —
now ALSO gated on the co-sign question above.

## D7 · Toolchain — 2026-07

Aiken (validators + unit tests) · **@spacebudz/lucid** (tx building — CORRECTED
2026-07-16: @minswap/sdk's whole API speaks SpaceBudz Lucid v0.20 via the JSR registry,
NOT Lucid Evolution; standardized on SpaceBudz to avoid dual tx-builder stacks; JSR
needs `.npmrc` → `@jsr:registry=https://npm.jsr.io`) · @minswap/sdk · Blockfrost or
Maestro (Maestro notable: also does
Bitcoin indexing — roadmap synergy) · Mesh SDK for CIP-30 wallet connect · Yaci DevKit
for local devnet (UNVERIFIED — check current state Week 1) · preprod testnet (Minswap
deployment exists there).

**2026-07-16: toolchain verified locally** — aiken v1.1.23 installed via aikup;
`aiken check` compiles the project manifest (plutus v3) and resolves stdlib v2 clean.

No "deploy" step: validator hash = address; publish as reference script.

## D8 · Launch scope — 2026-07

Phase 1 (4 wks): NIGHT/ADA on Minswap V2. Deposit (pair or single-asset), withdraw
(sovereign), batched auto-compound, slippage + fee enforcement on-chain, minimal web app.
Demo: testnet floor, mainnet with own capped capital as target (unaudited = nobody
else's money).
Phase 2 (+4 wks): SundaeSwap V3 adapter, 2–3 more pools, frontend polish.
NOT in scope: dynamic APY routing, CL (doesn't exist on Minswap), BTC pairs (bridged BTC
on Cardano ≈ 10 coins total), token, shared vaults.

**2026-07-17 REVISION (see D15/D16):** the Phase-1 Minswap target is blocked pending the
farm co-sign answer (D6), and the Phase-2 SundaeSwap target is now WRONG — SundaeSwap
farm rewards are off-chain team-computed with no on-chain harvest (D15), unsuitable for
auto-compounding. **WingRiders is the leading Phase-1 candidate** (D16, pending the two
open confirmations). Rescope both phases once the WingRiders reward-destination question
and the Minswap Discord answer land.

## D9 · Market/bridge context (interview-verified 2026-07-12/13)

- Cardano DEX LP TVL ~$40–65M (source-dependent); NIGHT/ADA pool 8.47% fee APR + 8.6%
  MIN farm APR (2026-07-13)
- Bridged BTC on Cardano: Wanchain 8.41 + rsBTC ≤2.04 + cBTC 1.35 (anetaBTC = zombie,
  dead since 2025-08) ≈ ~10–12 coins. iBTC = Indigo SYNTHETIC, not bridged.
- Active bridge development: BIFROST (FluidTokens+zkFold+Lantr, F14-funded, testnet
  live, delivery Aug 2026), zkFold atomic swaps (F14, 3/4 milestones). Pogun: treasury
  vote failed 2026-05-24, limbo. BitcoinOS Grail: stalled. Catalyst F15/F16 cancelled.
- No live multi-DEX yield aggregator on Cardano. Genius Yield SLV = own-DEX only (~$8K
  TVL). VyFinance multi-DEX harvester = Catalyst proposal only. Optim Strategy Vaults =
  "Coming Soon", zero published spec. Poppy (F10) / Stargazer (F11): grant-gated, dead.

## D10 · Stray UTxOs at the script address — Rescue path — 2026-07-16

eUTxO has no receipt-time hook: an address is just a credential, so anyone can create
an output at the vault address and the validator never runs on receipt (only on spend).
Rejection is impossible — even more so than EVM, where omitting receive/fallback at
least reverts plain ETH. Instead, make stray funds recoverable:

- Plutus V3 spend handlers get `datum: Option<Data>` — datum-less UTxOs ARE spendable
  if the script handles `None`, and soft-casting handles inline datums that don't parse.
- **Rescue redeemer:** spendable IFF datum is `None` OR fails to cast to `VaultDatum`,
  AND treasury-signed. Valid datums always fall through to the normal paths — the cast
  check is the security boundary, so Rescue cannot touch real vaults and D2 is unweakened.
- Treasury-signed (not open-to-anyone) so accidental senders aren't raced by bots;
  return-to-sender is an off-chain customer-service action (ledger has no "from").
- Case analysis: well-formed datum ⇒ just a vault, Withdraw recovers it. Unparseable/
  missing inline datum ⇒ Rescue. Datum *hash* with unknown preimage ⇒ unrecoverable
  on-chain, period — mitigate off-chain: frontend uses inline datums only; docs warn
  never to send directly to the script address.
- Indexer implication (already required): "UTXO at script address" ≠ "valid vault" —
  filter by datum shape.

## D11 · Validator topology — one validator per DEX, pool bound in datum — 2026-07-16

One validator per DEX; all of that DEX's pools share ONE script address; each vault's
pool binding lives in its datum (`pool_id` = Minswap V2 LP asset name).

- NOT universal (all-DEX): Compound must verify DEX-specific order structures on-chain;
  carrying every DEX's code path bloats script size + exunits (eats the 0.1–0.3 ADA
  marginal budget, D4) and buys nothing — a new DEX needs new verification code anyway,
  and any code change = new hash = new address = migration. Phase 2's SundaeSwap V3
  adapter (D8) = a second validator, not a modification.
- NOT per-pool (pool_id as parameter): logic is identical either way, but per-pool means
  a reference-script publication + locked minUTxO per pool, N watched addresses, and a
  pool→address map. Pool-in-datum ⇒ adding pool #2..N is pure off-chain config.
- `pool_id` in datum is a SECURITY invariant, not bookkeeping: executor key is assumed
  compromisable (D2); slippage bounds are measured against the pool the tx touches, so
  an attacker-chosen pool makes them meaningless. Immutable pool binding pins Compound
  to the owner's chosen pool; doubles as the asset class for value-conservation checks.
- Parameters (executor, treasury, fee_bps, …) bake into the hash: changing ANY mints a
  new address ⇒ full user migration. Acceptable at launch (rotation rare; migration =
  withdraw + redeposit, always available). Pools are the dimension that multiplies —
  which is exactly why pool_id must NOT be a parameter.
- Batching unaffected: compound rounds are per-pool regardless (one shared MIN→asset
  swap order + one deposit order per batch, D4); shared address means all vault inputs
  in a batch share one reference-script witness.

## D12 · Slippage — two-layer split, nothing in the datum — 2026-07-16

"Slippage" is two different things; neither belongs in the datum (supersedes the
`max_slippage_bps` datum field in the original vault.ak sketch, and refines D2's
"slippage bound" wording):

- **On-chain floor** (validator parameter, e.g. ~200 bps): the anti-theft invariant.
  Must be on-chain — the executor is assumed compromisable (D2), and executor-side
  checks are the attacker's code in that scenario. Checked against pool spot price read
  from the pool UTXO as a REFERENCE INPUT: swap order min-receive ≥ (1−floor) × spot.
  Loose + static is correct: value conservation already protects principal, so max
  bleed = floor × one cycle's harvest; if conditions can't fill within the floor,
  correct behavior is defer the compound (nearly free — rewards keep accruing, D3).
- **Adaptive tolerance** (executor code): the real per-order min-receive, condition-
  aware (volatility, harvest size), always tighter than the floor. Protects execution
  quality, not custody.
- NOT per-user in datum: batch swaps execute at ONE shared rate (D4), so a personal
  bound only controls batch inclusion — set it tight and your vault just never
  compounds (self-grief footgun). Compound swaps are reward-dust; nobody has a
  meaningful preference. Withdraw needs no bound — owner signs their own tx.
- Week 1 verify: parse a live preprod Minswap V2 pool datum for the spot-price read.

## D13 · ~~Fee accrual — fee_owed in datum~~ — SUPERSEDED by D20 fee-as-share-mint (2026-07-18) — 2026-07-16

`fee_owed: Int` (LP token units) accrues the treasury's 4.5% cut per-vault instead of
settling every compound round.

- Why accrue: fee dust vs minUTxO. Per-vault cut ≈ 0.027 ADA/cycle (4.5% of a ~0.6 ADA
  trigger-sized harvest, D3/D4); even a 25-vault batch total (~0.7 ADA, in MIN) is
  below the ~1.2 ADA minUTxO of a token output. Paying every round attaches more ADA
  than the fee is worth.
- Why LP denomination: the vault only holds LP — compound converts the whole harvest.
  Validator already computes ΔLP for value conservation, so accrual is
  `fee_owed += fee_bps × ΔLP` (no extra data, no price read). Settlement pays in the
  asset the vault holds. LP appreciates with pool fees ⇒ treasury earns yield on its
  unclaimed share automatically (deferral isn't an interest-free loan).
- Compound is ACCRUE-ONLY — no settlement branch (see D14). Executor can't under-accrue
  (validator recomputes), can't over-settle (capped by ledger), can't inflate the
  ledger (mutation exactly determined). Compromised executor can delay treasury
  revenue — D2's "grief cadence, can't extract" applied to our own revenue.
- Naming note: field/variable names are FREE on-chain (datums serialize positionally;
  UPLC erases identifiers) — name for the auditor. Trace strings DO embed in the
  script; compile mainnet build with traces stripped.

## D14 · ~~Settlement on withdraw only + version ladder~~ — SUPERSEDED by D20 (2026-07-18) — 2026-07-16

Fees settle ONLY at withdraw; v1 allows FULL withdraw only. (Supersedes D2's withdraw
wording "or remainder returns with datum integrity" — that parenthetical was partial
withdraw, dropped for v1.)

- Withdraw-time settlement is mandatory in ANY accrual design (else closing the vault
  erases the debt) — so making it the ONLY settlement deletes the compound-settle
  branch entirely and keeps just the rule we couldn't avoid.
- v1 Withdraw: owner-signed; vault UTXO consumed, NO continuing output; `fee_owed` LP →
  treasury output; remainder → owner. No datum-mutation rules on the owner path at all.
- Dust waiver: `fee_owed < dust_threshold` (parameter) ⇒ no treasury output required.
  Protects tiny/short-stay users from minting a 1.2 ADA minUTxO output to deliver
  ~0.03 ADA of fee. Bounded, deliberate undercollection.
- Anti-drip rule (travels with partial withdraw if v2 adopts it): ANY withdraw settles
  `fee_owed` IN FULL regardless of amount withdrawn — kills the 0.1%-at-a-time drip
  attack by construction.
- Asymmetry kept: Deposit top-ups remain allowed (growth isn't all-or-nothing; only
  reduction is). Partial exit in v1 = withdraw-all → redeposit.
- Costs accepted: treasury cashflow is hostage to user exits (irrelevant in Phase 1 —
  own capital, symbolic revenue); revenue arrives as LP (treasury zaps out
  operationally); withdraw path is no longer signature-only (any accrual design pays
  this; we pay it once).
- **Version ladder:** v1 = Deposit / Withdraw (full-only, settle, waiver) / Compound
  (accrue-only) / Rescue. v2 = + Collect (treasury-signed, extracts EXACTLY fee_owed,
  preserves everything else), partial withdraw TBD. v1→v2 is a new hash/address;
  migration = withdraw-all (auto-settles all outstanding v1 fees) → deposit to v2.

## D15 · DEX pivot survey — permissionless harvest as the gate — 2026-07-17

Minswap's farm co-sign gate (D6) forced a survey of alternative DEXs. Gating criterion:
can an executor build+submit a farm-reward harvest/compound tx WITHOUT the DEX
operator's signature? Ranked (research + on-chain, 2026-07-17):

| DEX | Farm reward mechanism | Verdict |
|---|---|---|
| **WingRiders** | Claimable WRT + partner rewards; agent-distributed; farm lock non-custodial | **Viable — drilling down (D16)** |
| Splash | Permissionless ve(3,3) gauges (right model) | Not live — flagship product "coming soon", TVL withered, no testnet |
| SundaeSwap | Off-chain team-computed SUNDAE emissions + scooper-gated settlement | DEAD — nothing on-chain to harvest; worse than Minswap. **Revises D8** |
| Minswap | On-chain, but every farm spend needs hardcoded admin co-sign (D6) | DEAD without co-sign API |
| Danogo | Bond/lending marketplace, no LP farm | DEAD — wrong product shape |

**Meta-finding:** permissionless on-chain farm harvesting is RARE on Cardano. The
batcher/agent model every AMM uses tends to push "compounding" into the DEX's own
agent — rewards are either gated (can't automate) or already auto-compounded (nothing
to automate). Explains D9's "no live multi-DEX yield auto-compounder exists" — likely
structural, not incidental. Method/sources vendored at `reference/dex-survey/`.

## D16 · WingRiders V2 — architecture + Shares Lock trace — 2026-07-17

Open-source contracts (`WingRiders/dex-v2-contracts`, Plutarch) + on-chain decode.
Source excerpts + Shares Lock UPLC decode vendored at `reference/wingriders-onchain/`.

**Order/AMM model (`Request.hs`, `Pool.hs`):**
- Everything is a Request (order): Swap / AddLiquidity / WithdrawLiquidity /
  AddStakingRewards / Extract*. Redeemer = Apply (agent) | Reclaim (owner-signed).
- `Apply` checks ONLY that a correct pool-hash input is present (delegates to pool) —
  no agent signature at the request level. `Reclaim` = owner pubkey signature.
- **`beneficiary` can be a SCRIPT address** (RequestDatum) — an applied order's output
  can go to our vault. Opposite of Minswap's pubkey-only farm ownership.
- Pool `evolve` DOES require a WingRiders **agent TOKEN** in an input (Pool.hs:98,307).
  But it's a token-presence gate, NOT a hardcoded signature, and the pool enforces the
  beneficiary + value conservation ⇒ agent CANNOT steal/redirect. This is a LIVENESS
  dependency (submit request, their agent applies it), same as any Cardano AMM batcher
  — categorically different from Minswap's per-spend admin signature on user funds.

**Farm reward model — CORRECTS an earlier wrong read:**
- Initial (wrong) conclusion "nothing to compound": based on seeing only
  `AddStakingRewards` add reward value into pool reserves (ConstantProduct.hs:217 —
  `qtyA += rewardsQuantity`). That is only the pool's ADA-staking stream (native
  auto-compound, not ours to do).
- WingRiders pays LPs ~5 streams; **WRT farm emissions + partner "double-yield" tokens
  are CLAIMED, not auto-compounded** (WingRiders docs/Medium: "available to view via the
  farming panel… available to claim"). So a compoundable surface DOES exist.

**Shares Lock trace (registry "Shares Lock" `0237cc31…`, Plutus V1, ACTIVE 2026, 1000+
positions; the farm-lock contract):**
- Hardcodes WingRiders authority AssetClass `1c0d57fd…` + tokenName "A" (100k supply,
  ~all in one WingRiders address) as a script parameter.
- Redeemer dispatch (constructor tags 20–24):
  - tags 20–23 + default = **OWNER paths**: use datum, reach `equalsByteString` (pubkey
    compare), do NOT require the authority token.
  - tag 24 = **AGENT path**: requires authority token "A", ignores datum owner — the
    reward-processing/distribution path only WingRiders can run.
- ⇒ **Locked LP is owner-recoverable with just the owner signature (non-custodial;
  WingRiders cannot trap it)**, while **WRT rewards are PUSHED by WingRiders' agent per
  epoch, not permissionlessly pulled**. HIGH confidence (structural trace + parameter id).

**Product implication (refined 2026-07-17):** WingRiders is the first surveyed DEX where
autonomous compounding is even POSSIBLE — but via the executor-keyed FALLBACK (D6), not
the fully-non-custodial preferred design. Reasoning:
- The farm-lock owner path is a signature check (pubkey), so — like Minswap — our SCRIPT
  vault cannot be the farm-lock owner. To earn WRT, LP must sit in a pubkey-owned lock.
  For automation that pubkey must be the executor's (a user-owned lock can't be
  compounded without the user signing each cycle). ⇒ executor-keyed aggregate farm lock.
- **Why this WORKS on WingRiders but NOT Minswap:** here the executor's OWN signature
  suffices for LP ops (Apply needs no agent sig; Reclaim needs owner=executor) and reward
  distribution is agent-PUSHED (no admin co-sign on executor funds). On Minswap even an
  executor-keyed position couldn't harvest without the hardcoded admin co-sign. So the D6
  fallback is dead on Minswap, viable on WingRiders.
- **Custody:** NOT fully non-custodial — the aggregate farm-staked LP is under the
  executor (multisig) pubkey while farming, same tradeoff as the D6 fallback. Mitigated:
  the lock is owner(executor)-recoverable and WingRiders can neither trap nor redirect it
  (agent token can't steal; owner path is sig-only). Disclose the custody model; consider
  multisig executor + timelock recovery. The `beneficiary`-can-be-script property helps
  at the LP-op layer (swap/add outputs can target our vault) but does NOT make the farm
  lock itself script-ownable.
- Dependencies: WingRiders agent liveness for LP-op application + WRT distribution.
This is the honest ceiling: WingRiders enables an AUTOMATABLE, custody-MITIGATED product,
not a fully-sovereign one. Still the best result of the survey.

**CONFIRMED on mainnet (Blockfrost, 2026-07-17) — the farm-compounding model:**
- Reward distribution: WingRiders' agent (authority token "A", operational pubkey
  `addr1q8lj38m…`) batches all Shares Lock positions and PUSHES WRT **into each position
  UTXO in place** — verified in live txs (block 13.67M) adding WRT to 8–30 positions per
  batch. Positions live at the Shares Lock enterprise script `addr1wypr0np3…` (= hash
  `0237cc31…`). Contract is very much live/current.
- Position ownership: datum records a **PubKeyCredential owner**. A real owner-reclaim
  (tx `49bc84d7…`) was authorized by a **vkey signature matching the datum owner pkh**
  exactly (`f873a0f88d…`), no authority token, no WingRiders co-sign. ⇒ owner path is
  pubkey-signature — **script vaults CANNOT own positions** (confirmed, matches trace).
- Harvest = owner reclaims the position (which now contains accrued WRT). Owner-signed,
  permissionless w.r.t. WingRiders.

⇒ **Executor-keyed farm layer confirmed as the only option, and it WORKS:** executor (as
pubkey owner) locks LP, WingRiders' agent auto-pushes WRT into the positions, executor
periodically reclaims (own signature only) → swaps → re-adds → re-locks. No admin
co-sign anywhere (unlike Minswap). Custody = executor-multisig over staked assets
(mitigated: owner-reclaimable, WingRiders can neither trap nor steal). This is a viable,
automatable, custody-DISCLOSED farm-compounding product on WingRiders — the fallback
design (D6) that was dead on Minswap is alive here. Evidence in
`reference/wingriders-onchain/`.

## D17 · Fallback product — cross-DEX LP position router — 2026-07-17

If farm-emission compounding falls through (Minswap co-sign answer bad AND WingRiders
executor-keyed custody unacceptable), fallback pitch: a non-custodial app that manages
the LP position itself — user deposits a pair (e.g. NIGHT/ADA), the service places/rebalances
it to the best-return venue across DEXs. Scoped to Minswap + WingRiders (most-researched).

**Fully automatable without custody/authorization gating — because it never touches farms**
(where all the gates live). Per-operation, both platforms:
- Add/remove liquidity = order/request; **script can be owner/receiver/beneficiary**;
  batcher/agent applies it; the batcher CANNOT redirect (order enforces receiver) and
  CANNOT permanently block (owner can cancel/reclaim). LP tokens are native tokens — our
  script vault holds them directly, non-custodially, under the existing D2 invariants.
- **Minswap AMM order path VERIFIED (source, `minswap-dex-v2`):** `ApplyOrder` only
  requires the pool-batching withdrawal validator present; that validator requires an
  authorized batcher from on-chain `GlobalSetting.batchers` (licensed-batcher liveness
  dependency, like Sundae scoopers) — NOT a hardcoded signature and CANNOT steal.
  `CancelOrderByOwner` supports 4 auth methods incl. **SpendScript** ⇒ our script can
  reclaim its own orders. This is the SAME shape as WingRiders (D16), and categorically
  different from the Minswap FARM admin co-sign (D6). Source vendored at
  `reference/minswap-amm/`.

**Net:** no gate can trap or steal; the only dependency is each DEX's licensed batchers
(inherent to any Cardano AMM, non-custodial, but a censorship/liveness risk — a hostile
DEX could refuse to batch our orders, forcing cancel-and-reclaim). Reuses the vault
architecture (D1/D2) cleanly — swap "compound rewards" for "migrate to best venue".

**Tradeoffs / committee Q&A:**
- Yield is TRADING-FEE-only (fully non-custodial). Including farm APR re-inherits the
  Minswap gate / WingRiders custody tradeoff → optional disclosed "boosted" tier.
- Same-pair fee-APR spread across venues may be thin ⇒ real value is the bundle:
  zap/single-sided entry, consolidated cross-DEX position + P&L, IL-aware +
  profitability-gated rebalancing (reuse D3 trigger: migrate only when gap beats
  round-trip cost).
- Needs a cross-DEX APR/TVL data layer (not needed by the compounder).
- Novel: D9 notes no live multi-DEX yield aggregator on Cardano; works TODAY on both.

**D17 addendum · Competitive landscape re-verified — field still empty — 2026-07-17**
Full re-sweep of the cross-DEX LP management space (all statuses checked directly on
Catalyst/DefiLlama/project sites, 2026-07-17):
- Genius Yield SLV: live, own-DEX only, TVL ~$8.3K (unchanged). Optim Strategy Vaults:
  still "Coming soon", no spec. Poppy: archived. Stargazer: 1/4 milestones, stalled.
- VyFi multi-DEX harvester: F13 proposal REJECTED; retrying in F15 as an "AI-driven
  liquidity optimization layer" (200K ADA, pending vote, nothing built) — monitor.
- NEW finding: **MuesliSwap "Liquidity Hub" (F14) — near-exact copy of the D17 concept**
  (multi-DEX LP-side aggregator w/ liquidity router) — REJECTED by Catalyst voters.
  Also "Liquidity Pool Aggregator" (F13, ADA Markets) — REJECTED. An F14 proposal
  itself states "no existing yield aggregators on Cardano".
- Adjacent (DexHunter/Indigo/Liqwid/FluidTokens/Strike): no LP-management product or
  roadmap. DexHunter = swap aggregation only.
⇒ **Space confirmed empty as of 2026-07: nothing live, nothing on testnet, no spec
published.** Double-edged for the pitch: (1) established DEX teams saw the same gap
(concept validation) but (2) three Catalyst proposals for this exact idea were REJECTED
by voters and nobody funded it privately — committee will ask "why did others fail /
is the market too small?" (Cardano DEX LP TVL ~$40–65M, D9). Have that answer ready.

## D18 · Invariant redesign, executor-keyed variant — PARTIALLY SUPERSEDED by D20 (state machine dropped; Tier framework, mitigations & verifier survive) — 2026-07-17

Systematic pass of D2/D10–D14 against the executor-keyed farm design (D16). Root cause
of every change: value physically LEAVES the vault into executor-owned farm positions
(Zone C), where our validator never runs. Vault becomes a claim state machine:
Idle → Entering → Farming → WithdrawRequested → consumed.

**SUPERSEDES (for this variant only — the original invariants stand for any future
script-owned design):**
- D2 headline: "compromised executor cannot extract funds" is FALSE for farmed value.
  A hostile executor key can spend all Zone C positions without touching a vault.
  Mitigations are operational: threshold/MPC executor key, capped own capital (D8),
  public proof-of-reserves monitor (Σ tagged positions ≥ Σ vault claims — ship it in
  the frontend; converts trust-us into verify-us). Withdrawal of farmed value is
  executor-liveness-dependent (idle value stays owner-sovereign).
- D2 inv 3 (value only grows): replaced by "value may only exit into a well-formed WR
  AddLiquidity request for the datum's pool" — checkable at Enter (request UTXO is an
  output of the validated tx).
- D12 floor: enforceable at entry/exit orders only. Compound-cycle swap floor is dead
  weight — validator can't run there, and it defends against bleed by an executor who
  could take the whole position anyway. Adaptive tolerance (executor code) + Tier-2
  detection covers the cycle.
- D13 per-compound accrual: dead (no vault touch per cycle). Fee computed ONCE at
  Settle: `fee = fee_bps × max(0, LP_returned − LP_principal)`, **denominated in LP
  units** — LP count only grows via compounded emissions (trading fees appreciate
  in-pool without changing count), so LP-units delta isolates emissions exactly and
  preserves D13's fee-on-emissions-only intent. ADA-denominated would silently tax
  trading fees too.

**SURVIVES UNCHANGED:** D2 inv 1 (executor auth, now on transitions), inv 4 (datum
immutables), D10 Rescue, D14 (settle-at-withdraw-only is now forced; dust waiver;
full-withdraw-only v1), D11 topology (pool-in-datum; slippage_floor param retained for
entry/exit).

**Redeemer set becomes:** Deposit (owner) · WithdrawIdle (owner-only, Tier-1, idle value)
· RequestWithdraw (owner flags state) · Enter (executor: idle → WR request + claim
recorded) · Reconcile (executor: Entering → Farming, see below) · Settle (executor:
enforce split on presented value — user gets all but fee, fee capped by formula,
treasury only other recipient) · Rescue.

**Key mechanism — Reconcile via reference input:** actual LP principal is unknowable at
Enter (batcher fills later; request only carries minWantedShares as lower bound). Fix:
after fill, executor spends vault once more WITH the Shares Lock position as a
REFERENCE INPUT; validator reads the position's actual LP amount from the referenced
UTXO and requires new datum principal_lp == it. Chain is the witness — no attestation.
**Load-bearing dependency:** validator must verify the referenced position belongs to
THIS vault ⇒ the stake-credential tagging question (week1-verify D16 item (b)) is
promoted from optimization to the anchor of on-chain principal integrity. If tagging
fails, principal_lp degrades to executor-attested (Tier 2). → Most important dust test.

**Enforcement scorecard (Tier 1 = validator-enforced, 2 = publicly detectable, 3 =
executor trust):** idle sovereignty T1 · entry form/pool T1 · principal T1-if-tagging
· immutables T1 · fee formula T1 (on presented value) · pro-rata split T2 · cycle
slippage T3+T2 · no-extraction T3 · farmed-withdraw liveness T3.

## D19 · Minswap farm integration RESOLVED — co-sign API + trustless exit — 2026-07-18

Minswap team answered all four Discord questions (their integration doc vendored at
`reference/farm-docs/minswap-farm.md`; GraphQL endpoint + all named mutations verified
live 2026-07-18 by field-probing `k-app-monorepo-mainnet-prod.minswap.org/graphql`).
**Resolves the D6 successor question: auto-compounding on Minswap IS possible.**

1. **Co-sign API (official path):** farm spends (harvest/stake/withdraw) are built AND
   co-signed server-side via GraphQL mutations (`buildMultipleHarvestsV2`,
   `buildStakeDepositV2`, `buildStakeWithdrawV2/AllV2`, `buildFirstDepositV2`); we add
   the owner signature and submit. `buildMultipleHarvestsV2` harvests multiple pools in
   ONE tx. They explicitly welcome composability and offered key-API provisioning.
2. **Trustless exit CONFIRMED:** `EMERGENCY_WITHDRAW` = redeemer constructor **3** —
   owner-signature-only, buildable without Minswap, forfeits pending rewards.
   **Corroborates our UPLC decode exactly**: the owner-only branch we found but couldn't
   map (D6 addendum "tag 3 unproven") is precisely this. Two independent sources agree.
   ⇒ principal is NEVER hostage; max loss on Minswap-API death = one cycle's rewards.
3. **Script-owned positions: NO** (confirmed; matches D6 decode). One position per
   owner per pool ("first deposit fails if owner has a position") ⇒ executor-keyed
   AGGREGATE position per pool — the D6 cost-aggregation model, via executor keys.

**Architecture implications:**
- Same custody model as WingRiders (D16/D18): executor-keyed positions; D18's claim
  state machine / Enter-Reconcile-Settle / Tier framework carries over to Minswap
  nearly wholesale. D2/D4's "one atomic batch tx" is dead on BOTH DEXs — the compound
  cycle is multi-tx (API harvest → swap order → batcher fill → add-liq order → fill →
  API stake).
- Minswap API = LIVENESS dependency for harvest/stake, NOT a custody gate (emergency
  withdraw bounds the damage). New failure mode vs WingRiders: rewards require calling
  their backend each cycle; WingRiders pushes rewards agent-side with no API.
- **NEW ENGINEERING INVARIANT: never blind-sign server-built CBOR.** The executor must
  decode each returned tx and verify against expectations (rewards→executor, correct
  restake amount, datum integrity, no value leakage, expected signers) before signing
  with the hot key. This is a hard requirement of the API model.

**Minswap vs WingRiders — both now viable; the choice is product/ops:**
| | Minswap | WingRiders |
|---|---|---|
| TVL / target pool | ~10× larger; NIGHT/ADA (D8/D9) | smaller (~$4M) |
| Harvest dependency | their API each cycle (liveness) | none — agent pushes WRT |
| Exit w/o platform | emergency withdraw (forfeits pending) | normal reclaim (keeps rewards) |
| Official support | explicit, key-API offered | none sought yet |
| SDK / tooling | vendored @minswap/sdk | lower-level cab lib |
| Test venue | NO preprod farm — mainnet dust only | preprod deployment exists |

**D19 addendum · Universal signing gate + dependency pinning — 2026-07-18**
The "never blind-sign server-built CBOR" rule generalizes: the API is not the only
unaudited builder in the signing path — the @minswap/sdk, Lucid, and the whole npm/JSR
dependency tree are too. Same vulnerability class (untrusted code shapes a tx our hot
key signs); different dynamics (a live API can serve a targeted malicious response per
request; static pinned code can only attack if the poison is already in the installed
artifact, i.e. the risk concentrates at version-bump/supply-chain moments).
- **One choke point, builder-agnostic:** NOTHING is signed unless an independent
  verifier passes it, regardless of who built it (API / SDK / Lucid / our own code).
  Verifier re-parses the RAW CBOR to be submitted (not the builder's in-memory objects)
  — ideally via a distinct, minimal-dependency deserializer (e.g. CML) to avoid
  monoculture failure — and checks against pre-stated INTENT (expected inputs, outputs
  to expected addresses, order/position datum receiver = our vault/executor, value
  conservation, sane fee, required_signers exactly {executor, Minswap keys}, no surprise
  mint). Fail closed. This is D2's "constrain the executor path" done in TS against
  foreign builders instead of in Aiken.
- **Dependency pinning (applied 2026-07-18):** all executor direct deps pinned to exact
  versions (dropped `latest`/`^`); transitive deps pinned by lockfile. Use `npm ci`
  (not `npm install`) — exact lockfile install, refuses drift. Bumps get a reviewed diff
  before reaching the key-holding machine. Vendored `reference/sdk` snapshot enables
  diffing SDK releases.
- **Blast radius unchanged:** even a fully compromised builder/dep CANNOT touch user
  vault funds — spending a vault UTXO runs our on-chain validator, which no malicious
  builder output satisfies. Entire supply-chain surface is confined to the executor-
  custody (Tier-3) zone D18 already prices in (MPC key, capped capital). The verifier
  narrows the largest remaining hole into that zone.

**Status: D8 Phase-1 Minswap target RESTORED as viable** (executor-keyed variant,
custody-disclosed per D18). Next: provision API access; dust-test emergency withdraw
(constructor 3) to close the last unverified claim; decide Minswap-first vs
WingRiders-first vs both — a product decision, no longer a technical gate.

### D19 addendum · Why the trustless exit can exist (reward-reserve custody) — 2026-07-23

Surfaced writing `emergency-withdraw.md`: **pending farm emissions are never in
the position UTXO** — they accrue as accounting against Minswap-controlled reward
reserves and only become the owner's at harvest, which spends THEIR funds (hence
the harvest co-sign). `EMERGENCY_WITHDRAW` (constructor 3) can be owner-only
precisely because it touches only the owner's staked value; an exit that paid out
pending rewards couldn't be trustless. Corollaries: forfeiture on emergency exit
is structural, not punitive; no vault ledger entry is needed (emissions never
landed — N1); and the co-sign requirement on normal spends is Minswap protecting
their reserves, not gating our principal. ⚠️ their statement + design inference
(`reference/farm-docs/minswap-farm.md` §2); dust-cycle item (b) observes it.

## D20 · SUPERSEDES D1 — pooled single-vault design (share-based) — 2026-07-18

**Decision:** abandon per-user vault UTXOs. One pooled vault per pool at our script
address; users hold fungible share tokens; all accounting is share-based. Farm layer
unchanged (executor-keyed aggregate position, D16/D19).

**Why D1's pillars collapsed under the research:**
1. ~~"Smallest audit surface"~~ — INVERTED. The executor-keyed farm forced D18's claim
   state machine + Enter/Reconcile/Settle + reference-input reconciliation + per-user
   fee ledgers, PLUS pro-rata share math anyway (batched compounds split gains). The
   per-user design grew to contain the thing it was built to avoid, plus a state
   machine the pooled design doesn't need.
2. ~~"Strongest non-custodial story"~~ — already broken by the farm layer regardless of
   vault topology (D18): ~100% of assets are farmed ~100% of the time, under executor
   keys. Both designs end at the identical custody disclosure.
3. ~~"Withdrawal needs only owner sig"~~ — dead for farmed value in both designs.
4. "No shared-state contention" — still true, and is the one real cost of pooling;
   paid via N4 (order-based actions) below.
**The forcing fact:** Minswap allows ONE farm position per owner per pool (D19 —
`buildFirstDepositV2` fails if a position exists), so assets are commingled at the farm
layer no matter what the vault layer pretends. Per-user vaults on Minswap = per-user
claim receipts against a pooled position = shares in an expensive costume.

**Design:**
- One vault UTXO per pool (v1: NIGHT/ADA), `pool_id` in datum (D11 logic carries over).
- **Share token** (transferable native asset, one asset name per pool) minted on
  deposit, burned on redemption. Non-transferable variant REJECTED — it reintroduces
  per-user receipt UTXOs, i.e. D1 through the back door.
- Datum tracks: `total_shares`, `total_lp_principal` (LP units entered into farm),
  plus pool binding. Exchange rate = farmed LP total / total_shares.
- **Fee redesign (supersedes D13/D14 wholesale):** at each compound, mint treasury
  shares worth fee_bps (4.5%) of the harvested gain. No fee_owed ledger, no settlement
  rules, no dust waiver — the minUTxO dust problem that created the accrual design
  doesn't exist (treasury exits like any user). LP-units discipline retained: fee is
  computed on LP-count growth (emissions), never on in-pool appreciation.
- **Trigger (D3 restated):** pool-level — compound when aggregate accrued rewards ≥
  2× cycle cost (~5–7 ADA: API harvest tx + swap order + add-liq order + stake tx +
  batcher fees). Aggregation crosses threshold faster than any per-vault trigger.
- Deposits/withdrawals are ORDER UTxOs batched by the executor against the vault (N4).
- Survives untouched: D10 Rescue · D12 entry/exit slippage floor (our own orders) ·
  D19 API integration + universal signing verifier + dependency pinning · D16
  emergency-withdraw guarantee · D18's Tier framework, MPC-key + capped-capital +
  proof-of-reserves mitigations (custody model is UNCHANGED by this decision).
- D8 re-scope: Phase 1 = pooled NIGHT/ADA vault on Minswap, pitch-day demo; build
  window starts 2026-08-17 (4 prep weeks available before it).

### D20-N · NON-NEGOTIABLE INVARIANTS (the price of pooling — never trade these away)

The shared-vault attack class (ERC-4626 family) was the reason D1 existed. We accept
the class ONLY under these standing conditions. Each MUST exist as a named check in
the validator and a test matching its ID (`aiken check -m n1_` etc.). Any PR/commit
touching share math, mint/burn, or redemption MUST state which N-invariants it
preserves. These are restated in CLAUDE.md and as the header of vault.ak so they are
loaded into every working session.

- **N1 — Datum-truth accounting.** Exchange rate derives ONLY from datum-tracked
  totals (`total_shares`, `total_lp`). NEVER from reading UTXO balances. Kills
  donation-rate manipulation; makes D10 stray UTxOs accounting-irrelevant.
- **N2 — Dead shares at init.** First deposit mints a fixed virtual/dead share offset
  (burned to an unspendable key or held by the script forever). Kills the
  first-depositor inflation attack.
- **N3 — House-favored rounding, one direction, everywhere.** Shares round DOWN on
  mint; assets round DOWN on redemption; the pool keeps every remainder. No path may
  round in the redeemer's favor. Rounding asymmetry is where 4626 exploits live.
- **N4 — Order-based user actions, owner-cancellable.** Users never spend the vault
  UTXO directly (contention + griefing). Deposits/redemptions are order UTxOs; the
  executor batches them; every order is cancellable by its owner's signature alone at
  any time (sovereignty over pending actions).
- **N5 — Custody honesty.** The share token is a redemption claim enforced at burn by
  the validator, dependent on executor liveness, against an executor-keyed farm
  position. No pitch, doc, or UI may describe the pooled vault as more sovereign than
  that. (Comms invariant — reviewed at every user-facing artifact.)
- **N6 — Thread-NFT authenticity** (added 2026-07-18). A one-of-one state thread NFT,
  minted at vault init, lives in the vault UTXO forever: the vault validator requires
  it in the continuing output, and the share mint policy authorizes mint/burn on the
  NFT's presence — never on "some UTXO at the vault address." Without it, a
  counterfeit vault UTXO parked at our own validator address with a doctored datum
  (huge `total_lp`, tiny `total_shares`) passes the validator's checks *relative to
  its own fake datum* and mints real shares redeemable against the real vault — a
  drain. All off-chain reads (web preview, executor indexer) locate the vault by the
  NFT, not the address. Test `n6_`: a counterfeit vault UTXO cannot trigger a share
  mint. ("One vault UTXO per pool" was D20 design prose; N6 is its enforcement.)

### D20 addendum · `total_lp` joins the datum (N1 gap fix) — 2026-07-18

Surfaced writing `docs/workflows/deposit.md`: the original sketch priced shares off
`farmed_lp` alone, but deposited LP sits in the vault UTXO between ApplyOrders and
EnterFarm — during that window the rate numerator is understated, so new depositors
mint too many shares and dilute holders. Fix: datum tracks **`total_lp`** (all
pool-owned LP, vault-held + farmed) as the sole exchange-rate numerator; `farmed_lp`
remains as the farm-custody sub-ledger (`farmed_lp <= total_lp`, never used for
pricing). Transitions: ApplyOrders moves `total_lp` only; EnterFarm moves `farmed_lp`
only; RecordHarvest moves both by ΔLP. Preserves N1 (indeed, is required by it);
N2–N5 untouched.

### D20 addendum · Share-token metadata = CIP-68 at init — 2026-07-18

Share token asset name carries the CIP-67 `(333)` fungible label from first mint;
vault init also mints the paired `(100)` reference NFT whose inline datum holds
`{name, ticker, decimals, logo}` (treasury-parked). Chosen over a CIP-26 registry
entry because it's on-chain (works identically on preprod for the demo, no PR-review
latency, no unverified script-policy attestation); CIP-26 remains optional mainnet
polish. Decided now because the label is part of the asset name and frozen at first
mint — retrofit = new token + migration. Details land in `docs/workflows/vault-init.md`
when written; preprod wallet-rendering check on week1-verify.

### D20 addendum · `ExitFarm` joins the redeemer set (custody one-way-valve fix) — 2026-07-19

Surfaced writing `docs/workflows/redeem.md`: the D20 redeemer set (ApplyOrders ·
EnterFarm · RecordHarvest · Rescue) had no transition moving LP from farm custody back
into the vault — EnterFarm was a one-way valve. Farm-withdrawn LP (buffer-miss
redemptions; the emergency-withdraw unwind) would strand at the executor's address
with `farmed_lp` still claiming it as farmed: redemptions beyond the unfarmed buffer
become unservable (n4 payouts need vault-held LP), and proof-of-reserves (D18) reads
a phantom shortfall. Fix: **`ExitFarm`** — executor-signed mirror of EnterFarm: vault
value += LP entering, `farmed_lp` −= exactly that amount, `total_lp` / `total_shares`
/ exchange rate unchanged (a custody move, never a rate event — N1). Rides with a
named check **`solvency`**: `0 <= farmed_lp <= total_lp` must survive every vault
transition. The transitions table (total_lp addendum above) extends: ExitFarm moves
`farmed_lp` only, downward. Also the on-chain leg of the emergency-withdraw unwind
(D19) — `emergency-withdraw.md` will depend on it when written.

### D20 addendum · Deliberately absent redeemer paths — 2026-07-19

Confirmed while closing the redeemer set: **no wind-down/retire path** (the vault
UTXO + thread NFT persist forever at ~one minUTxO per pool — a close path would need
a kill authority nobody should hold) and **no migrate/upgrade redeemer** (a
treasury-signed migrate is a backdoor by definition — whoever holds it can redirect
the vault; upgrades = users redeem and re-deposit into the new vault). Absence is
chosen, not missed — also noted in the vault.ak sketch so future sessions don't
"fix" it.

### D20 addendum · Uniform pre-batch rate for ApplyOrders batches — 2026-07-19

Every order in an ApplyOrders batch — deposits and redeems, mixed batches allowed —
prices at the SAME exchange rate: the input vault datum's `(total_shares, total_lp)`.
Per-order entitlements floor per N3; the continuing datum updates as net sums. Safe
because (a) both directions are rate-neutral — a proportional mint/burn leaves
LP-per-share unchanged — so batch composition cannot move the rate, and (b) the
double-floor round trip `floor(floor(lp·S/L)·L/S) ≤ lp` guarantees a same-batch
deposit+redeem always loses dust to the pool, never extracts. Rejected alternatives:
sequential per-order rate updates, and two-phase deposits-then-redeems —
rate-neutrality makes both equal to uniform modulo dust, while adding
order-dependence (an N4 fairness surface: executor-chosen ordering would affect
per-user outcomes), quote-breaking (`min_shares`/`min_out` would depend on
unknowable batch position), and a costlier validator fold (mutating totals threaded
per order vs. two constants + one net-sum check). Bonus of uniform mixed batches:
in-tx value netting — incoming deposit LP funds outgoing redeem payouts; the vault
covers only the net difference, shrinking buffer pressure under two-sided traffic.
Surfaced in deposit.md (Open point 3, now struck); full argument in redeem.md Step D.

### D20 addendum · `farmed_lp` semantics under the two-hop crossing — 2026-07-23

The co-sign API spends only owner UTxOs, so every vault↔farm crossing is two txs
with the executor address as midpoint (enter-exit-farm.md, the two-hop finding).
Consequence for the datum field: **`farmed_lp` means "LP outside the vault under
executor farm-custody"** — farm position plus any in-flight remainder — not "LP
currently staked." It increments when LP leaves the vault (EnterFarm) and
decrements when LP re-enters (ExitFarm), i.e. the ledger moves at the VAULT
boundary. This keeps vault-held LP == `total_lp − farmed_lp` exact by value
conservation, and defines proof-of-reserves' reconciliation target: `farmed_lp ==
farm position LP + executor-address LP in flight` (transient mismatch during a
crossing is expected and bounded). Mechanics in enter-exit-farm.md.

### D20 addendum · Datum forward-compatibility field (CIP-68-style `extra: Data`) — 2026-07-26

**`OrderDatum` (and, by the same argument, `VaultDatum`) gets a generic
`extra: Data` catch-all field from day one — empty/unused for v1, reserved so
a later addition never forces a new validator.** Surfaced designing
`deposit.md`'s `listMyLegs`/`cancelOrder` (grouping multiple order UTxOs from
one deposit action, `batch_id` being the motivating candidate use — not
decided, only the slot is). Distinct from the existing CIP-68 addendum above
(share-token *display* metadata, the `(333)`/`(100)` pair) — this is about
our own vault/order datums' future extensibility, unrelated use of the same
CIP.

Researched, not assumed: Aiken's own docs don't state whether `expect x: T =
data` tolerates a wire value with more fields than `T` declares, and
Minswap's production validator (`reference/minswap-amm/pool_validator.ak:
313-321`) only demonstrates the `..` spread pattern for ignoring *known*
fields while reading an already-compiled type — a different question. What
actually decided this: CIP-68 itself is the ecosystem's answer to exactly
this problem (`[metadata, version, extra]`) — an extensibility mechanism
wouldn't need to exist as its own CIP if naive field-appending were free —
and both Minswap and WingRiders independently chose full versioned-type
replacement (V1→V2, confirmed in each of their vendored/researched sources)
over retrofitting when their own datums evolved. Given "no deploy step,
validator hash = address," that pattern means a new validator + full user
migration (D11: "migration = withdraw + redeposit") if the slot isn't
reserved now. Cost of an unused `Data` field today is near-zero (marginal
minUTxO/fee bump, zero validator complexity, never parsed); cost of adding
it after launch is a migration, most likely discovered only once real funds
are already live. Full reasoning + the `batch_id` candidate use in
`vault-init.md`'s open questions.

## D21 · Deposit path — any mix of pool assets + LP, one signature, via chained Minswap order — 2026-07-18

**Decision:** a Phase-1 deposit accepts any combination of {pool asset A, pool asset B,
LP tokens} for the target pool (NIGHT, ADA, and/or NIGHT/ADA LP), in **one user
signature**. Unrelated tokens are out of scope (would need a swap leg; revisit
post-demo). The web builds one tx with up to two order outputs:

1. **Asset leg (NIGHT and/or ADA, any ratio):** a Minswap V2 `DEPOSIT` order —
   imbalanced/single-sided is native (`DepositAmount.SPECIFIC_AMOUNT
   {depositAmountA, depositAmountB}`, one side may be 0; no separate zap step exists
   in V2) — with `successReceiver` = **our order validator address** and
   `successReceiverDatum` = our deposit-order datum, `refundReceiver` = the user.
   Minswap's batcher mints the LP and delivers it directly into our order queue.
2. **LP leg:** a direct order UTXO at our order validator (Minswap's deposit order
   mints LP from assets; it cannot accept LP — hence a second output, not a second
   code path).

The vault/validator surface is untouched: our validators only ever see LP-denominated
orders. A mixed deposit credits shares in two chunks (LP leg at the next ApplyOrders;
asset leg after Minswap's batcher fills), each priced at its application-time datum
rate. `min_shares` for the asset leg is computable at signing because the Minswap step
carries its own `minimumLP` slippage bound: `min_shares = floor(minimumLP × datum
rate) − tolerance`. The 2 ADA Minswap batcher fee rides on the user's tx — depositors
pay their own conversion; the pool never subsidizes it.

**Custody chain (N4/N5-clean):** user → Minswap order (canceller = user; kill/refund
path pays `refundReceiver` = user directly, bypassing us) → our order UTXO
(owner-cancellable) → vault. The asynchronous NIGHT→LP conversion gap is carried by
Minswap's infrastructure — never by our exchange rate (which would let depositors dump
slippage on holders) and never by executor custody of raw user principal (which would
expand Tier-3 beyond farmed value and resurrect the pending-state machine D20 killed).

**Verified (2026-07-18, from source — citations):**
- Imbalanced `DEPOSIT` + `minimumLP` + `killable`: `reference/sdk/src/types/order.ts`
  579, 793.
- Delivery-to-receiver is **on-chain enforced**: pool batching validator calls
  `validate_order_receiver` on every fill (`reference/minswap-amm/pool_validator.ak`
  ~333); `ScriptCredential` receivers explicitly supported with a mandatory datum
  match — `EODInlineDatum(h)` forces an inline fill datum hashing (blake2b-256 of
  serialization) to `h` (`reference/minswap-amm/order_validation.ak` 1185–1215,
  vendored today from their public repo). A batcher cannot fill our order without
  attaching our exact datum inline at our address.
- SDK supports it first-class: `DexV2CustomReceiver` (`reference/sdk/src/dex-v2.ts`
  31); the SDK hashes the datum into the order and stores the preimage in an extra
  inline-datum UTXO for the batcher (`buildUtxoToStoreDatum`,
  `src/utils/tx.internal.ts` — script receivers are an anticipated case).

**Remaining unverified (deferred, on week1-verify):** whether Minswap's licensed
batcher *operationally* fills orders with third-party script `successReceiver`s —
forced if filled, but fill-willingness is off-chain policy. Settle by preprod dust
test (first executor code) + asking in the open Minswap Discord thread.

Supersedes the LP-only v1 framing briefly proposed in `docs/workflows/deposit.md`'s
first draft. Full step-by-step: `docs/workflows/deposit.md`.

### D21 addendum · Order datum splits `canceller` from `payout` — 2026-07-18

The order datum's owner field is two fields: **`canceller: AuthMethod`**
(`Signature(pkh) | SpendScript(hash)`) and **`payout: Address`** (full address).
Rationale: an address can't sign — a signature-only Cancel would brick orders from
script-based wallets (multisig/shared), violating N4 for that user class — and a bare
pkh payout would strand the user's stake rights on the share output. This is Minswap's
own proven pattern (`canceller` + `successReceiver`, vendored
`reference/minswap-amm/order_validator.ak`; their other two auth methods, withdrawal
and mint, are deferred as exotic). Web always sets `canceller` =
Signature(connected wallet), `payout` = connected wallet's full address. Datum shape
is frozen pre-build because changing it later means a new validator hash, new address,
and a migration.

### D21 addendum · Order validator gets the D10 Rescue path — 2026-07-18

The order validator adds a third spending path: **Rescue — treasury-signed,
reachable ONLY when the datum is missing or fails to cast to `OrderDatum`** — the
exact D10 model transplanted (unconstrained treasury spend; forcing a treasury-address
payout gains little since a compromised treasury key re-spends anyway). Rationale:
both legitimate paths (Cancel, Apply) begin by reading the datum, so a cast failure
bricks the UTXO — and on the asset leg this is not just dust risk: whatever
`successReceiverDatum` our web attaches is what Minswap's validator forces onto the
fill output, so a frontend serialization bug would deliver a user's *real deposit LP*
already bricked. Rescue is the backstop for our own bugs. Scope notes: (a) datums that
cast but hold nonsense values are NOT rescuable — they cancel fine, no treasury power
over well-formed orders; (b) datum-by-hash outputs with a lost preimage are
unspendable by protocol (preimage required before any validator runs) — no rescue
possible; policy is we only ever emit inline datums (Minswap fills are forced inline
by `EODInlineDatum`). N5 wording: "malformed sends are recoverable at treasury
discretion" — discretionary recovery, never a guarantee.

### D21 addendum · ONE order validator for all pools; `pool_nft` in the datum — 2026-07-18

The order validator is a single script shared by every pool (symmetric with the vault:
one script, one address, pool UTxOs distinguished by datum + thread NFT — D20/D11
logic). Three on-chain artifacts total no matter how many pools; no re-hash /
re-publish / new `successReceiver` address per pool. Consequence: pool identity must
live in the order datum — new field **`pool_nft`** (the pool's thread-NFT asset id,
N6 — one-of-one by construction, so the strongest identifier). Checks it anchors:
order Apply = "an input carrying my `pool_nft` is spent in this tx"; vault
ApplyOrders mirror = "every spent order's `pool_nft` equals MY thread NFT" (named
check `pool_scope`) — without which an ApplyOrders on vault X could consume orders
meant for vault Y and run X's accounting on them. Costs nothing with one pool;
frozen-datum logic says decide it now.

### D21 addendum · Harvest-priority sequencing (anti-snipe, executor policy) — 2026-07-18

When the compound trigger fires, **`RecordHarvest` jumps the per-pool vault-spend
queue: no ApplyOrders lands between trigger and harvest.** Rationale: deposits are
rate-neutral to each other (proportional mint), but a deposit applied just before a
harvest buys at the pre-harvest rate and captures a pro-rata slice of yield earned by
capital that farmed the whole accrual window — and with the trigger's weekly cadence
cap (D3), a harvest can be ~a week of pool yield, making the just-in-time snipe
(deposit large pre-harvest, redeem after, skim the jump on big notional) genuinely
attractive. Deposits-first ("no RecordHarvest while deposits pending") would
institutionalize it. Post-harvest application is also the fair direction for pending
redeems — they're paid the yield they actually sat through. Cost: quotes crossing a
harvest may miss `min_shares` → default tolerance sized above a max-accumulation
harvest; terminal-unsatisfiable deposits recover via the web's "Cancel & re-deposit"
flow (the filled leg already holds LP → retry is an LP-leg order, fresh quote, no
second batcher fee). **Necessarily executor policy, not a validator check** — a
validator sees only its own tx and cannot know pending order UTxOs exist; sequencing
is, however, publicly auditable from on-chain ordering (Tier-2/N5 envelope). Full
treatment when `compound-cycle.md` is written.

### D21 addendum · Order value handling — value-derived lp, pass-through payout — 2026-07-18

Two rules for what an order's VALUE means at Apply: **(1) `lp_i` is defined as the
amount of the pool's exact LP asset id in the order's value — never a datum claim**
(a datum-declared amount would let a lookalike-token order mint real shares; with the
value-derived definition, lookalikes yield lp=0 → miss their own `min_shares` →
inert). **(2) Everything in the value that isn't LP passes through to the payout**
— one generalized n4 equation `payout_i = order_value_i − lp_i×LP + shares_i×share`
covers shares, returning min-ADA, and any hand-crafted extras in the same tx.
Chosen over strict value-shape rejection (extras → cancellable-only) after working
the alternatives: absorbing extras into the vault has no exit (Rescue is
datum-fail-only) and invites token-dust minUTxO bloat of the long-lived vault UTXO;
strict rejection strands valid LP behind a full Cancel; pass-through is equal-or-
cheaper on-chain (the equation replaces strict's shape assertion PLUS the narrower
payout check), auto-returns extras, keeps the vault clean, and closes the
extras-to-executor-change leak. Executor filter still excludes orders whose riding
ADA can't fund their own payout minUTxO (left to Cancel). Honest path unaffected:
web orders and Minswap fills are {ADA, LP} by construction.

### D21 addendum · Vault-spend precedence order (generalizes harvest-priority) — 2026-07-23

Vault spends (`ApplyOrders` / `EnterFarm` / `ExitFarm` / `RecordHarvest`) can never
share a transaction — one tx spends the vault UTXO exactly once, with exactly one
redeemer — so per-pool serialization is physical (each vault tx chains off the
previous output); the only design freedom is queue order. Executor scheduler policy
(necessarily off-chain, like harvest-priority): **RecordHarvest (when triggered) →
ExitFarm + the ApplyOrders it unblocks → other ready ApplyOrders → EnterFarm.**

- Harvest first: unchanged anti-JIT-snipe rationale, plus two exit-side wins —
  queued redeemers are paid the yield they sat through, and the
  farm-withdraw-vs-harvest race on the position disappears.
- ExitFarm ranks ahead of ApplyOrders only as a *prerequisite*: it exists to
  unblock a specific `liquid?`-failed batch and runs as that batch's front half.
- EnterFarm is lowest priority system-wide: its trigger fires off an ApplyOrders
  landing, user-facing batches never wait on it, and the surplus computation must
  count eligible pending redeem orders before taking the surplus — otherwise an
  enter can manufacture a buffer miss for a batch about to fire
  (enter-exit-farm.md names the corollary).

## D22 · Off-chain structure — DEX adapters, shared/ package, blueprint as the bridge — 2026-07-18

Three structural rules for the TS side, decided before workflow docs start
referencing them:

**1. DEX adapters (executor).** Platform-specific construction lives behind an
adapter interface (`adapters/minswap_v2`, later `adapters/wingriders`):
`quoteLpOut`, `buildDepositOrder`, `buildHarvestTx`, `parseFill`, … — adapters
build platform-shaped txs/orders and return standardized shapes. Warranted because
the platforms differ at every layer: order contracts, datum shapes, batcher models
(licensed batchers vs agent-pushed), farm mechanics (co-sign API vs none).
**Hard rule: the D19 CBOR verifier sits OUTSIDE the adapter boundary.** Adapters
build; the independent verifier re-parses whatever any adapter produced against
pre-stated intent before the hot key signs. Verification inside an adapter would let
a compromised adapter (D19's exact threat) verify its own lies. Builders are
pluggable; the gate is not.

**2. `shared/` package (npm workspace — local, registry-free, compatible with the
D19 exact-pin discipline).** One implementation, consumed by web + executor, for
everything both must agree on exactly: datum codecs (`OrderDatum`/`VaultDatum`
build + parse), exchange-rate math (the floor-rounding share calcs — web preview
must match the validator bit-for-bit), config constants (`DEPOSIT_TTL`, `T_max`,
`margin`, `DEFAULT_TOLERANCE`, per-network addresses/policy ids). Motivating case:
deposit.md's deadline/tolerance floors are defined by executor behavior but enforced
by web validation — same constants, one source.

**3. Blueprint as the validators↔TS bridge.** Aiken can't import TS; `vault.ak`
stays the source of truth and the TS lib mirrors it. The honest link is the CIP-57
blueprint: `aiken build` emits `plutus.json` (validator hashes + datum schemas) —
`shared/` derives addresses and validates its datum shapes FROM that artifact, never
from hand-copied constants, so "validator changed, TS didn't" fails at build time,
not on mainnet. Drift beyond the schema level is caught by round-trip test vectors.

### D22 addendum · Adapters are cross-consumed (web + executor), not executor-scoped — 2026-07-26

Surfaced designing `docs/workflows/deposit.md`'s web-side function decomposition:
rule 1's original text scoped adapters as "DEX adapters **(executor)**" — wrong.
**Corrected: the web calls `adapter.quoteDeposit`/`adapter.buildDepositOrder`
directly**, for the user's own client-signed deposit order tx — N4 means users
sign their own order tx, so this path never routes through the executor at all.
The executor separately calls into the same adapter for its own compound-cycle
orders (the harvest→swap→add-liq sequence, `operations/compound_batch`) — so
adapters have two independent, unrelated callers, not one.

- **Practical implication:** `adapters/` (e.g. `adapters/minswap_v2`) needs to be
  its own cross-consumed workspace package, not nested under `executor/src/` —
  the web can't cleanly depend on executor-internal code. Not the SAME package
  as `shared/` either: different concern (DEX-specific construction vs. our own
  codecs/rate-math/config), so folding it into `shared/` would blur the D22 rule
  1/2 boundary rather than fix the scoping error.
- **The D19 CBOR-verifier hard rule is unaffected.** It still sits outside the
  adapter boundary and still only gates the *executor's* hot-key signing — the
  web's user-signed deposit tx never passes through it; the user's own wallet
  signature is that path's trust boundary, not a hot key, so there's nothing
  for the verifier to gate there.

## D23 · Compound via harvest absorb — HarvestDeposit order path, RecordHarvest demoted to alternate — 2026-07-23

**Decision:** the compound cycle's harvest re-entry runs through the SAME order
machinery as user deposits: the cycle's add-liquidity DEPOSIT order sets
`successReceiver` = our order validator with a **`HarvestDeposit`** order datum;
ApplyOrders absorbs the fill with harvest semantics — `total_lp` += value-derived
lp, `farmed_lp` untouched, mint = ONLY treasury fee shares
`t = floor(fee_bps × lp × S/L)` (fee-mint bound trivially satisfied), no user-style
share mint. The LP lands unfarmed (replenishes the redemption buffer — synergy with
the wait-for-deposits restore policy) and later enters the farm via the normal
EnterFarm skim. **RecordHarvest is demoted to the alternate shape**, kept as a
sketch only for the branch where the batcher dust test fails.

- **Why (surfaced designing compound-cycle.md, user-driven):** (1) pre-build,
  validator surface is design-time cheap NOW and migration-expensive later —
  validator capability has a one-way door at init; (2) the absorb adds ZERO new
  assumptions — the batcher-fills-script-receivers bet is the same single bit D21
  deposits already stand on (the batcher can't even distinguish the two: same
  receiver, datum contents are our business); (3) it SIMPLIFIES the system —
  value-derived ΔLP (gap-2 rule) dissolves the "what stops RecordHarvest lying"
  enforcement question (reference-input proposal + its dust item become
  RecordHarvest-branch-only), and the vault redeemer set shrinks by one if the
  test passes.
- **Costs accepted:** one extra EnterFarm crossing per cycle (~2 txs weekly); a
  third ApplyOrders action branch. (NOT a cost: the harvest-priority hold window —
  both shapes contain the same two batcher fills, the window is inherent to
  compounding, and the absorb tail is one tx shorter. An earlier draft of this
  entry miscounted that; corrected 2026-07-23.)
- **Swap topology (v1):** ONE swap, MIN → ADA, then single-sided add-liq (native
  to Minswap pools). MIN/ADA is the deepest MIN pool — swap-to-NIGHT would route
  through ADA anyway (two hops, two slippages). Topology is ADAPTER-level (D22):
  other venues may need two swaps + ratio math; the executor asks the adapter to
  "convert rewards → LP," full stop. Target-token evaluation parked in v2-ideas.
- **The one bit:** does the licensed batcher operationally fill third-party-script
  receivers? One dust test (top of week1-verify, stakes raised: it decides the
  deposit UX, the compound shape, AND the final redeemer set — final only at
  vault-init, which is deliberately sequenced last). Degraded world if it fails:
  deposits go two-step LP-only (pre-D21 shape), compound = RecordHarvest +
  direct stake. Pivot, not death: redemptions, farm machinery, and the vault
  never touch the batcher.
- Chained fills (swap fill → deposit order, executor address out of the loop) =
  v2-ideas. Cycle custody framing: window contains YIELD ONLY, ≤ one accumulation
  window (trigger ≥ 2× cycle cost, ≤ weekly) — principal never transits the cycle.

## D24 · THE ONE BIT RESOLVED — batcher fills third-party-script receivers — 2026-07-25

**RESOLVES D21/D23's open dust test.** Mainnet probe (real ADA, not preprod):
a Minswap V2 DEPOSIT order (5 ADA single-sided into the live ADA/MIN pool) with
`successReceiver` set to a throwaway owner-gated Plutus V3 script (NOT our real
order validator, which doesn't exist yet — a stand-in the batcher can't
distinguish from one, since it only ever sees a `ScriptCredential` + a datum
blob) was **filled by the licensed batcher in ~90 seconds**. Verified four ways
directly against chain state (not just an explorer summary): the order output
is spent; a new UTXO landed exactly at the script address; its inline datum
matches our submitted marker **byte-for-byte** (the actual proof, per
`EODInlineDatum`'s hash-check — not just "something arrived" but "this is
provably the fill of *our* order"); and the fill's originating tx is distinct
from our submission tx (a real third-party spend, not an artifact of our own
tx construction). 18,020,218 units of ADA/MIN LP + the 2 ADA fixed rider
landed at the receiver, matching predicted amounts exactly. Reclaimed cleanly
back to the test wallet afterward (owner-signed spend, confirmed on-chain).

- **Preprod attempt first (2026-07-24/25), inconclusive:** control (pubkey
  receiver) and probe (script receiver, `validators/always_true.ak`) orders
  both sat unfilled 20+ hours on preprod. Asked in the open Minswap Discord
  thread; MinTeam confirmed they can't vouch for preprod batcher reliability
  ("might have issues in development phase... less priority") — explains the
  null result without resolving the question. Escalated to a small real
  mainnet probe instead of a second preprod attempt, since the production
  batcher has no such excuse available.
- **Why probe-only on mainnet, no control:** unlike preprod, mainnet's batcher
  liveness was never in doubt — the disambiguating power a control buys
  (isolating receiver-type from "is anything running") wasn't worth spending a
  second real order on. Plan was: fire probe alone; only add a control if it
  sat unfilled and we needed to separate "receiver-type rejection" from
  "something's off with us." Never needed — it filled immediately.
- **This settles all three things D23 keyed to the bit:** (1) **deposit UX** —
  D21's chained any-mix one-signature path stands, no fallback to two-step
  LP-only; (2) **compound shape** — D23's HarvestDeposit absorb stands as
  primary, confirmed rather than merely argued; (3) **final vault redeemer
  set** — `RecordHarvest` is DELETED (not merely demoted) at vault-init; the
  reference-input-position enforcement question and its dust-cycle item (f)
  are moot.
- **Test artifacts:** built as disposable spikes (`executor/src/spikes/`,
  `validators/validators/always_true.ak` + `owner_gated.ak`), deleted after
  this entry was written — the on-chain result is the permanent record, not
  the harness that produced it. Mainnet probe tx:
  `fbe69b36a1a1b825bf797694a14d4c36a08d79981f03743b576533af94709584`; fill tx:
  `9d9c7442686d4f8c9bc838c5c230f547f673a30f7bb67cf82c10c9bb3676f75e`; reclaim
  tx: `6d32abc21c2d41a7b1173f01359f479e69f5d66c7d64baf97a8b1ed37a201aa7` —
  independently verifiable on any Cardano mainnet explorer, forever.
- **First real-money mainnet transaction of the project.** ~9.5 ADA locked,
  fully recovered (as ADA + LP) via reclaim; no loss beyond ordinary tx fees.

## D25 · Blockfrost/Lucid tooling gotcha — utxosByOutRef is spend-status-blind — 2026-07-25

**Discovered debugging the D24 dust test's polling script.** `lucid.utxosByOutRef()`
(SpaceBudz Lucid's Blockfrost provider) calls Blockfrost's `GET /txs/{hash}/utxos` —
which returns a transaction's outputs UNCONDITIONALLY, forever, regardless of
whether they've since been spent. Lucid's own source has an unresolved comment
admitting this (`// TODO: Make sure old already spent UTxOs are not retrievable.`).
**Never use it to check "is this output still live"** — a fill or any other spend
produces zero change in its result; a polling loop built on it can run forever
without ever detecting a real spend. Use `lucid.utxosAt()` (Blockfrost
`GET /addresses/{addr}/utxos`) instead — that endpoint only returns currently-
unspent outputs and is the correct primitive for spend detection.

- **Relevant to the future `chain/indexer`:** any fill/order-state detection logic
  (has this deposit/redeem/HarvestDeposit order been filled yet?) must be built on
  live-address UTXO queries, never per-tx-hash historical output lookups, or it
  will silently never observe a spend — exactly the bug that produced a false
  "still pending" reading during the D24 dust test (caught only because a direct,
  multi-point on-chain check was run instead of trusting the polling script).
- **Secondary gotcha, same investigation:** the vendored SDK's example/reference
  MIN token constant (`e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72`,
  `reference/sdk/examples/build-tx-example.ts`) is Minswap's **TESTNET** faucet-
  token policy — confirmed by cross-referencing `reference/sdk/src/types/constants.ts`,
  where it's scoped under `NetworkId.TESTNET` alongside `tDJED`/`tiUSD`/`tUSDC`/
  `tUSDT`. Easy to mistake for real mainnet MIN if an SDK example is reused for
  mainnet work without checking network scoping. Real mainnet MIN policy ID:
  `29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6` (verified via
  Cardanoscan 2026-07-25 — cross-check the raw hex length, 56 chars/28 bytes; a
  web-search prose summary of the same page silently truncated it to 55).

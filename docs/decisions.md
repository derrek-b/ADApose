# Design Decisions & Findings

Running log — date each entry. Sources in `../reference/` where vendored.

---

## D1 · Per-user vault UTXOs (not shared/share-token vault) — 2026-07

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

**Preferred design if YES:** per-user vault UTXOs + ONE script-owned aggregated farm
position per pool (custody isolation where it matters, cost aggregation where the
harvest fee lives — saves ~0.5–0.7 ADA/user/cycle).
**Fallback if NO:** executor-keyed aggregate farm position + validator-enforced
accounting; custody trade-off disclosed, mitigate via timelock/multisig recovery.

## D7 · Toolchain — 2026-07

Aiken (validators + unit tests) · Lucid Evolution (tx building; Minswap SDK itself
depends on lucid) · @minswap/sdk · Blockfrost or Maestro (Maestro notable: also does
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

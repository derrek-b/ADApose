<!-- Source: validators/validators/vault.ak -->
# Workflow: User Deposit

**Path:** user wallet → (Minswap DEPOSIT order for raw assets ‖ direct order UTXO for
LP) → order UTXO at our order validator → executor `ApplyOrders` batch → share tokens
in user wallet.
**Decisions:** D21 (deposit path), D20 (pooled design), D20-N (invariants), D19
(signing gate), D10 (rescue precedent). Evidence tags per `README.md` —
✅ verified / ⚠️ unverified.

## What the user deposits (D21)

**Any mix of {NIGHT, ADA, NIGHT/ADA LP} in one signature.** The vault's unit of
account is LP, and shares can only be priced against a known LP amount — so raw
assets must become LP *before* our order is applied, without our exchange rate or the
executor carrying the conversion gap. The mechanism: chain a **Minswap V2 DEPOSIT
order** (imbalanced/single-sided native — one order type covers NIGHT-only, ADA-only,
any ratio ✅ `reference/sdk/src/types/order.ts:579,793`) whose `successReceiver` is
**our order validator** and whose `successReceiverDatum` is our deposit datum.
Minswap's own validator forces any fill to deliver the LP to our address with our
exact datum inline (✅ `reference/minswap-amm/order_validation.ak:1185–1215`) — the
conversion gap is carried by Minswap's infrastructure, validator-enforced.

LP tokens can't ride that order (it mints LP from assets), so an LP deposit is a
direct order UTXO at our validator — one extra output in the same signed tx, not a
separate flow. Unrelated tokens (e.g. MIN) are out of scope for Phase 1 (D21).

## Components touched

| Component | Role in this flow |
|---|---|
| `web/` (Mesh CIP-30 + Lucid + @minswap/sdk) | wallet connect, rate preview, order-tx build + user-sign |
| Blockfrost | vault datum read (rate preview), order submission, executor indexing |
| **Minswap V2 order validator + licensed batcher** | asset leg: fills the DEPOSIT order, delivers LP + our datum to our order validator (fill shape on-chain enforced) |
| **Order validator** (on-chain, new) | holds the order UTXO; Cancel (canceller-authorized) / Apply (with vault, NFT-anchored) / Rescue (cast-failure only) |
| `executor/chain/indexer` | discovers + filters order UTxOs |
| `executor/operations/` (batcher) | assembles + builds the ApplyOrders tx |
| **Vault validator** `ApplyOrders` | enforces N1/N3/N4/N6 + pool_scope on the batch |
| **Share mint policy** | mints shares, delegation-by-presence to the vault spend |
| CBOR verifier (D19) | gates the hot-key signature on the batch tx |

## Step A — user places the order(s) (web, one signature)

1. **Connect** wallet via Mesh CIP-30; get payment address.
2. **Read vault state:** `GET /addresses/{vault_addr}/utxos` (Blockfrost). Returns per
   UTXO: `tx_hash`, `output_index`, `amount[] {unit, quantity}`, `inline_datum` (CBOR
   hex) — ✅ exercised throughout the D16/D19 research sessions. The authentic vault
   UTXO is the one carrying the pool's **thread NFT (N6)** — never "whatever sits at
   the address"; parse `{pool_id, total_shares, total_lp, farmed_lp, share_asset}`.
3. **Read pool state** (asset leg only): current reserves via the SDK's pool reads, to
   quote expected LP for the deposited amounts and set the Minswap-side `minimumLP`
   slippage bound.
4. **Preview:**
   ```
   -- LP leg:   lp_known   = lp_in                            (exact)
   -- asset leg: lp_bound  = minimumLP                        (Minswap slippage floor)
   shares_est_leg = floor(lp * total_shares / total_lp)       -- N3 preview matches chain
   min_shares_leg = floor(shares_est_leg * (1 - tolerance))   -- into each order datum
   ```
   `min_shares` for the asset leg is computable at signing time *because* the Minswap
   step carries `minimumLP` — the LP amount is bounded before the fill happens.

   **Rate-neutrality of deposits (why queued deposits can't hurt each other):** every
   applied order mints `floor(lp_i × total_shares / total_lp)` — numerator and
   denominator of the exchange rate grow in exact proportion, so LP-per-share after
   ApplyOrders == before (up to dust remainders, which N3 sends the pool's way). Any
   number of pending zap-ins can land ahead of a user without touching their quote —
   same reason buying into a mutual fund doesn't move its NAV. The ONLY event that
   moves the rate between quote and apply is `RecordHarvest` (raises LP-per-share →
   lowers shares-per-LP). Per-harvest movement is bounded by the max accumulation
   window (trigger fires at ≥2× cycle cost but is also capped to ~weekly cadence —
   D3), so worst case ≈ one week of pool yield.

   **Tolerance policy — config default + dynamically computed floor (twin of the
   deadline policy, Step B).** The threat is one knowable quantity: rewards accrued
   but not yet harvested at quote time — the same data the compound trigger watches:
   ```
   pending_jump  = accrued-unharvested rewards as % of total_lp   -- read at quote time
   accrual_drift = emission_rate × DEPOSIT_TTL as % of total_lp   -- growth while order lives
   tolerance_floor = pending_jump + accrual_drift + buffer

   quoted tolerance = max(DEFAULT_TOLERANCE, tolerance_floor)
   ```
   A harvest between quote and apply moves the rate by exactly the pending amount at
   that moment — quote against it and a compound CANNOT break the floor. Config-only
   would bet on an APR regime (pool runs hotter than the estimate → every pre-harvest
   quote goes DOA); dynamic-only just needs `DEFAULT_TOLERANCE` (~1%) as an ambient
   floor for freshly-harvested pools. User override allowed (advanced), but web warns
   below `tolerance_floor`: "this floor may not survive the next compound." One
   function, two consumers: the same pending-rewards read powers the trigger-imminent
   warning (Step C). ⚠️ precision of reading pending farm rewards off-chain is
   unverified (Minswap emission accounting reproducibility — confirm in the D19 dust
   cycle); the buffer absorbs approximation error.
5. **Build ONE tx** with up to two order outputs plus the datum-registration output:

   **Asset leg (NIGHT and/or ADA, any ratio)** — via `@minswap/sdk` `createOrdersTx`
   with the `customReceiver` option (✅ first-class, `reference/sdk/src/dex-v2.ts:31`):
   ```
   step:            DEPOSIT { depositAmountA, depositAmountB, minimumLP, killable }
                    -- one side may be 0; imbalanced native, no separate zap step ✅
   canceller:       user (signature method)
   successReceiver: POMONA_ORDER_VALIDATOR_ADDR
   successReceiverDatum: INLINE_DATUM(our deposit datum)   -- SDK hashes it into the
                    order and adds a preimage-carrying output automatically
                    (buildUtxoToStoreDatum ✅ utils/tx.internal.ts)
   refundReceiver:  user address                           -- kill/refund bypasses us
   maxBatcherFee:   2 ADA flat (D5 ✅)
   ```
   On fill, Minswap's pool batching validator *forces* the LP output to our address
   with our exact datum inline — `validate_order_receiver`, script receivers explicit
   (✅ `reference/minswap-amm/order_validation.ak:1196`).

   **LP leg (if the user holds LP)** — direct output, SpaceBudz Lucid pattern ✅
   (`reference/sdk/src/dex-v2.ts:876`):
   ```
   .payToContract(POMONA_ORDER_VALIDATOR_ADDR,
     { Inline: DataObject.to(depositDatum) },
     { lovelace: minUTxO, [lpUnit]: lp_in })
   ```

   Both legs carry the same datum shape: `{ pool_nft, canceller, payout, action:
   Deposit, min_shares, deadline }` (D21 addenda). `pool_nft` is the pool's thread-NFT
   asset id (N6) — the order validator is ONE script for all pools, so pool identity
   must live in the datum; it scopes the order to exactly one vault. `canceller` is an authorization method —
   `Signature(pkh) | SpendScript(hash)` — because an address can't sign: script-based
   wallets (multisig/shared) have no key to match, and a signature-only Cancel would
   brick their orders (N4 violation). `payout` is the **full address** (payment +
   stake credential) so shares land with the user's stake rights intact. This is
   Minswap's own proven split (`canceller`/`successReceiver` ✅ vendored
   `order_validator.ak`). Web sets `canceller` = Signature(connected wallet),
   `payout` = connected wallet address. ⚠️ minUTxO per order output ~1.2–1.5 ADA
   (size-dependent) — measure in emulator; it rides along and returns with the shares.
6. **Sign + submit** via the wallet — one signature covers both legs.

**Failure branches (A):**
- Vault UTXO not found / datum unparseable → UI hard-stops. Never fall back to a
  cached or off-chain rate (N1 applies to previews too — a wrong preview sets a wrong
  `min_shares`).
- Wallet rejects / insufficient funds → normal wallet UX, nothing on chain.
- **Asset leg killed by Minswap** (pool moved past `minimumLP`, `killable` set) →
  refund pays `refundReceiver` = the user directly; we never see it. Web surfaces
  "deposit partially refunded — retry?".
- **Asset leg never fills** (batcher outage/policy) → user cancels the Minswap order
  under Minswap's own rules (`canceller` = user; expired orders also
  anyone-cancellable back to the user ✅ `CancelExpiredOrderByAnyone`,
  `reference/minswap-amm/order_validator.ak`). Funds never depend on Pomona liveness.
  ⚠️ whether the licensed batcher fills third-party-script-receiver orders at all is
  the one open operational question (D21) — preprod dust test pending.
- **Mixed deposit** → two orders, but the executor applies them TOGETHER
  (sibling-hold policy, Step C): the LP leg is held until the asset leg's fill
  arrives, then both apply in one batch at the same rate — one credit event.
  Escape hatch: sibling killed/refunded or hold timeout → apply the LP leg alone.
  UI shows one pending item that can degrade to two.

## Step B — order lives on chain (N4 zone)

An asset-leg deposit passes through two custody zones, each with its own
user-unilateral exit: first **Minswap's order** (canceller = user, refunds to user),
then — after fill, typically a block or two — **our order UTXO**. The LP leg starts in
zone two directly.

**Deadline policy — config with a dynamic anchor, never dynamically computed.** Web
sets `deadline = now + DEPOSIT_TTL` (config constant, order of hours;
user-overridable as an advanced setting). It doesn't react to network conditions
because the economic protection is `min_shares` — however late an order applies, it
can't apply below the user's floor; `deadline` only bounds intent staleness, which is
a preference, not a market variable. Three clocks must order correctly (all config):

```
MINSWAP_EXPIRY   (their expiry_setting, optional)   -- bounds the fill phase
T_max + margin   (executor batch policy, Step C)    -- bounds our phase
DEPOSIT_TTL      (our datum deadline)               -- bounds the whole journey

rule 1:  DEPOSIT_TTL > MINSWAP_EXPIRY + T_max + margin
         -- a fill arriving at the last Minswap moment still gets a full batch window;
         -- if Minswap expires unfilled, CancelExpiredOrderByAnyone refunds the user
         -- and our order never materializes — clean
rule 2:  web REFUSES deadline < min_deadline = MINSWAP_EXPIRY + T_max + margin
         -- (LP-only deposits drop the MINSWAP_EXPIRY term)
```

Rule 2 is user protection, not polish: a deadline shorter than one batch cycle +
margin creates an order that is **born unappliable** — the executor's deadline-margin
rule excludes it forever, and the user paid the tx fee (+ 2 ADA batcher fee on the
asset leg) for a guaranteed no-op ending in Cancel. Note `T_max`/`margin` are executor
behavior but define the web's validation floor — shared config source, not duplicated
magic numbers (remember when `web/` is scaffolded).

The order UTXO at our validator is spendable exactly three ways:

- **Cancel** — `canceller` authorized (Signature: pkh in extra_signatories;
  SpendScript: a script-owned input in the tx), no other condition. Anytime,
  including after deadline. This is the user's only recovery path and it must never
  depend on executor liveness (N4).
- **Apply** — valid only if an input carrying this order's `pool_nft` (the thread
  NFT, N6) is spent in the same tx (delegation-by-presence, NFT-anchored). The order
  validator itself stays dumb; the vault validator does the accounting checks.
- **Rescue** — treasury-signed, reachable ONLY when the datum is missing or fails to
  cast to `OrderDatum` (D10 model, D21 addendum). Never touches a well-formed order;
  recovery is "at treasury discretion" (N5 wording), the backstop for frontend
  serialization bugs on the asset leg.

Deadline semantics: `ApplyOrders'` tx validity range must end **before** every spent
order's `deadline`. Expired orders are simply never applied; the user reclaims via
Cancel (web shows a "reclaim" button). The executor never gains a recovery power.

**Failure branches (B):**
- Order lands with malformed/missing datum → Cancel and Apply both fail at the datum
  cast → **Rescue** (above) is the recovery path. Datums that cast but hold nonsense
  values are NOT rescue-eligible — they Cancel normally; the executor just never
  applies them.
- Datum-**by-hash** output whose preimage was never posted → unspendable by protocol
  (the ledger demands the preimage before any validator runs); no rescue possible.
  Policy: we only ever emit inline datums (Minswap fills are forced inline by
  `EODInlineDatum`).

## Step C — executor discovers + filters

1. Indexer polls `lucid.utxosAt(orderAddress)` (✅ same call the SDK's own
   `expired-order-monitor.ts:104` uses) or raw Blockfrost equivalent, on the
   scheduler tick. Minswap-delivered orders (asset leg) are indistinguishable from
   direct LP deposits at this point — same address, same datum shape, LP in the
   value — so everything downstream is one code path.
2. Per order, filter to **eligible**:
   ```
   parses?          datum casts to OrderDatum, else ignore (Rescue territory)
   funded?          value[lpUnit] > 0 and consistent with Deposit action
   fresh?           deadline > now + BATCH_LATENCY_BUFFER (build+submit+settle margin)
   satisfiable?     floor(value.lp * total_shares / total_lp) >= min_shares at current datum rate
   ```
   Unsatisfiable-but-valid orders are skipped, never spent-and-refunded — spending
   without applying is exactly the cherry-pick surface n4_ tests must kill. For
   DEPOSITS, unsatisfiable is effectively terminal (compounds only ever lower
   shares-per-LP, so a missed floor never recovers) — the UI's recovery flow is
   **"Cancel & re-deposit"**: a filled asset leg's order holds LP already, so the
   retry is an LP-leg order — no second batcher fee, no second slippage, no Minswap
   latency — placed with a FRESH quote. (Two txs: the new order spends what Cancel
   releases. Users wanting raw assets back instead do a Minswap withdraw-liquidity
   outside us — UI hint, not our flow.)
   Deposits can only arrive DOA two ways, both mitigable web-side:
   (a) ~zero tolerance crossing a `RecordHarvest` — default tolerance sized above a
   max-accumulation harvest (Step A) fixes the default case; (b) stale quote — user
   parks the preview, signs an old `min_shares`; web must RE-QUOTE at the moment of
   signing, and can warn when the compound trigger is near firing (derivable from
   public chain data). Other users' pending deposits can never be the cause
   (rate-neutrality, Step A).
3. **Sibling tracking (mixed deposits):** both legs are born in the same user tx, and
   that tx visibly contains the Minswap order with `successReceiver` = us — so the
   indexer knows at placement time that a fill is inbound. Policy: HOLD the LP-leg
   order for its sibling; release together in one batch (one credit event, same
   rate for both). Escape hatch: sibling killed/refunded (watch `refundReceiver`
   payout) or hold exceeds a timeout → apply the LP leg alone. Pure executor policy —
   nothing on-chain, can even be a UI toggle.
4. **Batch trigger (nothing on-chain fires ApplyOrders — scheduler policy):** each
   tick (~20–60s) over the eligible set, batch NOW if any of:
   ```
   count(eligible) >= K              -- amortize the tx fee across orders
   age(oldest)     >= T_max          -- nobody waits forever behind a thin batch
   min(deadline) - now <= margin     -- apply while the validity window still fits;
                                        orders INSIDE the margin are excluded (Cancel
                                        is their recovery), never rush-applied
   ```
   Demo tuning collapses to "fire whenever anything is eligible." Constraint that
   survives all tuning: ONE vault spend in flight per pool — ApplyOrders shares a
   serialized queue with EnterFarm/RecordHarvest (see failure branches D/E).
   **Priority inside that queue (harvest-priority sequencing, D21 addendum):** when
   the compound trigger fires, `RecordHarvest` jumps ahead — NO ApplyOrders lands
   between trigger and harvest. Deposits-first would let just-in-time depositors buy
   at the pre-harvest rate and skim yield earned by the accrual window's farmed
   capital (the JIT harvest snipe); post-harvest application also pays pending
   redeems the yield they actually sat through. Necessarily executor policy — the
   validator can't see pending order UTxOs — but ordering is publicly auditable on
   chain (Tier-2/N5). Full treatment in `compound-cycle.md`.
5. Batch up to `MAX_ORDERS_PER_BATCH` — ⚠️ unmeasured against the 16KB/14M-mem/10B-step
   limits; already a `week1-verify.md` cost-model item.

## Step D — the ApplyOrders transaction

```
inputs:   vault UTXO            redeemer ApplyOrders
          order UTxOs (1..n)    redeemer Apply
outputs:  vault' UTXO           value += Σ lp_i
                                datum: total_lp += Σ lp_i, total_shares += Σ shares_i
          per order i:          { shares_i × share_asset, order's minUTxO ADA } → payout_i
mint:     share_policy: +Σ shares_i
validity: upper bound < min(deadline_i)
signers:  executor hot key
```

Batch pricing (proposed): **all orders in one batch price at the uniform pre-batch
rate** `(total_shares, total_lp)` — order-independent, no intra-batch sequencing to
verify on-chain, and house-favored rounding applies per order. → **Open point 3.**

Vault validator checks, by invariant name (each becomes a named check + `aiken check
-m nX_` test):

| Check | Enforces |
|---|---|
| `n1_totals` | `total_lp' = total_lp + Σ lp_i` and `total_shares' = total_shares + Σ shares_i`, deltas computed only from datum + spent-order values; vault output value delta equals Σ lp_i exactly (no leak to executor) |
| `n3_round_down` | each `shares_i = floor(lp_i * total_shares / total_lp)` — floor, never round/ceil |
| `pool_scope` | every spent order's `pool_nft` equals MY thread NFT — cross-pool orders can't leak into this batch (pairs with N6) |
| `n4_full_service` | every spent order's owner receives exactly `shares_i` + its min-ADA back at `payout_i`; `shares_i >= min_shares_i`; validity range beats every deadline |
| mint gate | share policy: mint amount == Σ shares_i and vault UTXO spent in same tx |

## Step E — executor build, verify, sign, submit

```
tx = lucid.newTx()
  .collectFrom([vaultUtxo], ApplyOrders)          -- ✅ collectFrom w/ redeemer: dex-v2.ts:324
  .collectFrom(orderUtxos, Apply)                 -- ✅ same pattern, list form: dex-v2.ts:933
  .readFrom([vaultRefScript])                     -- ✅ ref-script pattern: dex-v2.ts:999
  .payToContract(vaultAddr, {Inline: newDatum}, newVaultValue)
  .payTo(payout_i, {shares_i, minUTxO_i})  for each order
  .mintAssets({share_asset: Σ shares_i}, MintApply)
  .validTo(min(deadline_i) - MARGIN)
```

**Before signing — the D19 gate, no exceptions even for self-built txs:** the
independent verifier re-parses the raw CBOR and asserts the pre-stated intent:
vault-out datum deltas match Σ of order inputs; every order owner paid their exact
entitlement; mint total == Σ shares; no output pays the executor beyond change;
fee within bound. Verifier rejects → **fail closed**: drop the tx, alert, never
"fix and retry-sign" in the same cycle.

Then sign with the hot key, `submit()`, await confirmation depth `K` before the
indexer marks orders applied.

**Failure branches (D/E):**
- **User cancels mid-build** — an input order is spent before our submit → whole batch
  tx rejected (spent input). Recovery: re-derive UTXO set, rebuild without it, re-verify,
  resubmit. This is the *expected* contention mode; only the executor ever spends the
  vault, so vault-side contention with third parties doesn't exist.
- **Rollback** past the ApplyOrders tx → indexer state re-derives from chain tip;
  orders reappear as pending; batch rebuilds. No off-chain ledger to reconcile — the
  chain is the only state (N1's off-chain twin).
- **A compound lands between rate-read and submit** — impossible by construction:
  RecordHarvest also spends the vault UTXO, so whichever lands first invalidates the
  other; the loser rebuilds at the new datum. Executor must serialize its own
  vault-spending ops (one in flight per pool).
- **Blockfrost down** → batching pauses; user funds unaffected (orders cancellable
  without us — N4/N5 story holds).

## Open design points surfaced by this doc

1. ~~**`total_lp` must join the datum.**~~ **RESOLVED 2026-07-18** — D20 addendum:
   `total_lp` (vault-held + farmed) is the exchange-rate numerator; `farmed_lp` is
   the farm-custody sub-ledger. vault.ak updated.
2. ~~**Order-validator rescue path.**~~ **RESOLVED 2026-07-18** — D21 addendum:
   Rescue as a third spending path, treasury-signed, reachable only on datum cast
   failure (exact D10 model, unconstrained spend). Inline-datums-only emission policy;
   by-hash-with-lost-preimage is unspendable by protocol, no rescue possible.
3. **Uniform pre-batch rate** for all orders in a batch (proposed above) — simplest
   on-chain check; confirm no adverse interaction in mixed deposit+redeem batches
   when redeem.md is written.
4. ~~**`owner_addr` as full address.**~~ **RESOLVED 2026-07-18** — D21 addendum:
   split into `canceller: AuthMethod` (Signature | SpendScript — Minswap's proven
   pattern; an address can't sign, and signature-only Cancel bricks script wallets)
   + `payout: Address` (full address, stake rights intact). vault.ak sketch updated.
5. ~~**v1 deposit asset = LP tokens only.**~~ **SUPERSEDED 2026-07-18 by D21** — any
   mix of pool assets + LP in one signature via chained Minswap DEPOSIT order with
   `successReceiver` = our order validator (on-chain-enforced delivery, verified from
   source). One open operational question remains: does Minswap's licensed batcher
   fill third-party-script-receiver orders in practice? → preprod dust test
   (week1-verify).

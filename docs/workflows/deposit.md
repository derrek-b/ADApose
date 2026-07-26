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

## Web-side function decomposition (adapter boundary)

Step A's client-side work splits across a small function set, chosen so
DEX-specific mechanics never cross the `adapters/` boundary (D22) — full
Minswap-vs-WingRiders field comparison behind this shape lives in
`docs/dex-adapters.md`.

| Function | Owns |
|---|---|
| `connectWallet()` | Mesh CIP-30 handshake |
| `readVaultState(poolKey) → {poolNft, totalShares, totalLp, farmedLp, shareAssetUnit, poolId}` | web-local wrapper: config lookup + `utxosAt` + filter by `threadNftUnit` — no DEX involved |
| `parseVaultDatum(cborHex) → {poolId, totalShares, totalLp, farmedLp, shareAssetUnit}` — **`shared/` (D22)** | pure decode, no I/O — what `readVaultState` calls once it has the right UTXO; also the executor's indexer parses this exact shape |
| `adapter.quoteDeposit({amountA, amountB, dexSlippagePct}) → {expectedLP, minimumLP}` | DEX-specific pricing math (Minswap's virtual-swap quadratic, WingRiders' zap-in solve) plus the DEX-side slippage haircut, hidden behind two opaque numbers — see below |
| `previewShares({lpAmount, vaultState}) → shares` — **`shared/` (D22)** | pure N3 rate conversion, DEX-agnostic, must match the validator bit-for-bit — also used by the executor's `ApplyOrders` batch pricing (Step D) |
| `resolveTolerancePct({vaultState}) → tolerancePct` — **`shared/` (D22)** | the dynamic tolerance-floor policy — one function, two consumers: the deposit floor calc below AND Step C's trigger-imminent warning |
| `resolveDeadline({hasAssetLeg, userOverrideHours?}) → deadline` | web-local — `now + DEPOSIT_TTL`, floor-validated against the executor's own batch-wait window so an order can't be born unappliable — Step A #4 below. Not `shared/` itself (nothing else *computes* a fresh deposit deadline), but consumes config constants (`DEPOSIT_TTL`, `T_max`, `margin`) that do live in `shared/` (D22) |
| `adapter.buildDepositOrder({amountA, amountB, minimumLP, receiverAddress, receiverDatum, deadline}) → Order[]` | DEX-specific order/request construction — see below |
| `encodeOrderDatum({pool_nft, canceller, payout, action, min_shares, deadline}) → Data` — **`shared/` (D22)** | pure encode, no I/O — produces the `receiverDatum` both `buildDepositOrder` (asset leg) and `buildLpLegOutput` (LP leg) attach; the executor's indexer holds the inverse (`parseOrderDatum`, same codec module) to discover orders (Step C) |
| `buildLpLegOutput({lp_in, datum}) → OutputSpec` | web-local wrapper: minUTxO calc + calls `encodeOrderDatum` + assembles the full output — no DEX involved, always one output |
| `assembleDepositTx({assetLegOrders?, lpLegOutput?, deadline}) → unsigned tx` | combines whatever came back into the one signed tx from Step A #5 — throws if both legs are absent, see below |
| `signAndSubmit(tx) → txHash` | — |

**`readVaultState` is a thin web-local wrapper around a shared codec, not one
monolithic function.** Split the same way as `previewShares`/
`resolveTolerancePct`, for the same reason: the *decode* step
(`parseVaultDatum`) has an independent consumer (the executor's indexer
parses this exact shape too, and it must match bit-for-bit — D22 rule 2) and
is pure/environment-agnostic, so it belongs in `shared/`. The *I/O* around it
is legitimately different per side — web wants a one-shot preview read, the
executor's indexer wants D25's two-tick confirmation discipline — so it stays
local rather than growing options only one caller ever uses. `readVaultState`
takes a `poolKey`, not zero args: D11 puts every pool of a DEX at the same
validator address, so `utxosAt` alone is ambiguous once there's more than one
pool — the function resolves `poolKey → {threadNftUnit, vaultAddress}` from
durable per-pool config (mechanism TBD — `vault-init.md`'s "Pool-registry
recording" open question; doesn't block this interface, see below), fetches
`utxosAt(vaultAddress)`, filters to the UTXO whose value carries exactly one
unit of `threadNftUnit` (N6 — never "whatever sits at the address"), then
calls `parseVaultDatum` on that UTXO's inline datum. Every return field earns
its place: `poolNft` gets echoed into the
deposit order's own datum (`pool_nft`) so `ApplyOrders` can later verify
delegation-by-presence; `totalShares`/`totalLp` are `previewShares`'s entire
rate-math input (N1); `shareAssetUnit` is display-only (labeling the preview —
shares are minted by the executor, not the web, so it's not required for tx
construction); `poolId` feeds `adapter.quoteDeposit` (which Minswap pool to
read reserves from). `farmedLp` is returned but unused in pricing (only
`total_lp` is the rate numerator, D20 addendum) — kept for a possible
"currently farming" UI display.

**Split into `previewShares` (pure) + `resolveTolerancePct` (separate), not
one `computePreview`.** Earlier sketches bundled both into one function, with
`minimumLP` as a *return* value — wrong on two counts. `minimumLP` is
DEX-specific (the adapter's job, via `quoteDeposit`), and genuinely
*consumed* by the rate math (Step A #4: `shares_est = floor(lp × total_shares
/ total_lp)`, where `lp` is the figure being priced), so it belongs as an
input, not an output. And tolerance-resolution already has two unrelated
consumers (the deposit floor below, and Step C's trigger-imminent warning) —
bundling it into a shares-preview function would force Step C to call into
shares math just to get a percentage, or fork a duplicate resolver:
```
previewShares({ lpAmount, vaultState }) → shares      -- pure N3 rate conversion, nothing else
resolveTolerancePct({ vaultState }) → tolerancePct     -- dynamic-floor policy, shared with Step C
```
`lpAmount`, not `minimumLP`, because the LP leg passes `lp_in` (exact, no
slippage concept at all) through the identical formula — a leg-agnostic name
avoids implying every call is a protected minimum. Two calls per asset-leg
deposit, tolerance applied inline only where it's actually needed:
```
display      = previewShares({ lpAmount: expectedLP, vaultState })                             -- "approximately X shares" — realistic case, no haircut
tolerancePct = resolveTolerancePct({ vaultState })                                              -- or a user override
floor        = floor(previewShares({ lpAmount: minimumLP, vaultState }) * (1 - tolerancePct))   -- "minimum Y shares" — this min_shares is what goes in the order datum
```
The LP leg only ever needs the `floor` form, called once with `lpAmount:
lp_in` — there's no fill uncertainty on that leg, so there's nothing to
optimistically estimate separately.

**DEX-side slippage policy (config default + user override — twin of the
tolerance policy above, not the same threat).** `minimumLP` protects the
*asset leg* against the Minswap **pool's** price moving between quote and
fill (other trades landing first) — a different risk than `tolerance`, which
protects against **our own vault's** rate moving between quote and apply
(only ever caused by a `RecordHarvest`/`HarvestDeposit` landing in between).
Unlike `tolerance`, this one has no clean dynamic formula: the tolerance
floor works because the threat is self-caused, bounded (compound cadence
capped ~weekly, D3), and directly readable (pending rewards, right now); DEX
price movement is third-party-caused, unbounded, and not directly
observable — a real estimate would need historical volume/volatility plus a
fill-latency model we don't have good priors for (this session's own dust
test alone saw fills anywhere from ~90 seconds to 20+ hours). Even Minswap's
own SDK treats this as a plain caller-supplied number
(`calculateAmountWithSlippageTolerance`, `reference/sdk/src/calculate.ts:106`)
with no volatility signal built in. v1: a `DEFAULT_DEX_SLIPPAGE_PCT` config
constant (same tier as `DEFAULT_TOLERANCE`, D22's `shared/`), user-overridable
(advanced setting), same as `tolerance`. The percentage is DEX-agnostic
config; *applying* it to produce `minimumLP` stays adapter-owned (Minswap via
the SDK call above; WingRiders would need its own version of the same
haircut — no off-chain library does it there either, `docs/dex-adapters.md`).

**`buildDepositOrder` returns `Order[]`, not a single order.** `type Order =
{ outputs: OutputSpec[] }`. Minswap always returns exactly one entry (its order
output, plus — when the receiver is a script — a datum-preimage output the SDK
auto-adds; that's plumbing inside one order, not a second order). WingRiders
may need two independently-fillable requests for a two-sided imbalanced
deposit (WingRiders' AddLiquidity only auto-swaps a *single-sided* deposit —
`docs/dex-adapters.md` has the on-chain evidence). `assembleDepositTx` just
does `orders.flatMap(o => o.outputs)` — it never branches on which DEX
produced the list or why it has one entry or two. Decided now, while it costs
nothing, so a future WingRiders adapter doesn't force a breaking change to
this interface later — not because WingRiders is being built now (D20 scopes
Phase 1 to Minswap only).

**`buildLpLegOutput` splits the same way, around `encodeOrderDatum`.** The
*encode* step has two consumers that have nothing to do with each other and
nothing to do with the LP leg specifically: `buildDepositOrder`'s asset leg
also needs an encoded `receiverDatum` to hand Minswap's `customReceiver`
option, and the executor's indexer needs the inverse (`parseOrderDatum`) to
discover orders at all (Step C: "parses? datum casts to `OrderDatum`"). One
codec module, `shared/`, both directions — matches D22 rule 2's `OrderDatum`
example exactly. `buildLpLegOutput` itself stays web-local: it computes the
LP leg's minUTxO, calls `encodeOrderDatum`, and assembles the final Lucid
output — none of that has a reason to live anywhere else.

**`assembleDepositTx`: both legs optional, but not both absent.** "What the
user deposits (D21)" already covers three shapes — asset-only, LP-only, or
mixed — so `assetLegOrders` was under-specified as required; a user who
already holds LP has no reason to touch Minswap at all, meaning there's
nothing for `adapter.buildDepositOrder` to produce and no asset leg exists.
Both params are optional; the only real constraint is that at least one must
be present. **Checked in two places, not one:** the UI won't let a user
submit an empty deposit form, but `assembleDepositTx` throws if both are
absent anyway rather than trusting the caller — not a security boundary
(this is off-chain, nothing adversarial rides on it), just correctness:
called with both absent, this function would otherwise silently emit a tx
with no deposit-related outputs at all, which is a real bug class (something
upstream miscounted legs) worth failing loudly on rather than producing a
pointless transaction.

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
   **Bootstrap precondition:** all of this math divides by `total_lp` — on a
   freshly-inited pool both totals are whatever the N2 dead-shares scheme set them to
   (open question in `vault-init.md`). First-deposit quoting is undefined until that
   scheme is fixed; expect to hit this on emulator day one.

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
   deadline policy below).** The threat is one knowable quantity: rewards accrued
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

   **Deadline policy — config with a dynamic anchor, never dynamically computed
   (`resolveDeadline`).** Web sets `deadline = now + DEPOSIT_TTL` (config constant,
   order of hours; user-overridable as an advanced setting). It doesn't react to
   network conditions because the economic protection is `min_shares` — however
   late an order applies, it can't apply below the user's floor; `deadline` only
   bounds intent staleness, which is a preference, not a market variable. Three
   clocks must order correctly (all config):
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
   magic numbers (`shared/`, D22).
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
   must live in the datum; it scopes the order to exactly one vault. `canceller`
   is an authorization method —
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
  ✅ **RESOLVED 2026-07-25 (D24)** — the licensed batcher DOES fill
  third-party-script-receiver orders, confirmed via a real mainnet probe (not
  just source-verified). This failure branch is now a genuine edge case
  (outage/policy), not a standing open question — but the recovery path holds
  regardless: deposits degrade to two-step (user zaps to LP on Minswap
  themselves, receiver = own wallet; then a second signature deposits the LP
  with us). Worse UX, working app.
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

Deadline semantics (value set in Step A #4 via `resolveDeadline` — this is only
its enforcement): `ApplyOrders'` tx validity range must end **before** every spent
order's `deadline`. Expired orders are simply never applied; the user reclaims via
Cancel (web shows a "reclaim" button). The executor never gains a recovery power.

**Cancel — web-side mechanics.** Two mechanisms, matching the two custody zones
above — not one bundled action:

| Function | Owns |
|---|---|
| `cancelOrder(orderRef) → txHash` | web-local wrapper: detects which zone `orderRef` currently sits in, dispatches to whichever mechanism applies, handles the resubmit-on-race flow below |
| `adapter.buildCancelTx(minswapOrderRef) → tx` | DEX-specific — wraps Minswap's own `cancelOrder`/`cancelExpiredOrders` (✅ `reference/sdk/src/dex-v2.ts:915,982`) |
| `buildOurCancelTx(orderRef) → tx` | not DEX-specific — spends our own order UTXO via the `Cancel` redeemer; identical whether the UTXO came from a filled asset leg or a direct LP-leg deposit |

`cancelOrder` is **targeted — one call, one UTXO** — deliberately not a single
action that bundles both legs of a mixed deposit into one combined transaction.
Bundling would mean spending from two different script addresses (Minswap's +
ours) in one atomic tx when the asset leg hasn't filled yet, which adds real
complexity (satisfying two independently-designed validators' witness
requirements at once) and a real failure mode: if the asset leg fills in the
gap between building and submitting, the *whole* combined tx fails — including
the LP leg's cancel, which was valid and unrelated to the race. Targeted cancel
avoids both: bulk cancellation (`cancelLegs`, below) is UI-level orchestration
over `cancelOrder`, not its own transaction-building path — a failure on one
leg never takes another down with it.

**The race this doesn't fully eliminate, and how it's handled — no auto-resubmit
is possible, by CIP-30's own design.** Between `cancelOrder` checking which zone
an order is in and the signed cancel tx actually landing on-chain, Minswap's
batcher can fill the order (fills have landed in as little as ~90 seconds this
project's own dust test, D24) — the targeted UTXO no longer exists, and
submission fails with a standard, detectable "input already spent" rejection,
never silently. Recovery can't be automatic: each distinct transaction body
needs its own explicit, wallet-prompted signature — a dApp cannot pre-authorize
"sign whatever tx turns out to be needed," by CIP-30 design, precisely so a
compromised or buggy dApp can't silently drain a wallet. So `cancelOrder`
catches that specific failure, re-runs its zone check (now finds the order at
our own validator instead), and prompts the user again — framed as a
continuation ("your deposit just filled — cancel the resulting order instead?"),
not a bare error, since a fill mid-cancel is progress, not necessarily bad news:
the user is now one step closer to shares, and may reasonably choose to let it
proceed instead of cancelling a second time. Contrast with Step D's *executor*-side
version of this exact race ("User cancels mid-build... Recovery: re-derive
UTXO set, rebuild without it, re-verify, resubmit") — that one auto-recovers
with no human involved, because the executor is re-signing its own rebuilt tx
with its own hot key. The web can't copy that pattern; the missing signature
belongs to the user's wallet, not a key Pomona holds. One mitigation worth
having regardless, though it narrows the window rather than closing it (eUTXO
means it can never fully close): re-check the targeted UTXO's existence as
close to actual submission as practical, not just once at the start of the flow.

**Leg discovery & status — web-side mechanics.**

| Function | Owns |
|---|---|
| `checkLegStatus(legRef) → { state: 'pending'\|'pending_expired'\|'not_found', zone?: 'minswap'\|'adapose' }` | web-local; live-state only, never inspects a spent UTXO's history — D25-safe by construction, since it's built entirely on `utxosAt`-style reads |
| `listMyLegs(walletAddress) → Leg[]` | web-local; the from-nothing recovery path — scans both zone addresses, filters by `payout`/`canceller` matching the wallet, needs zero client-side memory to work. Built on `parseOrderDatum` (`shared/`, D22) — introduces no new `shared/` need of its own |
| `cancelLegs(legRefs: LegRef[]) → txHash[]` | web-local orchestration over `cancelOrder` — `legRefs.map(ref => cancelOrder(ref))`, one independent tx per leg, never bundled (same reasoning as above) |

**`checkLegStatus` deliberately never distinguishes *applied* from *cancelled*
once a leg is `not_found` — not a gap, a considered choice.** Both are
terminal, non-actionable states, and the wallet balance already shows the
outcome directly (shares if applied, LP or original assets back if
cancelled) — there's no user-facing value in Pomona re-deriving which
happened when the result is already visible for free. The one case where the
distinction *would* matter — a leg the user just cancelled themselves — is
already known with certainty from the client's own action (`cancelOrder`
returns a `txHash`; once it confirms, no on-chain inference is needed to
"prove" it was a cancel). Building a classifier that chases down a spent
UTXO's spending transaction to distinguish `Apply` from `Cancel` after the
fact has no real caller once that's accounted for.

**No persistence, no database, anywhere in this — and that's the actual
answer to "what happens on refresh."** `listMyLegs` needs nothing but a
freshly-connected wallet address to fully reconstruct what's pending, at any
distance in time — 30 seconds after placing a deposit or three years later,
identically. Session/component state (e.g. Redux) is a disposable cache for
snappy in-session UX, never a source of truth anything depends on surviving.
Same discipline Step D's failure branches already state for the *executor's*
indexer ("No off-chain ledger to reconcile — the chain is the only state") —
applied here to the web for the identical reason.

**`cancelLegs` is always available, not scoped to "the deposit I just
placed."** An earlier version of this design fed it from session memory
right after Step A's submission — rejected: that makes the bulk-cancel
option appear right after depositing and then silently vanish on refresh,
which is a worse UX than either "always available" or "never available." The
corrected design: `cancelLegs` is driven entirely by manual multi-select
from whatever `listMyLegs` currently shows, working identically regardless
of session age — a user with three pending legs from three unrelated
deposits spread across weeks can select and cancel any combination, the same
way, every time. `batch_id` (`vault-init.md`'s deferred extensibility-field
candidate) would only ever affect *display* under this design — e.g.
visually clustering legs from one deposit action, or pre-checking their
boxes right after a fresh submission as a convenience — never `cancelLegs`'s
actual availability or mechanism, which stays uniform either way.

**Failure branches (B):**
- Order lands with malformed/missing datum → Cancel and Apply both fail at the datum
  cast → **Rescue** (above) is the recovery path. Datums that cast but hold nonsense
  values are NOT rescue-eligible — they Cancel normally; the executor just never
  applies them.
- Datum-**by-hash** output whose preimage was never posted → unspendable by protocol
  (the ledger demands the preimage before any validator runs); no rescue possible.
  Policy: we only ever emit inline datums (Minswap fills are forced inline by
  `EODInlineDatum`).
- **Order moves zones mid-cancel** (asset leg fills between `cancelOrder`'s zone
  check and submission) → submission fails on the now-consumed input, never
  silently → `cancelOrder` re-checks and re-prompts (above); not a Rescue case,
  the order is perfectly well-formed, it just moved.

## Step C — executor discovers + filters

1. Indexer polls `lucid.utxosAt(orderAddress)` (✅ same call the SDK's own
   `expired-order-monitor.ts:104` uses) or raw Blockfrost equivalent, on the
   scheduler tick. Minswap-delivered orders (asset leg) are indistinguishable from
   direct LP deposits at this point — same address, same datum shape, LP in the
   value — so everything downstream is one code path.
2. Per order, filter to **eligible**:
   ```
   parses?          datum casts to OrderDatum, else ignore (Rescue territory)
   funded?          lp_i := order value's pool-LP amount > 0 (value-derived — Step D);
                    riding ADA covers the payout output's minUTxO (an order too fat
                    to fund its own payout is left to Cancel)
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
          per order i:          order_value_i − lp_i×LP + shares_i×share_asset → payout_i
                                (pass-through: shares + min-ADA + any extras)
mint:     share_policy: +Σ shares_i
validity: upper bound < min(deadline_i)
signers:  executor hot key
```

Network fee: the executor pays it (it's the signer) — recouped by the 4.5%
performance fee (D3/D4 economics). A depositor's only costs are the order's minUTxO
(returned with the shares) and, on the asset leg, Minswap's 2 ADA batcher fee.

**Value handling (per order — the gap-2 rules):** `lp_i` is *defined* as the amount
of this pool's exact LP asset id in the order's **value**, never a datum claim — a
datum-declared amount would let a lookalike-token order mint real shares. Everything
in an order's value that isn't LP **passes through to its payout** (the `n4` equation
below): hand-crafted extras bounce back to the user in the same tx, never enter the
vault (no token-dust bloat of the long-lived vault UTXO — minUTxO scales with value
size), never reach executor change (leak closed). The honest path never exercises
this: web-built orders and Minswap fills are `{ADA, LP}` by construction.

Batch pricing (ADOPTED — D20 addendum 2026-07-19): **all orders in one batch price
at the uniform pre-batch rate** `(total_shares, total_lp)` — order-independent, no
intra-batch sequencing to verify on-chain, and house-favored rounding applies per
order. Safe in mixed deposit+redeem batches too (double-floor round-trip argument,
redeem.md Step D).

Vault validator checks, by invariant name (each becomes a named check + `aiken check
-m nX_` test):

| Check | Enforces |
|---|---|
| `n1_totals` | `total_lp' = total_lp + Σ lp_i` and `total_shares' = total_shares + Σ shares_i`, deltas computed only from datum + spent-order values; vault output value delta equals Σ lp_i exactly (no leak to executor) |
| `n3_round_down` | each `shares_i = floor(lp_i * total_shares / total_lp)` — floor, never round/ceil |
| `pool_scope` | every spent order's `pool_nft` equals MY thread NFT — cross-pool orders can't leak into this batch (pairs with N6) |
| `n4_full_service` | every spent order's `payout_i` receives exactly `order_value_i − lp_i×LP + shares_i×share_asset` (shares + min-ADA + extras pass through — nothing strands, nothing leaks); `shares_i >= min_shares_i`; validity range beats every deadline |
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
3. ~~**Uniform pre-batch rate** for all orders in a batch.~~ **RESOLVED
   2026-07-19** — D20 addendum: adopted for both directions incl. mixed batches.
   Safe by rate-neutrality + the double-floor round trip (`floor(floor(lp·S/L)·L/S)
   ≤ lp` — a same-batch in-and-out always loses dust, never extracts); sequential
   alternatives rejected (order-dependence = N4 surface, quote-breaking, costlier
   fold). Full argument in redeem.md Step D.
4. ~~**`owner_addr` as full address.**~~ **RESOLVED 2026-07-18** — D21 addendum:
   split into `canceller: AuthMethod` (Signature | SpendScript — Minswap's proven
   pattern; an address can't sign, and signature-only Cancel bricks script wallets)
   + `payout: Address` (full address, stake rights intact). vault.ak sketch updated.
5. ~~**v1 deposit asset = LP tokens only.**~~ **SUPERSEDED 2026-07-18 by D21** — any
   mix of pool assets + LP in one signature via chained Minswap DEPOSIT order with
   `successReceiver` = our order validator (on-chain-enforced delivery, verified from
   source). ~~One open operational question remains: does Minswap's licensed batcher
   fill third-party-script-receiver orders in practice?~~ **RESOLVED 2026-07-25 —
   YES, see D24** (real mainnet probe, not just source-verified).
6. **Web-side order status detection: poll vs. push — UNDECIDED.** After Step A's
   submit, how does the frontend learn an order was applied (shares landed)? Plain
   Blockfrost REST is poll-only. Two push alternatives exist but aren't evaluated
   yet: Blockfrost Webhooks (needs a backend receiver — can't target a browser tab
   directly; filter granularity unverified) or raw node chain-sync (different infra
   commitment). Deliberately deferred — evaluate alongside the executor indexer's own
   polling-vs-webhook question (separate scope, not decided here) before committing
   either to poll.

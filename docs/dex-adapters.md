<!-- Source: reference/sdk/src/dex-v2.ts, reference/sdk/src/calculate.ts, reference/minswap-amm/order_validation.ak, reference/wingriders-onchain/Types_Request.hs, reference/wingriders-onchain/Pool.hs, reference/wingriders-onchain/ConstantProduct.hs, reference/wingriders-sdk/dex-serializer/src, reference/wingriders-sdk/dex-blockfrost-adapter/src -->
# DEX Adapter Design Notes — Deposit Order Field Comparison

**Purpose:** the D22 adapter boundary (`adapters/minswap_v2`, future
`adapters/wingriders`) exists so DEX-specific mechanics never leak past a small
interface. This doc records, field-by-field, which deposit-order concepts are true
type-level equivalences across Minswap V2 and WingRiders V2 (safe to name as one
shared adapter parameter) versus which are DEX-specific internals that must stay
inside each adapter's own implementation. Written 2026-07-26 while designing
`web/`'s deposit flow (`docs/workflows/deposit.md`) — generalize to redeem/swap/
farm adapter surfaces if/when those get the same treatment.

**Evidence status:** WingRiders columns are source-verified at the validator level
(read from `WingRiders/dex-v2-contracts`, Plutarch/Haskell — `Pool.hs` newly
vendored 2026-07-26 alongside the D16 files), **not** operationally verified — no
dust test has been run against their live agent. See `docs/v2-ideas.md` →
"WingRiders as venue #2" for the prerequisite this creates. Treat WingRiders rows
as "the contract allows this," the same evidentiary tier Minswap was at before
D24 resolved it — not "this works in practice."

## Deposit-order field comparison

| Concept | Minswap V2 | WingRiders V2 | Type match? |
|---|---|---|---|
| Deposit amounts | `depositAmountA`/`depositAmountB` — explicit `Integer` fields in the order datum, cross-checked against the order's value | no datum fields at all — only `assetASymbol`/`AToken`/`BSymbol`/`BToken` (which assets, not how much); quantity is purely value-derived | ✗ structurally different — Minswap double-declares (datum + value), WingRiders is value-only |
| Min LP/shares out | `minimumLP: Integer` | `AddLiquidity(minWantedShares: Integer)` | ✓ same type, same semantic floor |
| Receiver | `successReceiver: Address` — script-capable, ✅ **operationally confirmed** on Minswap mainnet (D24) | `beneficiary: Address` — script-capable per source (`Types_Request.hs:88-91`: "Can be both a script address or a pubkey address"); ⚠️ operationally unverified | ✓ same type, ⚠️ different evidence tier |
| Receiver datum | `successReceiverDatum` — hash posted in the order datum plus a **separate preimage output** the SDK auto-adds (`buildUtxoToStoreDatum`) | `compensationDatum :: Datum` embedded **directly as a datum field**, plus `compensationDatumType: No\|Hash\|Inline` choosing delivery shape | ✗ different mechanism — Minswap needs an extra tx output, WingRiders doesn't |
| Deadline | present (order datum) | `deadline :: POSIXTime` | ✓ same type |
| Cancel/reclaim authority | `canceller: Signature(pkh) \| SpendScript(hash)` — script-wallet-capable | `owner :: Address` in the datum, but `pvalidateReclaim` (`Request.hs:90-99`) extracts a **pubkey credential only** and checks `ptxSignedByPkh` — no script-owner path | ✗ **real product gap**: a script/multisig-wallet user can safely use Minswap's cancel path but not WingRiders' |
| Fee/collateral overhead | `killable` flag (atomic batcher-side kill/refund) + flat batcher fee (SDK-computed, not a datum field) | `oil: Integer` (must be `>= C.requestOilAda`, confirmed = flat 2 ADA via `REQUEST_OIL` in `dex-blockfrost-adapter/src/constants.ts`) + `agentFeeAda` (pool-config, defaults to 2 ADA via `REQUEST_BATCHER_FEE`); summed into "provided" ADA in `pparseRequest` (`Pool.hs:615-656`) | ✗ different shape, same role — both stay adapter-internal, see below |
| Deposit LP-mint math | Any ratio, one order — `calculateDepositAmount` always solves a virtual-swap quadratic for the full imbalance, full credit regardless of ratio (`reference/sdk/src/calculate.ts:382`) | **Two different code paths** (`ConstantProduct.hs:138-164`) — see finding below | ✗ not just formula differences, a different deposit *model* |

## Findings worth keeping

- **`oil` ≠ `killable` — different category, not just different vocabulary.**
  `oil` is collateral/cost-coverage ADA riding on the request (functionally
  parallel to Minswap's `FIXED_DEPOSIT_ADA + batcherFee`, which the SDK adds to
  `orderAssets["lovelace"]` implicitly). `killable` is a boolean governing whether
  the *batcher itself* can atomically kill/refund an unfillable order versus
  requiring a separate user-initiated cancel. WingRiders has no visible
  equivalent of `killable` anywhere in `RequestAction`/`RequestDatum`/`Pool.hs` —
  not a naming difference, the mechanism doesn't appear to exist on their side.
- **Reclaim-authority gap.** WingRiders' owner-reclaim path is pubkey-signature
  only (`Request.hs:90-99`); Minswap's `canceller` supports `SpendScript` too.
  If ADApose ever wants to accept deposits from script/multisig wallets on the
  asset leg, that's a Minswap-only capability today — WingRiders would need its
  own gate or a documented limitation.
- **Deposit-amount declaration differs structurally**, not just in field names:
  Minswap declares amounts in the datum (redundant with value, presumably for
  validator convenience); WingRiders derives everything from the request UTXO's
  value alone. An adapter's `buildDepositOrder` needs to know this internally —
  it's not something a caller passes in either way.
- **Receiver-datum delivery differs**: Minswap requires an extra output in the
  same tx to carry the datum preimage; WingRiders carries it as a plain datum
  field. This means `buildDepositOrder`'s return shape can't be assumed to be a
  single output — it has to be "however many tx-building steps this leg needs."
- **WingRiders only auto-swaps a TRUE single-sided deposit; a two-sided
  imbalanced deposit takes a haircut instead of a swap.** Traced
  `papplyAddLiquidity` (`ConstantProduct.hs:138-164`): if `pfltA == 0` or
  `pfltB == 0`, it dispatches to `paddLiquidityZapIn`, which solves for an
  implied swap amount via an on-chain boundary check (balanced at `swapA`,
  unbalanced at `swapA - 1`, lines 417-434) — full credit, same spirit as
  Minswap's virtual swap. But if **both** amounts are non-zero and off-ratio,
  it falls to plain `paddLiquidity` (line 470-486): `earnedShares =
  min(sharesFromA, sharesFromB)`, both full amounts get added to reserves, and
  whichever side exceeds the pool ratio earns **zero** extra shares for that
  excess — it's absorbed as a donation, not converted. Minswap has no
  equivalent gap; its quadratic solve handles any ratio in one order. To match
  Minswap's full-credit UX on WingRiders, `adapters/wingriders` would need to
  detect the two-sided-imbalanced case and split it into two requests (a
  balanced portion + a single-sided zap-in for the leftover) — meaning
  `buildDepositOrder` needs to return multiple *requests*, not just multiple
  outputs for one request. **Resolved 2026-07-26 (decided now, not deferred
  to WingRiders implementation — see Adapter interface implication below):
  `buildDepositOrder` returns `Order[]`, always, even though only WingRiders
  will ever return more than one entry.** Deciding the shape doesn't require
  building the WingRiders adapter, and getting it right now avoids a breaking
  interface change whenever WingRiders implementation does start.
- **The `swapA` hint (`additionalData` in `PParsedRequest`) is agent-supplied
  at apply time, not carried in the depositor's request.** Traced it from
  `pparseRequest`'s parameter list (`Pool.hs:566`) back through `applyRequests`
  to `orderedInputs :: PList (PPair PTxInInfo PData)` — built by whoever
  constructs the pool-evolve tx (WingRiders' own agent), exactly parallel to
  Minswap's batcher computing its own fill. Doesn't affect our request-building
  functions. It IS independently computable off-chain from `addA` + pool state
  alone (the boundary check above is a pure function, no private data needed),
  so `quoteDeposit` can still preview it accurately without the agent —
  **but no official library does this for us.** Checked both officially
  published TS packages (`reference/wingriders-sdk/`, vendored 2026-07-26,
  confirmed real via npm registry + GitHub, not merely claimed by a search
  summary): `dex-serializer` is datum ser/deser only, `dex-blockfrost-adapter`
  computes *swap* quotes (`computeExpectedSwapAmount`) but has **no**
  deposit/add-liquidity quote function anywhere — grepped both packages' real
  `src/` (not just `.d.ts`), confirmed absent. `adapters/wingriders` would have
  to reimplement `paddLiquidityZapIn`'s solve independently, against
  WingRiders' own 4-part fee model (`swapFeeInBasis`/`protocolFeeInBasis`/
  `projectFeeInBasis`/`reserveFeeInBasis`, vs. Minswap's 2-numerator model) —
  real correctness risk if it ever drifts from what the validator checks,
  with no vendored reference implementation to lean on the way Minswap's SDK
  gives us `calculateDepositAmount` for free.
- **`quoteDeposit` also owns turning its point estimate into a protective
  floor — `{expectedLP, minimumLP}`, not just `{expectedLP}`.** (Resolved
  2026-07-26, `docs/workflows/deposit.md`.) `minimumLP` is a haircut off
  `expectedLP` by a DEX-side slippage %, itself a plain config default
  (user-overridable) — Minswap applies it via
  `calculateAmountWithSlippageTolerance` (`reference/sdk/src/calculate.ts:106`,
  confirmed to be a flat caller-supplied percentage, no volatility signal
  built in). WingRiders has no equivalent helper in either vendored package
  (`reference/wingriders-sdk/`) — `adapters/wingriders` would need to apply
  the same haircut itself once it has its own `expectedLP` (trivial once that
  number exists — this is a much smaller gap than the missing zap-in solve
  above, just worth not forgetting since nothing does it for free there).
- **No official Reclaim/cancel transaction builder exists anywhere in the
  WingRiders ecosystem — checked `@wingriders/cab` directly to confirm, not
  assumed.** `cab` ("CAB... helps you with development of Cardano apps," npm
  latest `2.1.7`, repo `WingRiders/cab`) is a genuinely **general-purpose**
  Cardano wallet/tx-planning library — UTxO arrangement, CBOR encoding, a
  generic transaction planner (`src/ledger/transaction/`) — with **zero**
  DEX-specific code. Pulled the full `main` tree (211 files) and grepped for
  `request`/`reclaim`/`cancel`/`order`: the one hit
  (`src/helpers/request.ts`) is a generic HTTP fetch wrapper, unrelated to the
  `Request` datum type. No hits in the README or test suite either. Not
  vendored (nothing here is DEX-specific evidence worth citing, and nothing
  currently depends on it — matches this project's evidence-focused vendoring
  convention, not `reference/sdk`'s full-repo-mirror one).
- **But tracing what's actually needed confirms `buildCancelTx(orderRef)`
  generalizes to WingRiders anyway, by construction rather than by finding a
  matching library.** Four pieces, each already solved: (1) resolve the ref
  to a full UTXO via `lucid.utxosByOutRef` — the same call Minswap's own
  `cancelOrder` uses internally (`dex-v2.ts:919`), no new capability needed;
  (2) the `Reclaim` redeemer is constructor tag 1 with an **empty field
  list** — `Constr 1 []` (`Types_Request.hs:129-136,244`) — trivially
  hand-buildable, no serializer required; (3) the required signer is read
  straight from the resolved UTXO's own datum via the already-vendored
  `dex-serializer`'s `RequestDatumV2.from_hex`, then `.addSigner(ownerPkh)` —
  identical in shape to our own `buildOurCancelTx`'s handling of `canceller`;
  (4) the deployed Request validator's hash is already known
  (`c134d839a64a5dfb9b155869ef3f34280751a622f69958baa8ffd29c`, D16). `cab`
  never actually enters the picture — Lucid (D7, our standardized tx-building
  library regardless of DEX) already provides the generic capability `cab`
  would have, and we already use it exactly this way for our own validator.

## Adapter interface implication

Safe to include in a shared, DEX-agnostic call signature (type-verified match
across both DEXs above): deposit amounts (as a caller-facing quantity, not a
wire format), min-LP/shares-out floor, receiver address, receiver datum (opaque
blob), deadline.

**The "receiver datum (opaque blob)" isn't hand-built per call site — it's
`encodeOrderDatum`'s output** (`docs/workflows/deposit.md`, D22 rule 2's
`OrderDatum` codec, `shared/`). Both adapter callers attach the *same* encoded
blob: `buildDepositOrder`'s asset leg passes it as Minswap's
`successReceiverDatum`; the web's LP leg (`buildLpLegOutput`, no adapter
involved) attaches it directly to its own output. Neither adapter needs to
know the datum's internal shape — they only ever receive the already-encoded
`Data`, confirming it really is opaque to them, not merely described that way.

Must stay inside each adapter's own implementation, never passed in from
outside: `killable` / `oil` / `agentFeeAda` / batcher-fee computation, the
datum-declaration-vs-value-only distinction, the preimage-output-vs-inline-field
delivery mechanism, and the pubkey-only-vs-script-capable cancel authority
(the last one may need to surface as a capability flag the UI can check, rather
than being fully hidden — a script-wallet user needs to know before signing
whether their chosen DEX leg supports their wallet type).

**Return type: `buildDepositOrder(...) → Order[]`, where `Order = { outputs:
OutputSpec[] }`.** Not a single output, not a single order-with-outputs object —
a list of orders, decided now on the evidence above even though only
`adapters/wingriders` will ever populate more than one entry:
- Minswap always returns exactly one `Order` (whose `outputs` may itself have
  2 entries — the order output plus the datum-preimage plumbing output; that's
  one order, not two, since the second output isn't independently fillable or
  cancellable).
- WingRiders returns one `Order` for a single-sided or already-balanced
  deposit, two for a two-sided imbalanced one (see finding above) — each a
  genuinely independent, independently-fillable request.

The caller (`assembleDepositTx` in `docs/workflows/deposit.md`) never branches
on DEX or count: `orders.flatMap(o => o.outputs)`. This is the same principle
as the outputs-list decision one level down, applied consistently: whoever
*knows why* the count varies is the only one allowed to produce the variance;
everyone downstream just flattens. The list-of-orders grouping also isn't
pure future-proofing — it preserves the same "which outputs belong to which
independently-trackable thing" information that deposit.md's existing
sibling-tracking logic (mixed-deposit legs) already depends on for its own,
separate reason.

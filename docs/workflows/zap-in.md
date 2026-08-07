<!-- Source: lib/adapters/adapter.ts, lib/adapters/minswap-quote.ts, lib/adapters/minswap.ts, lib/adapters/registry.ts, lib/adapters/registry-client.ts, lib/tx-fee.ts, web/src/app/api/pool-state/route.ts, web/src/app/api/build-deposit/route.ts, web/src/components/deposit/deposit-modal.tsx, web/src/hooks/use-pool-state.ts, web/src/hooks/use-wallet-balance.ts, web/src/hooks/use-asset-decimals.ts, web/src/components/wallet/cip30.ts, web/src/lib/deposit-costs.ts -->
# Zap-In — implementation notes

**Not a design doc.** Unlike this directory's other files, there's no real design
question here — v1's zap-in is thin glue over Minswap's own deposit-order mechanics,
not a mechanism we're inventing. This is a running notes/reminders page so decisions
and gotchas from building it don't have to get rediscovered, nothing more.
(Corrected 2026-08-05: originally said "thin glue over `@minswap/sdk-v2`" — wrong,
see "Which Minswap SDK" below.)

## Shape

No vault (D28 addendum, 2026-08-02) — `successReceiver` on the Minswap deposit order
is the connected wallet's own address. No custody, no per-user on-chain state.

## Done so far (2026-08-04)

- `web/.env.local` has `NEXT_PUBLIC_BLOCKFROST_PROJECT_ID` /
  `NEXT_PUBLIC_BLOCKFROST_BASE_URL` (same project as `automation/sqrtk/.env`,
  copied over — separate app, separate env file).
- `web/src/components/wallet/cip30.ts`'s `connectWallet()` now builds `Lucid` with a
  real `Blockfrost` provider instead of `new Lucid({})` — the wallet's Lucid instance
  can now query UTXOs/protocol params/submit, not just decode its own address.

## Which Minswap SDK (2026-08-05)

Two genuinely different, confusingly-named packages exist: `@minswap/sdk` (0.5.0,
`reference/sdk`, older — Lucid + direct Blockfrost/Ogmios access, builds transactions
locally, matches `CLAUDE.md`'s own D7 rationale for choosing SpaceBudz Lucid) and
`@minswap/sdk-v2` (1.0.0, what's actually installed in `web/package.json` —
Minswap's own REST/GraphQL client). Confirmed directly, not assumed: `@minswap/sdk-v2`'s
own docstring says building a liquidity transaction "requires the optional
`@minswap/internal-sdk` peer (Node-only)" — meaning its `LiquidityModule.addLiquidity`/
`zapIn` cannot run purely in the browser, and its `AddLiquidityParams` only accepts a
`slippage: number`, with no way to inject our own precomputed minimum — it decides
internally.

**`calculateDepositAmount`/`calculateDepositSwapAmount`: copy the old SDK's
*exported* versions into the shared adapter, cited, for the instant client-side
preview only — not for the real order.** Confirmed both are self-contained bigint
math with zero network/Lucid imports — safe to vendor into something both the
browser (instant preview while typing) and the future Node executor can use, without
pulling in `@minswap/sdk`'s much heavier dependency tree (ioredis, Ogmios/Maestro
clients, etc.) just for two functions.

**Cross-checked against sdk-v2's own internal (unexported) copy of the same formula —
identical, both by direct read and by empirical test.** `web/node_modules/@minswap/sdk-v2/dist/index.js`
has its own `calculateDepositAmount`/`calculateDepositSwapAmount`, used internally by
`buildAddLiquidity2` but absent from `index.d.ts` (not part of sdk-v2's public
contract — could be renamed/restructured in any patch release with no SemVer signal,
unlike the old SDK's deliberately-exported version). Line-by-line, every term matches
the old SDK's formula exactly (same `x`/`y`/`z`, same `2×DENOM − fee` term, same
`bigIntPow(v) = v²`, same fee denominator `10000n` in both). Then verified empirically,
not just visually: ran both implementations against identical sample inputs (a normal
two-sided case, a single-sided case, imbalanced-A-heavy, imbalanced-B-heavy, and a
tiny-reserve edge case) — byte-identical bigint output every time. Two independently-
built Minswap codebases landing on the exact same formula is strong confirmation this
is genuinely validator-coupled, not either team's arbitrary implementation choice.

**Order construction: `@minswap/sdk-v2` after all — not the old SDK's `DexV2`.**
An earlier version of this entry decided the opposite and called it settled; that
wasn't actually agreed, just an unstated leap, corrected 2026-08-05. The original
reasoning for preferring the old SDK's builder was "so the front end's number is
exactly what gets built" — moot now that the math is proven identical either way.
What actually matters is re-fetching *fresh* pool state right before the real build
(quotes go stale in seconds on any live AMM, same as Uniswap — never reuse the
typing-time preview's number for the actual slippage floor), which is orthogonal to
which SDK does the arithmetic. Given that, sdk-v2 wins on its own merits: it's the
actively-maintained package, and adopting the old SDK's `DexV2` for the real order
would mean owning its *entire* order-construction surface ourselves (datum encoding,
receiver logic, batcher fee handling) — a much bigger thing to take on/maintain than
two already-verified pure functions. Pool identity fields needed either way are
already sitting in the `pools` table (`nft`, `assetA`, `assetB`, `lpAsset`,
`trackAsset`) — no new pool-discovery work needed.

- **Shared adapter location: decided and built — `lib/adapters/`, root npm
  workspace (`lib/`, not `shared/`).** See "lib/ workspace + client/server
  split" below for the full story, including two real build walls hit and
  fixed getting there.
- **Execution fee: flat 1 ADA**, added as an extra output in the same deposit tx.
  Deliberately not tuned — D28 already frames this as the distribution wedge, not
  the revenue layer (that's Phase 2's managed strategies), so the exact number
  isn't load-bearing. Easy to bump later; don't over-think it now.
- **Fill confirmation:** the order tx we submit produces a specific order UTXO
  (txHash + output index) at Minswap's order script address. Poll that exact outRef
  (`Provider.getUtxosByOutRef`, which the `Blockfrost` provider implements) until
  it's spent — that's the batcher having processed it.
  - **Gotcha (D25):** `utxosByOutRef` is spend-status-blind — an empty result can
    mean "genuinely spent" *or* an indexing-lag false negative. Don't treat one
    empty poll as a confirmed fill. Needs either a consecutive-empty-poll
    threshold before declaring done, or a second signal (the LP asset actually
    landing in the user's wallet) before showing success.
  - A spent order UTXO alone doesn't distinguish a fill from a cancel/refund —
    check what actually landed, not just that the UTXO moved.
- **UI:** a modal (not a sidebar) for the deposit form, staged as distinct steps
  rather than one flat screen — **input** (amount(s), slippage, live estimate) →
  **review** (locked-in numbers, full fee breakdown, this is the step that
  actually triggers the wallet signing popup) → closes on submit, tracked from
  there via the pending-order system below. Real money plus a non-instant
  batcher fill (~90s per D24) justifies a deliberate "confirm before signing"
  checkpoint distinct from still-editing state. "Enter Pool" stays disabled
  until a wallet is connected — no chained connect-then-deposit flow, one job
  per control.

## `lib/` workspace + client/server split (2026-08-05)

Getting `getLPQuote`/`getPoolState` actually running took three separate,
real build failures — not friction to gloss over, each one changed something
about the final shape. Recorded in the order they were hit, since the
reasoning at each step depended on the one before it.

**1. A standalone `lib/package.json` (no root workspace) resolves fine in
plain Node, but Turbopack refuses to load anything outside its own project
root, full stop.** Confirmed against the vendored docs
(`node_modules/next/dist/docs/.../08-turbopack.md`, "Filesystem Root") and by
hitting it directly — the `@lib/*` tsconfig alias resolved correctly (Turbopack
even showed the right resolved path in its own error), but still refused to
load the file. The documented fix, `turbopack.root` pointed at the parent
directory, made things worse on the first attempt: it fixed `@lib/*` but broke
Next's own dependency resolution (`@swc/helpers` stopped resolving) because
widening the root shifted where *everything* gets resolved from, and the repo
root had no `node_modules` of its own to fall back on.

**Fix: a real root-level npm workspace** (`package.json` at the repo root,
`"workspaces": ["web", "lib"]`) — `web/node_modules`, `lib/node_modules`, and
`web/package-lock.json` removed, `npm install` run from the root, hoisting
everything (including Next's own deps) into one root `node_modules`. Root
`.npmrc` also needed (the `@jsr` registry mapping `web/.npmrc` had, since a
workspace install reads config from the root, not each member — confirmed via
`npm warn config ignoring workspace config at web/.npmrc` once it was
recognized correctly). `turbopack.root` then worked cleanly — verified with
the same stub-import test that failed the first time, this time clean.

**2. Even with the workspace fixed, importing `lib/adapters/minswap.ts` from
a `"use client"` component broke the build again — a different failure,
Node-only code reaching the browser bundle.** `@minswap/sdk-v2` has a
top-level reference to `@minswap/internal-sdk` (its WASM tx-builder), which
pulls in `@minswap/wasm-helpers`, which does real `require('fs')` file I/O —
and Turbopack tried to bundle that whole chain for the browser because
`getLPQuote` and `getPoolState` lived in the same file, so importing one
dragged the other's import along regardless of which was actually used.
Researched before deciding rather than guessing: this is a well-documented,
recurring class of Next.js issue (confirmed via multiple independent GitHub
issues/discussions, not unique to us), and the two tempting alternatives both
turned out to be wrong fits — `serverExternalPackages` sounds right but solves
a *different* problem (keeping a package from being re-bundled *for the
server*, not keeping it out of the *browser* bundle in the first place), and
stubbing `fs` via `turbopack.resolveAlias` would suppress the build error
while shipping the entire unused WASM dependency chain to every browser for
zero benefit. Switching bundlers (webpack) wouldn't help either — no bundler
can make real filesystem I/O work inside a browser tab; that's a platform
limitation, not a Turbopack one.

**Fix: split the file.** `lib/adapters/minswap-quote.ts` — `getLPQuote` and
its private helpers, zero runtime imports, safe anywhere including the
browser (kept client-side deliberately, not routed through the server too —
see below). `lib/adapters/minswap.ts` — `getPoolState` (the `@minswap/sdk-v2`
import), server-only from here on, plus `minswapAdapter` composing both for
whatever eventually needs the full `DexAdapter` shape (the future executor).
A new Route Handler, `web/src/app/api/minswap/pool-state/route.ts`, is the
only thing the browser talks to for pool state — `use-minswap-pool-state.ts`
fetches it instead of importing `getPoolState` directly, converting the
bigint fields (not JSON-serializable) to strings over the wire and back.

**Kept `getLPQuote` client-side rather than folding it into the same route,
on purpose — considered and confirmed, not left over by accident.** The one
real reason: instant recompute as the user types, the same snappy way a
Uniswap-style swap quote updates live. Pool state only needs fetching once
(or occasionally) per modal-open; the quote math itself, given that state, is
near-zero-cost and shouldn't cost a network round-trip on every keystroke.
Weighed the simpler alternative (route everything through one API call,
`getLPQuote` folded server-side too) honestly: no confidentiality reason to
keep the math client-side (it's Minswap's own public formula) and the bundle
cost is negligible either way — the trade is purely about typing
responsiveness, and worth it.

**3. Even server-side, the WASM chain broke a third time — a genuinely
different failure again, not a repeat of #2.** Calling the new Route Handler
threw `ENOENT: ... open '/ROOT/node_modules/@minswap/cardano-serialization-lib-nodejs/cardano_serialization_lib_bg.wasm'`
— a literal, unsubstituted `/ROOT/` path. Turbopack *does* bundle Route
Handlers/Server Components by default, and its bundling rewrites the paths a
native/WASM package uses to locate its own binary at runtime, which broke
here. This is exactly what `serverExternalPackages` is for (confirmed this
time by the actual symptom matching its documented purpose precisely, not by
assumption): opt specific dependencies out of that bundling entirely, use
plain Node `require` for them instead. Added
`@minswap/sdk-v2`/`@minswap/internal-sdk`/`@minswap/cardano-serialization-lib-nodejs`/
`@emurgo/cardano-serialization-lib-nodejs`/`@minswap/wasm-helpers` to
`web/next.config.ts`'s `serverExternalPackages` — fixed cleanly, verified
against a real live pool (`getAppliedPoolsByPairs` returning actual current
reserves through the route, not a mock).

**Net result, verified end to end against live mainnet data through the real
Route Handler, not just unit-tested in isolation:** `getPoolState` and
`getLPQuote` both work, the browser bundle stays clean, and the split adds
exactly one new file (the route) and one hook change versus the original
single-file plan — not the bigger rearchitecture it might have sounded like
mid-diagnosis.

## Pending-order tracking

Decided 2026-08-04, ahead of actually needing it for Minswap (v1 is one leg,
always) — captured now because the shape is nearly free to get right early and
expensive to redo once something depends on it.

**Modal closes after submit; tracked in a "N pending" badge, not inside the
modal.** Waiting on a batcher fill inside an open modal isn't reasonable UX for
something that isn't instant. In-memory only, no `localStorage` — a refresh
loses our UI's tracking (the on-chain order itself is unaffected; the user can
always check their own wallet's LP balance), but avoids both a "why did this
resurface days later" surprise and any persistence design work before there's
proven need for it. Matches this project's repeated "don't build ahead of
proven need" calls (Redux, the Kupo node, the vault itself).

**Data layer: TanStack Query, not a bespoke Context.** Already in the stack
(`web/src/app/providers.tsx`'s `QueryClientProvider`), and it's purpose-built
for exactly this shape — async state that needs polling
(`refetchInterval`, matching the outRef-polling mechanism above) and needs to
be readable from more than one place (the modal starts it, the header badge
reads it) without prop-drilling. One `useQuery` per *process* (not per leg);
the queryFn polls whichever legs are still pending and returns an updated
`legs` array; stops refetching once every leg is terminal.

**Modeled as a list of legs per process, even though v1 always has exactly
one** — because future multi-leg venues can have *different* topologies, and a
single "current stage" pointer only fits one of them (see below):

```ts
type ZapLegStatus = "blocked" | "needs-signature" | "pending" | "filled" | "failed";

type ZapLeg = {
  label: string;                                    // "Deposit into ADA/MIN" / "Swap MIN -> ADA"
  outRef: { txHash: string; index: number } | null;  // null until this leg's tx actually exists
  status: ZapLegStatus;
};

type ZapProcess = {
  id: string;          // stable key, e.g. the first leg's submission txHash
  pair: string;
  venue: string;
  legs: ZapLeg[];       // v1: always exactly one entry
};
```

Per-leg status (not one shared "current leg" pointer) represents any topology
without a rework later — a parallel process just has more than one leg
`pending` at once; a sequential process has at most one `pending` at a time
by construction, with the rest `blocked` or `needs-signature`. The hover popup
on the badge lists every process with every leg's label + status ("Leg 1/1:
Deposit into ADA/MIN — pending") — same rendering logic regardless of leg
count or topology.

## Multi-leg composition — not needed for Minswap, designed for later

**WingRiders' imbalanced-deposit case is parallel, not sequential, and needs no
external swap at all** — confirmed directly against
`reference/wingriders-onchain/ConstantProduct.hs`, not just cited secondhand:
`papplyAddLiquidity` (lines 138-150) hard-dispatches on whether either amount is
*exactly* zero. Both nonzero and off-ratio → `paddLiquidity` (470-487), which
eats the excess (full explanation in `docs/v2-ideas.md`'s DexHunter entry).
Either amount exactly zero → `paddLiquidityZapIn` (397-438), which swaps
internally and adds liquidity, full credit, no eating, all inside one order's
fulfillment. The fix: split the user's deposit into (1) a balanced two-sided
portion, exactly in the pool's ratio (no excess, so `paddLiquidity` doesn't eat
anything) and (2) the true single-sided remainder (hits `paddLiquidityZapIn`,
which handles the swap itself). Both orders are independent, so both can be
outputs of **one** transaction — one signature, two order UTXOs, two
independent async batcher fills (parallel legs). No DexHunter, no external
swap, no second signature needed for WingRiders specifically.

**A genuinely zap-less venue (no internal swap mechanism at all,
`docs/v2-ideas.md`'s DexHunter entry) would need a real sequential
swap-then-deposit** — two signatures, not one, since the deposit leg's exact
amounts depend on the swap leg's output and can't be built beforehand. This
does *not* create a "which leg is active" ambiguity despite being sequential —
the dependency ordering means at most one leg is ever `pending` at a time by
construction, the rest are `blocked` (waiting on a prior leg) or
`needs-signature` (unblocked, waiting on the user).

**Real unsolved piece, flagged for whenever this is in scope: something has to
actively prompt the user for leg 2's signature** — it can't fire silently in
the background the way polling can, since signing needs live interaction.
- Detecting the "leg 1 filled" transition: `web/package.json` has TanStack
  Query v5, which **removed** the old `onSuccess` callback from `useQuery` —
  this needs a `useEffect` watching the query's returned data/status, not that
  callback.
- The resulting "needs your signature" state should **not** be a toast — a
  toast is transient and this can sit unacted-on for a while. Better as a
  persistent state on the badge itself (distinct from plain "pending"), with
  the actual "click to continue" affordance living in the same hover/click
  popup, not a separate notification surface.
- **The swap leg needs its own quote/review before it signs, same as the
  deposit does.** Solving for the right ratio doesn't remove the swap's own
  execution-price/slippage risk between quoting and actually filling — a
  different problem than the ratio math. Show expected output + its own
  minimum-guaranteed (not reused from the deposit leg's slippage setting)
  before that signature, not just the deposit's.

## Modal design

**Input step:** both amount fields always visible (not a single/two-sided
toggle) — Minswap accepts any combination, so leaving one at 0 already *is*
the single-sided case. Each field: numeric input, wallet balance shown
alongside, a "Max" button. A note near the fields, driven by a venue-level
capability flag (e.g. `zapInSignatures: "always-one" | "sometimes-two"`, not
hardcoded per venue name in the UI) rather than the one/two-sided choice
itself: Minswap (and WingRiders, if built with the split-order fix above) are
always `"always-one"` — no swap-warning copy applies to either. Only a
genuinely zap-less venue would ever show `"sometimes-two"` copy. Slippage:
preset buttons (0.5% / 1% / 2%) + a custom input, default 1% — not a slider;
slippage is a precision-sensitive risk parameter, not a coarse preference, and
dragging a slider to land on an exact value is fiddly. Live-updating estimate
below (debounced), computed via `lib/adapters/minswap-quote.ts`'s `getLPQuote`
against current reserves — shipped 2026-08-05, see "`lib/` workspace +
client/server split" above.

**Review step:** exact locked-in amounts (both assets, even one left at 0),
estimated LP out + guaranteed minimum, a cost breakdown. "Back" (returns to
input, values preserved) and "Confirm & Sign" (builds the tx, triggers the
wallet popup). No unverified timing claims in the copy (a "~90s" fill-time
figure was considered and dropped — it's D24's single observed transaction,
not a real average, and not worth stating as if it were). Shipped as a
*display*, 2026-08-06 — see "Sufficient-funds check, Max button, Review
display" below for what actually built and, just as importantly, what's
still deliberately missing (no real transaction yet).

## Sufficient-funds check, Max button, Review display (2026-08-06)

**Superseded the same day — see "Insufficient-funds handling redesigned
twice" below.** The flat 6 ADA reserve this section describes was proven
wrong by live reproduction (a real "change_split" failure), and the whole
hard-floor/Max-default/pre-build-check design got replaced with
build-first + a real server-side retry loop. Kept intact below rather than
rewritten, since the reasoning trail (why `getPlatformCosts` and
`getEstimatedNetworkFeeReserve` split the way they did) is still accurate
and still used — only the reserve-estimate/gating design built on top of
it changed.

Minswap's own per-deposit-order ADA requirements turned out to be more than
"the ~2 ADA batcher fee" this doc previously said — found by reading the
actual vendored SDK and the on-chain validator, not assumed, after a design
conversation kept surfacing new edge cases the further it went.

**Two separate ADA amounts, confirmed by reading code, not the same kind of
number:**
- **Batcher fee: 2 ADA, genuinely spent.** `BATCHER_FEE_DEX_V2[DEPOSIT]`,
  `reference/sdk/src/batcher-fee/configs.internal.ts` — flat across every V2
  order type.
- **`FIXED_DEPOSIT_ADA`: 2 ADA, but *not* spent.** `reference/sdk/src/types/constants.ts:1175`,
  added unconditionally to every V2 order's lovelace output in `dex-v2.ts`'s
  `buildOrderValue` (runs after the per-step-type switch, so it applies
  regardless of order type despite the name). Checked the actual validator
  to see what happens to it: `reference/minswap-amm/order_validation.ak`'s
  `validate_deposit` computes the success-receiver's output value by
  subtracting only `used_batcher_fee` and the deposit amounts — this 2 ADA
  is never subtracted, so it passes straight through to whichever output
  the order resolves to. The refund path (`get_returnable_value`) has this
  as a literal code comment: *"Only batcher fee is deducted from the order
  value."* Needs to be available in the wallet to build the tx, but it's
  not a real cost — it comes back attached to the LP position (or a
  refund).

**Network fee is genuinely unknowable before a real transaction is built**
(Cardano fees are deterministic from final tx size + script execution
units, not a formula to precompute). For a pre-build sufficient-funds check,
we need an estimate anyway — found real evidence rather than inventing a
number: the D24 test wallet's own order-creation transaction
(`fbe69b36a1a1b825bf797694a14d4c36a08d79981f03743b576533af94709584`,
structurally the same shape — a plain payment to a Minswap script address
with an inline order datum, no script execution on the creating side) paid
**0.189833 ADA**. Settled on a **1 ADA** reserve for this — roughly 5x the
observed fee, comfortable for realistic UTXO-fragmentation variance without
padding for a multi-order-per-tx scope (e.g. WingRiders' split-order fix
above) that doesn't exist yet — that scope, if it lands, changes the *whole*
formula below (each extra order roughly doubles the known costs too, not
just this margin), not something to pre-pad for now.

**The hard floor and the Max-button default are the *same* number, not
two.** Keeping them separate left a real gap: someone typing their own
amount between "definitely fails" and "safe" would pass the Input check and
then likely fail at the (still-unbuilt) real build step for a reason Input
could have caught. One number — **6 ADA** for Minswap (2 batcher + 2
`FIXED_DEPOSIT_ADA` + 1 execution + 1 network estimate) — used for both the
"Continue to Review" gate and the Max button's fill target on an
ADA-denominated field.

**Per-asset check model:** for each distinct asset actually leaving the
wallet, sum everything denominated in it and check against that asset's
balance — a sum, not independent checks against the same balance (a wallet
could otherwise pass two checks that both draw on the same ADA without
having enough for both at once). Non-ADA pool assets check on their own;
ADA sums its own deposit-leg amount (zero if neither pool asset is ADA)
*plus* the 6 ADA reserve, since Minswap's fees are always paid in ADA
regardless of what's being deposited. Implemented in
`deposit-modal.tsx` — `balanceAda` (a `useWalletBalance("lovelace")` call,
always made regardless of whether either pool asset is ADA; cheap even when
redundant with `balanceA`/`balanceB` since the underlying query is keyed by
address only, so it never costs a second network fetch) is used uniformly
as *the* ADA balance rather than conditionally picking between the two
asset-specific balance hooks.

**Where the numbers live — two separate `DexAdapter` methods, deliberately
not merged:**
- `getPlatformCosts(): { amount, description, refundable }[]` — real,
  protocol-defined ADA amounts (batcher fee + `FIXED_DEPOSIT_ADA`), each
  tagged whether it's genuinely spent. This is what Review displays.
- `getEstimatedNetworkFeeReserve(): bigint` — our own judgment call, not a
  protocol fact. Used only to size Input's sufficient-funds check and
  Max-button target; Review never shows it, since the real fee (once a
  transaction actually gets built) supersedes it entirely rather than
  sitting alongside it.

These are different *kinds* of claim (verified fact vs. informed estimate)
serving different consumers at different moments in the flow, which is why
they stayed separate rather than folding into one array — an earlier design
pass considered a single `getPlatformCosts()`-only shape and backed off once
that distinction became clear. Both are pure/sync (no network I/O), so both
live in the already-client-safe `lib/adapters/minswap-quote.ts`, not the
server-only `minswap.ts` — `getPoolState` needs the server split because it
touches `@minswap/sdk-v2`'s WASM chain; neither of these touches it at all.
Our own execution fee (1 ADA) stays outside `DexAdapter` entirely — it's
app-level, not platform-specific — in a new `web/src/lib/deposit-costs.ts`,
which is also the one place that sums the adapter's numbers with the
execution fee into the aligned 6 ADA total (three separate call sites
needed that same total: the validity check, the Max-button target, and the
footer note).

**Input step's footer deliberately doesn't mention `refundable`.** Input's
job is explaining why the field can't take the full balance — that answer
doesn't change based on what's refundable later. Review's job is the real
accounting, which does need the distinction (grouped there: a "Fees" total
for non-refundable entries, a separate line for `FIXED_DEPOSIT_ADA` labeled
as returned with the position). Wording Input's note as "needs to stay
available" rather than "in fees" also sidesteps needing a disclaimer there
at all — considered and deliberately dropped rather than omitted by
oversight.

**Explicitly not built in this pass:** no real Lucid transaction, no
refresh/expiry mechanism for the numbers shown on Review (that only makes
sense once there's a real tx to rebuild — building UI chrome for it now
would be dead weight), no re-verification of balances on entering Review
beyond what Input already checked. "Confirm & Sign" is a disabled stub, same
pattern as "Review Deposit" was before this pass. Review's network-fee line
is an honest placeholder ("calculated when you continue"), not a fabricated
number.

## Real transaction build wired up end-to-end (2026-08-06)

The "Confirm & Sign" stub above is still a stub, but everything before it —
building the actual unsigned order and getting a real network fee — is now
real, not display. Full decision-record summary: `docs/decisions.md` D35.

**Order construction:** `@minswap/sdk-v2`'s `LiquidityModule.addLiquidity`
— never signs, returns raw unsigned CBOR. Needs `version: "V2"` explicit
in the pool ref, confirmed by hitting a real "ambiguous pair — multiple
pools across versions" error without it (some pairs, e.g. ADA/MIN, have
both V1 and V2 pools). No Kupo/RpcProvider needed: wallet UTXOs are
gathered client-side (`lucid.wallet.getUtxos()`) and re-encoded to CIP-30's
raw-CBOR shape via SpaceBudz Lucid's `Codec.encodeUtxo`, passed straight
through as `walletUtxoCbors` — the Kupo dependency this project already
rejected elsewhere as unneeded infrastructure turned out not to be needed
here either.

**Real network fee, read directly off the built CBOR — and a genuine CBOR
gotcha getting there.** Both `@minswap/cardano-serialization-lib-nodejs`
and `@emurgo/cardano-serialization-lib-nodejs` threw `Deserialization
failed... expected 'Array' byte received 'Tag'` trying to parse a real
transaction's inputs — Cardano's Conway-era "set" encoding (CBOR tag 258),
which neither CSL build handles, regardless of version. Fixed with the
generic `cbor` npm package instead (already a transitive dependency via
`@minswap/internal-sdk`, added as an explicit dependency):
`decodeFirstSync(buf)[0].get(2)` reads the transaction body's fee field —
CDDL map key 2, a stable ledger field — without needing to understand
tag-258's semantics at all. Verified against a real mainnet transaction's
independently-confirmed fee (500000 lovelace). Lives in `lib/tx-fee.ts`,
not an adapter file — this logic is platform-agnostic (it reads a Cardano
ledger field, not a Minswap-specific one), confirmed deliberately before
placing it.

**`RemoteApiShutdownError` (`@cardano-sdk/web-extension`) — a real wallet-
extension-channel failure, confirmed via research not guessed at, with no
reliable proactive detection.** Root cause theory: Chrome/Brave Manifest V3
extension service workers can be torn down after inactivity, invalidating
a held `api` object reference. Extensive live timing testing (sidebar
open/closed, wait durations from seconds to 5+ minutes) found the failure
window genuinely inconsistent — same nominal conditions produced both pass
and fail across trials — which ruled out a targeted heartbeat/keep-alive
fix as anything but redundant complexity layered on top of a fix that
would be needed regardless. **Fixed: reconnect the wallet
(`connectWallet`, silent for an already-authorized origin on Lace)
unconditionally before every build attempt, not reactively after a
failure.** Costs nothing extra — pure browser-to-extension communication,
no Blockfrost/server round-trip — even on the common case where the old
connection was still fine. Side benefit: since the reconnect now lives
inside the retried function itself, TanStack Query's own retry mechanism
became correct for transient failures too, where before a retry would have
reused the same possibly-dead connection.

**30-second TTL on a built quote** (`BUILD_TTL_MS`), countdown shown on
Review — a quoted network fee can go stale before the user acts on it, and
the modal says so explicitly rather than letting a stale number sit next
to a Confirm button.

## Insufficient-funds handling redesigned twice (2026-08-06)

Full decision-record summary: `docs/decisions.md` D36. Both redesigns
happened the same day the section above shipped, once live testing with a
real personal wallet (not the D24 test wallet) started surfacing real
failure modes a synthetic test never would have.

**First: the flat 6 ADA reserve above was proven wrong by direct
reproduction, not just theorized.** A real wallet with a single UTXO
holding both ADA and an LP-V2 token together triggers a "change_split"
cost (an extra required change output) the flat estimate never accounted
for — missing exactly 156,347 lovelace in the reproduced case. Bumping the
constant (7, 10, 20 ADA) was explicitly rejected — no fixed number can be
proven safe against every wallet UTXO shape, and "trying to out-think the
system" was the wrong frame entirely. Replaced: **Max means full wallet
balance**, standard DeFi convention rather than an estimate; the real
build happens on Preview itself (build-first, not a pre-check); a real
build's success or failure is the only authority on whether an amount
works.

**Second: one correction from a single failed build isn't always enough
either, confirmed by direct reproduction of the correction itself.**
Reducing a 12.12 ADA deposit by the first shortfall (`cause: "change"`)
still failed on the very next attempt with a *different* shortfall
(`cause: "change_split"`) — coin selection reshapes around the smaller
requested amount, so fixing one requirement can expose another. Fixed by
moving the retry loop server-side (`build-deposit/route.ts`, bounded at 5
rounds, `MAX_BUILD_ROUNDS`) instead of one client-driven correction per
Preview click — every round reuses the same wallet UTXO snapshot from the
one request, since nothing about the wallet changes until a transaction
actually submits.

**Message routing corrected: "any insufficient-funds error is about ADA"
was an overstated working assumption, not a rule that held.** A stale
client-side balance check (fetched once, not re-verified) could in
principle let a genuinely non-ADA shortfall reach a real build. Messaging
now routes on which asset the SDK's `InsufficientBalanceError.asset`
actually names, not an assumption about pool composition — the case where
the shortfall matches neither pool asset (ADA needed for fees/change in a
token/token pool) gets its own bottom-of-modal message with buffer
language, instead of falling through to a raw technical string the way it
did before this was noticed.

**A real bug shipped and was caught in live testing, not review.** Syncing
the input fields to the server-adjusted amounts after a successful-but-
corrected build was done with zero visible acknowledgment to the user —
caught directly during testing. Fixed with an explicit note on Review
comparing requested vs. adjusted amounts, sourced from the same
build-result object (not re-derived from separately-synced component
state) so it can't drift out of sync with what it's describing.

**Input step simplified alongside this.** `CostBreakdown` moved to
Review-only (Input is now just amounts, slippage, and the LP estimate).
The balance-insufficient check became advisory rather than gating:
staleness cuts both directions — the real balance could have risen or
fallen since it was last fetched — so a hard block risks incorrectly
preventing an attempt that would've actually succeeded, which is worse
than letting a doomed one through (the server loop handles that case
correctly anyway, just a beat slower). A single step-aware Refresh button
(footer, bottom-left) replaced two separate refresh affordances — the
implicit refetch-on-open and a button that used to live embedded in
Review's fee row — refreshing wallet balance + pool state on Input,
re-running the real build on Review.

**Deferred, recorded in `docs/v2-ideas.md` rather than built now:**
cause-bucketing the SDK's full `InsufficientBalanceCause` enum (only
`CHANGE_SPLIT` directly confirmed by triggering it), an itemized-total
presentation. Confirmed while investigating: no network fee is ever
available on a failed build — it aborts during coin selection, before fee
calculation runs.

## Platform-agnostic venue dispatch — brief note (2026-08-06)

`deposit-modal.tsx`'s imports and internal structure changed as part of a
broader fix that's outside this doc's own scope (it also touched
`pool-table-row.tsx`, which has nothing to do with zap-in) — full story in
`docs/decisions.md` D37. The short version as it affects this flow: the
modal no longer imports Minswap's adapter functions directly or calls a
Minswap-named hook/route — it looks up a venue-keyed adapter
(`getClientAdapter(pool.venue)`, `lib/adapters/registry-client.ts`) and
calls generic hooks/routes (`usePoolState`, `/api/build-deposit`) that take
`venue` as a parameter. `ZAP_IN_SIGNATURE_BEHAVIOR`, the hardcoded
per-venue lookup table this doc's own "Modal design" section above
predicted should eventually move onto the adapter (it did, initially, as a
literal `Record` in the modal instead) is now `getSignatureBehavior()` on
`DexAdapter` — finally matching what "Modal design" originally called for.

## Wallet balances (2026-08-05)

Real balances wired into the input step's two `AmountField`s, replacing the
`Balance: —` placeholders — `web/src/hooks/use-wallet-balance.ts` (one
`lucid.utxosAt(address)` fetch per connected address, reused across both
fields by summing `utxo.assets[unit]` per unit rather than querying twice)
and `web/src/hooks/use-asset-decimals.ts` (a live Blockfrost `GET
/assets/{unit}` lookup, `"lovelace"` short-circuited to `6` with no network
call, `staleTime: Infinity` since decimals never change once an asset is
minted). `formatTokenAmount` (`web/src/lib/format.ts`) is the generic
raw-bigint-plus-decimals display formatter `formatAda` couldn't be reused
for, since that one already assumes its input is pre-scaled.

**Decided against a `tokens` table for this, for now** — decimals fetched
live + TanStack Query's client cache already avoids repeat lookups for a
shared asset within a session, and a real table's design questions (what
else belongs in it, who populates it) aren't justified yet. Full reasoning
and revisit trigger: `docs/v2-ideas.md`'s "Normalized `tokens` table for
asset metadata" entry.

**Reused for the live LP-out estimate, as planned:** both hooks solved the
same raw-units conversion problem `getLPQuote` needed — no re-derivation of
decimals/balance access required when that landed.

## Testing

- **Preprod is not usable for this.** Confirmed during D24's own dust test: the
  Minswap preprod batcher sat idle 6+ days, MinTeam's own Discord said preprod
  batcher reliability isn't guaranteed. Test on mainnet, small amounts.
- **The D24 mainnet test wallet is now empty, swept 2026-08-06** —
  `addr1qym42lkqgy98vmplxw0gdp7fzw0qzzdk0kxryaqer9hygy8ha68cv80hk5yt9mrs2r20k4rht5r8gdm3hupjpg287zps3qztxy`
  held ~12.62 ADA + 18,020,218 raw units of Minswap's ADA-MIN LP-V2 token
  (verified on-chain 2026-08-04) but was fully swept to a personal wallet
  (tx `282cbea1317ca6082b8acf83d52069dff403f6520053fa816c6171ef9a61bbef`,
  confirmed on-chain, both balances independently verified via Blockfrost)
  to fund manual testing of the deposit modal's sufficient-funds check. Kept
  here rather than deleted — may get refunded and reused later. Seed phrase:
  `legacy/executor/.env.mainnet-spike` (never copied out of that file), still
  valid for this address whenever it's funded again.

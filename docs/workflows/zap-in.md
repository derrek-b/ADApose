<!-- Source: lib/adapters/adapter.ts, lib/adapters/minswap-quote.ts, lib/adapters/minswap.ts, web/src/app/api/minswap/pool-state/route.ts, web/src/components/deposit/deposit-modal.tsx, web/src/hooks/use-minswap-pool-state.ts, web/src/hooks/use-wallet-balance.ts, web/src/hooks/use-asset-decimals.ts, web/src/components/wallet/cip30.ts -->
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
estimated LP out + guaranteed minimum, fee breakdown (network fee estimate +
Minswap's ~2 ADA batcher fee + our 1 ADA execution fee). "Back" (returns to
input, values preserved) and "Confirm & Sign" (builds the tx, triggers the
wallet popup). No unverified timing claims in the copy (a "~90s" fill-time
figure was considered and dropped — it's D24's single observed transaction,
not a real average, and not worth stating as if it were).

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
- **A funded mainnet test wallet already exists**, left over from D24:
  `addr1qym42lkqgy98vmplxw0gdp7fzw0qzzdk0kxryaqer9hygy8ha68cv80hk5yt9mrs2r20k4rht5r8gdm3hupjpg287zps3qztxy`
  — currently holding ~12.62 ADA + 18,020,218 raw units of Minswap's ADA-MIN
  LP-V2 token (verified on-chain 2026-08-04, not assumed from the old decisions.md
  entry). Seed phrase: `legacy/executor/.env.mainnet-spike` (never copied out of
  that file). Reusable for a live dry run once the build is far enough along —
  no new dust-test funding needed.

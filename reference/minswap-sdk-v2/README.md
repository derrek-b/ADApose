<!-- Source: none -- this vendors an npm package with no reachable git repo, see VENDORED_COMMIT -->
# `@minswap/sdk-v2` (vendored 2026-07-31)

Vendored on the strength of a Minswap team member's Discord answer (2026-07-31)
to the open question D19 left ("provision key-API access with Minswap, they
offered — reach out"): **"You don't need the API key to use it... the current
rate limit is enough for almost all use cases."** They also linked this new
package. Decision-record entry: `docs/decisions.md` D19 addendum, 2026-07-31.

**Evidence status — narrower than this project's usual vendoring, but the
part that's here is now byte-exact.** The package.json `repository` field
points at `https://github.com/minswap/minswap-sdk-v2`, which returned HTTP
404 on both the repo homepage and a raw README fetch (checked 2026-07-31) —
likely private. Unlike `reference/sdk` (full git mirror, `VENDORED_COMMIT` =
a real commit hash) or `reference/wingriders-sdk` (fetched from each repo's
public `main` branch), this could only be vendored from the published npm
artifacts. First pass of this vendoring went through WebFetch and, checked
against a real `npm pack @minswap/sdk-v2` afterward, turned out to have two
real inaccuracies: `LICENSE` said "Copyright (c) 2022 Minswap **Labs**" (the
real text has no "Labs"), and `UPSTREAM_README.md` had an AI-introduced
mid-line wrap not in the source. Both fixed — see `VENDORED_COMMIT` for the
full note and the tarball's shasum. `UPSTREAM_README.md`, `CHANGELOG.md`,
`LICENSE`, `package.json`, `npm-dist/index.d.ts`, and `npm-dist/index.js`
here are now byte-exact copies from that tarball's own `dist/` output, not
reconstructions (named `npm-dist/` rather than `dist/` — the root
`.gitignore` blanket-ignores any directory literally called `dist`, see
`VENDORED_COMMIT`). Still no `src/` tree or the per-module `./docs/*.md`
files the README itself links to (`docs/farm.md`, `docs/token.md`, etc.) —
confirmed absent from the published tarball itself, not just unreachable.
`npm-dist/index.d.ts` and `npm-dist/index.js` turned out to be worth having
in full, not just a spot
reference: the bundler didn't minify, so both still carry the real JSDoc
comments and even the original per-file path markers (`// src/client/
errors.ts`) — the closest thing to real source available without repo
access. One good example of what that buys: a comment on the Kupo
integer-parsing path explaining *why* — "Kupo returns unbounded integers...
parsing those as doubles would silently round the amount and produce
transaction bytes that do not match the chain."

## What it is

Per its own `CHANGELOG.md`: the direct successor to `@minswap/sdk`
(`reference/sdk`, the package D7 pinned to SpaceBudz Lucid) for
transaction-building purposes — **"migrated from `@minswap/sdk` (v1) — the
legacy Lucid transaction builder is intentionally left behind. This package
is only the new API client."** `reference/sdk` is not superseded for the
current √k direction's own purposes (still relevant per root `CLAUDE.md` —
same DEX mechanics, full source available) — this is a separate, additive
option, relevant specifically to farm/staking automation (i.e. the archived
`legacy/` design, if it's ever revisited) and to any future tx-building that
wants to avoid a Lucid dependency.

## Key facts, cited

- **Zero Lucid/chain-library dependency in the base package** — `dependencies`
  is just `zod` + `json-bigint` (`package.json`, this directory). A different
  integration model entirely: a pure API client that returns unsigned CBOR:
  *"The SDK is an API client — it **never signs or submits transactions**.
  Action methods return CBOR for you to sign with your own wallet."*
  (`UPSTREAM_README.md`). D7's SpaceBudz-Lucid reasoning was scoped to
  `@minswap/sdk` specifically ("@minswap/sdk's API is built on SpaceBudz
  Lucid") — that reasoning doesn't extend to this package, which needs no
  Lucid at all.
- **`sdk.farm`** — `list`, `getPositions`, `deposit`, `withdraw`, `harvest`,
  `emergencyWithdraw` (`UPSTREAM_README.md` modules table), with the same
  first-deposit-vs-add and partial-vs-full-withdraw auto-branching
  `reference/farm-docs/minswap-farm.md` already documents by hand against the
  raw GraphQL mutations (`buildFirstDepositV2`, `buildStakeDepositV2`,
  `buildStakeWithdrawV2`/`AllV2`, `buildMultipleHarvestsV2`,
  `buildEmergencyWithdrawV2`). This is a typed wrapper over the **same**
  backend, not a new mechanism — an internal error string surfaced during
  vendoring research names the same class of backend directly: `"GraphQL
  errors are lost without this"`. If a farm-automation executor gets built
  (legacy revival or otherwise), this is a strictly nicer integration surface
  than hand-rolled GraphQL calls: typed responses, a structured
  `MinswapError`, zod validation at the boundary.
- **The `apiKey` config field is documented as optional, and described in the
  SDK's own words as "raises the rate limit"** (`UPSTREAM_README.md`
  Configuration section) — this is the SDK's own published confirmation of
  the Discord answer above, not just a chat quote: a key changes your rate
  *tier*, it is not a precondition for the co-sign path to function.
- **Farm/staking WRITE actions need an `RpcProvider`** (e.g.
  `KupoRpcProvider`) to resolve the caller's own wallet UTxOs into the CBOR
  shape the API expects, which in turn needs the optional peer
  `@minswap/internal-sdk` (a Node-only WASM Cardano serializer). **This is a
  genuinely new infrastructure dependency — a running Kupo instance — that
  the original design never assumed** (D7: Blockfrost + Lucid, no Kupo). A
  real integration cost to weigh, not a transparent swap. Reads
  (token/pool/portfolio/order/aggregator quotes) need none of this.
- `CHANGELOG.md`'s own claim: liquidity-order (AMM V2/V1/Stableswap) CBOR is
  *"verified byte-identical to the production `@minswap/sdk` builder (order
  address + value + datum) across all ops × pool versions."* This is
  Minswap's claim about their own package, **not independently verified by
  this project** — ⚠️ UNVERIFIED per the evidence-tag discipline the rest of
  this repo holds itself to (the same discipline D24 applied before trusting
  the batcher-fill bet).
- **Never signs or submits, same threat model as before.** D19's universal
  signing gate — an independent verifier re-parses the raw CBOR against
  pre-stated intent before any hot-key signature, builder-agnostic, no
  exceptions — applies unchanged, and if anything matters more here: an SDK
  client is a less transparent builder to eyeball than a hand-constructed
  GraphQL mutation payload.

## Relevance

Useful only if/when the D26-archived farm-emissions design (`legacy/`) is
revisited, per `legacy/README.md`'s own stated possibility — not relevant to
the current √k direction's own on-chain reading needs. `scripts/sqrtk/`
deliberately reads raw chain state rather than trusting a hosted API's
computed values, for the same reason DefiLlama's `apyBase` was rejected as a
trust source (`docs/mechanism-sqrtk.md`, `scripts/sqrtk/SQRTK_RUNBOOK.md`
§1) — nothing here changes that.

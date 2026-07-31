# @minswap/sdk-v2

A TypeScript SDK for the Minswap API. Construct one instance and reach each area
through its module: tokens, pools, aggregator swaps, liquidity (add/remove/zap),
farms, MIN staking, portfolio, and orders.

The SDK is an API client — it **never signs or submits transactions**. Action
methods return CBOR for you to sign with your own wallet.

## Install

```sh
pnpm add @minswap/sdk-v2
# or: npm install @minswap/sdk-v2
```

Runs in Node and the browser on native `fetch`; no heavyweight chain library is
pulled in. Farm and staking actions need a wallet's UTxOs — see
[Chain access](#chain-access) — which is the only part that may need extra
setup.

## Quick start

```ts
import { MinswapSdk } from "@minswap/sdk-v2";

const sdk = new MinswapSdk();

// Reads
const ada = await sdk.token.getById("lovelace");
const pools = await sdk.pool.list({ sortBy: "tvl_usd", limit: 20 });
const positions = await sdk.portfolio.getDefi("addr1...");

// Aggregator swap: quote, build, sign yourself, submit
const quote = await sdk.aggregator.estimate({
  amount: "1000000",
  tokenIn: "lovelace",
  tokenOut: "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6.4d494e",
  slippage: 0.5,
});
const { cbor } = await sdk.aggregator.buildTx({
  sender: "addr1...",
  estimate: { amount: "1000000", tokenIn: "lovelace", tokenOut:
quote.tokenOut, slippage: 0.5 },
  minAmountOut: quote.minAmountOut,
});
// sign `cbor` with your wallet, then:
// await sdk.aggregator.submitTx({ cbor, witnessSet });
```

## Configuration

```ts
const sdk = new MinswapSdk({
  network: "mainnet",        // default
  currency: "USD",           // or "ADA"; per-call overridable
  apiKey: process.env.MINSWAP_API_KEY, // raises the rate limit
  timeoutMs: 30_000,
  retry: { retries: 2, baseDelayMs: 300 },
  // endpoints: { appApiUrl, aggregatorApiUrl, keyAppApiUrl }, // for staging/local
  // fetch: customFetch,     // inject for tests or non-global fetch
  // rpcProvider,            // required only by farm/staking actions
});
```

## Modules

| Module | What it does |
| --- | --- |
| `sdk.token` | `getById`, `getByIds`, `list`, `getOhlc`, `getTradeHistory` |
| `sdk.pool` | `list`, `getById`, `getByIds`, `getOhlc`, `getEvents` |
| `sdk.portfolio` | `getDefi` — a wallet's LP, farm, and staking positions |
| `sdk.order` | `getHistory` — DEX order history across protocols |
| `sdk.aggregator` | `estimate`, `buildTx`, `submitTx`, `cancelOrders`, `getPendingOrders` |
| `sdk.liquidity` | `addLiquidity`, `removeLiquidity`, `zapIn`, `zapOut` — across DEX V2, V1, Stableswap |
| `sdk.farm` | `list`, `getPositions`, `deposit`, `withdraw`, `harvest`, `emergencyWithdraw` |
| `sdk.staking` | `list`, `getPositions`, `stake`, `unstake` |

`farm.deposit` and `farm.withdraw` branch for you — a first deposit versus adding
to a stake, a partial withdrawal versus withdrawing all — based on your current
position. `staking` routes tiered versus flexible automatically. `liquidity`
resolves the pool and version from a pair (or LP token) + amount + slippage;
orders are built **client-side** and need the optional `@minswap/internal-sdk`
peer (see [Chain access](#chain-access)).

## Documentation

Per-module reference, each with every function, description, usage, and examples:

- [Overview & shared concepts](./docs/README.md) — coinIds, amounts, config, pagination, errors, signing
- [`sdk.token`](./docs/token.md) · [`sdk.pool`](./docs/pool.md) · [`sdk.portfolio`](./docs/portfolio.md) · [`sdk.order`](./docs/order.md)
- [`sdk.aggregator`](./docs/aggregator.md) · [`sdk.liquidity`](./docs/liquidity.md) · [`sdk.farm`](./docs/farm.md) · [`sdk.staking`](./docs/staking.md)
- [Chain access (`RpcProvider` / Kupo)](./docs/chain-access.md)

## Chain access

Farm and staking actions build transactions that spend the wallet's UTxOs, so
the SDK needs to know what the wallet holds. Supply an `RpcProvider`:

```ts
import { MinswapSdk, KupoRpcProvider } from "@minswap/sdk-v2";

const sdk = new MinswapSdk({
  rpcProvider: new KupoRpcProvider({ url: "https://your-kupo:1442" }),
});
```

`KupoRpcProvider` turns Kupo UTxOs into the CBOR the API expects. That requires a
Cardano serializer, which it loads from the optional peer dependency
[`@minswap/internal-sdk`](https://www.npmjs.com/package/@minswap/internal-sdk):

```sh
pnpm add @minswap/internal-sdk
```

That serializer ships Node-targeted WebAssembly, so `KupoRpcProvider`'s default
path is Node-only. In a browser, either supply your own `KupoSerializer`, or
implement the small `RpcProvider` interface against a server that returns
already-serialized UTxOs. Reads (token, pool, portfolio, order, aggregator
quotes) never need any of this.

## Errors

Every failure throws a `MinswapError` with a typed `code` and matching `details`:

```ts
import { MinswapError, MinswapErrorCode } from "@minswap/sdk-v2";

try {
  await sdk.token.getById(id);
} catch (e) {
  if (MinswapError.is(e, MinswapErrorCode.RATE_LIMITED)) {
    // e.details.retryAfterMs is typed here
  }
}
```

Nothing returns `null` to signal an error. Responses are validated at the
boundary, so a backend change surfaces as a located `PARSE_ERROR` rather than a
silent `undefined`.

## Development

```sh
pnpm install
pnpm test          # vitest (hermetic — fake fetch, no network)
pnpm run type-check
pnpm run lint
pnpm run build     # tsup -> dist (ESM + CJS + .d.ts)
```

## License

MIT

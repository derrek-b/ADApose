import {
  assetUnitToCoinId,
  coinIdToInputAsset,
  getAppliedPoolsByPairs,
  MinswapSdk,
} from "@minswap/sdk-v2";

import type { DexAdapter } from "./adapter";
import {
  getEstimatedNetworkFeeReserve,
  getLPQuote,
  getPlatformCosts,
  getSignatureBehavior,
  getUnderlyingAssets,
} from "./minswap-quote";

// Server-only: @minswap/sdk-v2 pulls in @minswap/internal-sdk's WASM
// tx-builder (real Node-only file I/O), which cannot be bundled for a
// browser at all -- confirmed by hitting the actual build failure
// ("Can't resolve 'fs'") when this file was imported from a "use client"
// component. Never import this file from client code; use the
// /api/minswap/pool-state route instead (web/src/app/api/minswap/pool-state/route.ts).
// getLPQuote itself has no such restriction -- import it directly from
// ./minswap-quote in client code.

const sdk = new MinswapSdk();

export const getPoolState: DexAdapter["getPoolState"] = async (assetA, assetB) => {
  const inputA = coinIdToInputAsset(assetUnitToCoinId(assetA));
  const inputB = coinIdToInputAsset(assetUnitToCoinId(assetB));

  const [pool] = await getAppliedPoolsByPairs(sdk.clients.appGraphql, [
    { assetA: inputA, assetB: inputB },
  ]);
  if (!pool || pool.state.kind !== "V2") {
    throw new Error(`No Minswap V2 pool found for ${assetA}/${assetB}`);
  }

  // The pair can come back in either order -- confirm which side is which
  // before trusting reserveA/reserveB, rather than assuming the response
  // preserves the order it was requested in.
  const sameOrder =
    pool.assetA.policyId === inputA.currencySymbol && pool.assetA.nameHex === inputA.tokenName;

  const { reserveA, reserveB, totalLiquidity, feeANumerator, feeBNumerator } = pool.state;
  return sameOrder
    ? { reserveA, reserveB, totalLiquidity, feeANumerator, feeBNumerator }
    : {
        reserveA: reserveB,
        reserveB: reserveA,
        totalLiquidity,
        feeANumerator: feeBNumerator,
        feeBNumerator: feeANumerator,
      };
};

export const buildDepositOrder: DexAdapter["buildDepositOrder"] = async ({
  sender,
  walletUtxoCbors,
  assetA,
  assetB,
  amountA,
  amountB,
  slippage,
}) => {
  const coinIdA = assetUnitToCoinId(assetA);
  const coinIdB = assetUnitToCoinId(assetB);

  // Only nonzero entries -- the SDK's own doc comment: "a one-sided entry
  // is a zap-in." Including a spurious zero for the unused side isn't the
  // single-sided shape it expects.
  const amounts: Record<string, bigint> = {};
  if (amountA > 0n) amounts[coinIdA] = amountA;
  if (amountB > 0n) amounts[coinIdB] = amountB;

  const { cbor } = await sdk.liquidity.addLiquidity({
    sender,
    walletUtxoCbors,
    // version pinned explicitly -- Minswap has both V1 and V2 pools for
    // some pairs (confirmed by hitting the real "ambiguous pair" error
    // without it), and this app is V2-only throughout.
    pool: { assetA: coinIdA, assetB: coinIdB, version: "V2" },
    amounts,
    slippage,
  });
  return { cbor };
};

export const minswapAdapter: DexAdapter = {
  getLPQuote,
  getPoolState,
  getPlatformCosts,
  getEstimatedNetworkFeeReserve,
  getUnderlyingAssets,
  buildDepositOrder,
  getSignatureBehavior,
};

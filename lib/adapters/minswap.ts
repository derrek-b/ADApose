import {
  assetUnitToCoinId,
  coinIdToInputAsset,
  getAppliedPoolsByPairs,
  MinswapSdk,
} from "@minswap/sdk-v2";

import type { DexAdapter } from "./adapter";
import { getLPQuote } from "./minswap-quote";

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

export const minswapAdapter: DexAdapter = { getLPQuote, getPoolState };

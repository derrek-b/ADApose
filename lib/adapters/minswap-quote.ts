import type { DexAdapter } from "./adapter";

// --- Pure quote math -------------------------------------------------------
//
// Ported from @minswap/sdk 0.5.0 (reference/sdk/src/calculate.ts,
// calculateDepositAmount/calculateDepositSwapAmount; utils/sqrt.internal.ts,
// sqrt). Renamed calculateDepositAmount -> getLPQuote: the original name
// reads as an input (the amount being deposited), not the output it actually
// returns (LP tokens minted).
//
// Copied rather than depended on: @minswap/sdk-v2 (the actively-maintained
// package, used by ./minswap.ts for getPoolState) has its own internal copy
// of this exact math -- confirmed identical, not assumed, by reading both
// side by side AND by running both against the same sample inputs (a normal
// two-sided case, single-sided, imbalanced both directions, a tiny-reserve
// edge case) with byte-identical bigint results every time. Two
// independently-built Minswap codebases landing on the same formula is
// strong evidence this is coupled to the on-chain validator, not either
// team's arbitrary implementation choice -- but sdk-v2's copy isn't
// exported (absent from its own index.d.ts, only reachable by reading the
// compiled bundle), so it isn't something we can import and depend on with
// any stability guarantee. Hence the copy.
//
// One deliberate deviation from the old SDK's real sqrt.internal.ts: that
// version has a fast path using native Math.sqrt for values under
// Number.MAX_SAFE_INTEGER, falling back to integer Newton's method above it.
// The always-integer Newton's method below is what was actually tested
// against sdk-v2's own compiled copy (which uses the same always-integer
// form) -- porting the fast-path version instead would mean citing a
// verification that never actually covered it.
//
// Deliberately kept in its own file, zero runtime imports (the only import
// above is a type, erased at compile time): @minswap/sdk-v2 (used by
// ./minswap.ts for getPoolState) pulls in @minswap/internal-sdk's WASM
// tx-builder, which does real Node-only file I/O (require('fs')) and cannot
// be bundled for a browser at all. If getLPQuote lived in the same file as
// that import, any client-side code importing getLPQuote would drag the
// whole chain into the browser bundle too, even though the pure math here
// needs none of it. This file is the one safe to import from "use client"
// code; ./minswap.ts is not.

const FEE_DENOMINATOR = 10000n;

function sqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error("sqrt of a negative number");
  }
  if (value < 2n) {
    return value;
  }
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

function bigIntPow(x: bigint): bigint {
  return x * x;
}

function calculateDepositSwapAmount(params: {
  amountIn: bigint;
  amountOut: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  tradingFeeNumerator: bigint;
}): [bigint, bigint] {
  const { amountIn, amountOut, reserveIn, reserveOut, tradingFeeNumerator } = params;
  const x = (amountOut + reserveOut) * reserveIn;
  const y =
    4n *
    (amountOut + reserveOut) *
    (amountOut * reserveIn * reserveIn - amountIn * reserveIn * reserveOut);
  const z = 2n * (amountOut + reserveOut);
  const a =
    bigIntPow(x) * bigIntPow(2n * FEE_DENOMINATOR - tradingFeeNumerator) -
    y * FEE_DENOMINATOR * (FEE_DENOMINATOR - tradingFeeNumerator);
  const b = (2n * FEE_DENOMINATOR - tradingFeeNumerator) * x;
  const numerator = sqrt(a) - b;
  const denominator = z * (FEE_DENOMINATOR - tradingFeeNumerator);
  return [numerator, denominator];
}

export const getLPQuote: DexAdapter["getLPQuote"] = ({ amountA, amountB, pool }) => {
  const { reserveA, reserveB, totalLiquidity, feeANumerator, feeBNumerator } = pool;
  const ratioA = (amountA * totalLiquidity) / reserveA;
  const ratioB = (amountB * totalLiquidity) / reserveB;

  if (ratioA > ratioB) {
    const [num, den] = calculateDepositSwapAmount({
      amountIn: amountA,
      amountOut: amountB,
      reserveIn: reserveA,
      reserveOut: reserveB,
      tradingFeeNumerator: feeANumerator,
    });
    return ((amountA * den - num) * totalLiquidity) / (reserveA * den + num);
  }
  if (ratioA < ratioB) {
    const [num, den] = calculateDepositSwapAmount({
      amountIn: amountB,
      amountOut: amountA,
      reserveIn: reserveB,
      reserveOut: reserveA,
      tradingFeeNumerator: feeBNumerator,
    });
    return ((amountB * den - num) * totalLiquidity) / (reserveB * den + num);
  }
  return ratioA;
};

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

// --- Platform costs ---------------------------------------------------------
//
// Two real, protocol-defined ADA amounts every V2 deposit order requires,
// beyond the deposit itself -- confirmed by reading the SDK and the actual
// on-chain validator, not assumed (2026-08-06).

// BATCHER_FEE_DEX_V2[DEPOSIT], reference/sdk/src/batcher-fee/configs.internal.ts
// -- flat 2 ADA across every V2 order step type. Genuinely paid to the
// batcher for processing the order; never returned.
const MINSWAP_BATCHER_FEE = 2_000_000n;

// FIXED_DEPOSIT_ADA, reference/sdk/src/types/constants.ts:1175 -- added
// unconditionally to every V2 order's lovelace output in dex-v2.ts's
// buildOrderValue (runs after the per-step-type switch, so it applies
// regardless of order type despite the name). Checked the actual validator
// to see what happens to it, not just the SDK: order_validation.ak's
// validate_deposit computes the success-receiver's output value by
// subtracting only used_batcher_fee and the deposit amounts -- this 2 ADA
// is never subtracted, so it passes straight through to whichever output
// the order resolves to. The refund path (get_returnable_value) has this as
// a literal comment: "Only batcher fee is deducted from the order value."
// Needs to be available in the wallet to build the tx, but it's not a real
// cost -- it comes back attached to the LP position (or the refund).
const MINSWAP_FIXED_DEPOSIT_ADA = 2_000_000n;

// Not a protocol constant -- our own estimate of a typical order-creation
// transaction's real network fee, used only to size the deposit modal's
// pre-build sufficient-funds check (the real fee is only knowable once an
// actual transaction is built, which doesn't happen until execution lands).
// Backed by one real observed data point rather than invented outright:
// the D24 mainnet test wallet's own order-creation transaction
// (fbe69b36a1a1b825bf797694a14d4c36a08d79981f03743b576533af94709584,
// structurally the same shape -- a plain payment to a Minswap script
// address with an inline order datum, no script execution on the creating
// side) paid 0.189833 ADA. This is ~5x that, to comfortably cover realistic
// UTXO-fragmentation variance without padding for a multi-order-per-tx
// scope that doesn't exist yet. Revisit once more real transactions have
// been observed.
const MINSWAP_ESTIMATED_NETWORK_FEE_RESERVE = 1_000_000n;

export const getPlatformCosts: DexAdapter["getPlatformCosts"] = () => [
  { amount: MINSWAP_BATCHER_FEE, description: "Minswap batcher fee", refundable: false },
  {
    amount: MINSWAP_FIXED_DEPOSIT_ADA,
    description: "Minimum ADA (returned with your position)",
    refundable: true,
  },
];

export const getEstimatedNetworkFeeReserve: DexAdapter["getEstimatedNetworkFeeReserve"] = () =>
  MINSWAP_ESTIMATED_NETWORK_FEE_RESERVE;

// Ported from @minswap/sdk 0.5.0's DexV2Calculation.calculateWithdrawAmount
// (reference/sdk/src/calculate.ts, lines 455-470) -- the direct reverse of
// calculateDepositAmount, which getLPQuote above was itself ported from.
// Confirmed no fee applies anywhere in this function (unlike getLPQuote's
// swap-balancing math): a balanced, proportional withdrawal doesn't touch
// the constant-product curve, so there's nothing for the trading fee to act
// on. Fees only enter Minswap's *imbalanced*/zap-out withdrawal case
// (calculateZapOutAmount), which this doesn't need -- a plain proportional
// share is the right thing for an at-a-glance "your position" display.
export const getUnderlyingAssets: DexAdapter["getUnderlyingAssets"] = ({ lpAmount, pool }) => {
  const { reserveA, reserveB, totalLiquidity } = pool;
  return {
    assetA: (lpAmount * reserveA) / totalLiquidity,
    assetB: (lpAmount * reserveB) / totalLiquidity,
  };
};

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

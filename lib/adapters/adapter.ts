/**
 * Whether a zap-in ever needs a second wallet signature on this platform.
 * "always-one": the platform settles any combination (single- or two-sided,
 * any ratio) in one order, so a second signature is never needed. A venue
 * that can't zap in internally would need a separate swap-then-deposit flow
 * (2 signatures) -- see docs/workflows/zap-in.md's "Multi-leg composition"
 * section.
 */
export type SignatureBehavior = "always-one" | "sometimes-two";

/**
 * The contract every DEX adapter satisfies. Deliberately minimal -- covers
 * only what's actually needed today (the deposit modal's live quote). Grows
 * as real capabilities (order construction, fill polling) get built, not
 * ahead of them.
 */
export interface DexAdapter {
  /** Pure, synchronous, no I/O -- the expected LP tokens minted for a deposit, given already-fetched pool state. */
  getLPQuote(input: {
    amountA: bigint;
    amountB: bigint;
    pool: {
      reserveA: bigint;
      reserveB: bigint;
      totalLiquidity: bigint;
      feeANumerator: bigint;
      feeBNumerator: bigint;
    };
  }): bigint;

  /** Live on-chain pool state for the given asset pair -- the input getLPQuote needs. */
  getPoolState(assetA: string, assetB: string): Promise<{
    reserveA: bigint;
    reserveB: bigint;
    totalLiquidity: bigint;
    feeANumerator: bigint;
    feeBNumerator: bigint;
  }>;

  /**
   * Real, protocol-defined ADA amounts this platform's order requires
   * beyond the deposit itself -- e.g. a batcher fee (genuinely spent) and/or
   * a min-ADA reserve (returned attached to the resulting position, per
   * `refundable: true`). Not app-level fees -- ADApose's own execution fee
   * lives outside this interface, since it isn't platform-specific.
   */
  getPlatformCosts(): { amount: bigint; description: string; refundable: boolean }[];

  /**
   * Our own conservative estimate of this platform's typical order-creation
   * network fee -- NOT a protocol fact, just an empirically-informed
   * judgment call used only to size the deposit modal's sufficient-funds
   * check and Max-button default before a real transaction exists to build.
   * Superseded entirely by the real computed fee once one is.
   */
  getEstimatedNetworkFeeReserve(): bigint;

  /**
   * Pure, synchronous, no I/O -- the underlying asset amounts a given LP
   * balance represents, proportional to reserves. No fee: a balanced
   * withdrawal doesn't touch the constant-product curve or trigger a swap,
   * so there's nothing for the trading fee to apply to. Mirror image of
   * getLPQuote.
   */
  getUnderlyingAssets(input: {
    lpAmount: bigint;
    pool: { reserveA: bigint; reserveB: bigint; totalLiquidity: bigint };
  }): { assetA: bigint; assetB: bigint };

  /**
   * Builds a real, unsigned Minswap V2 deposit order -- server-only, same
   * reason as getPoolState (needs @minswap/sdk-v2's Node-only WASM chain).
   * The SDK never signs; this returns raw unsigned CBOR for a later step to
   * sign, not yet wired up (see docs/workflows/zap-in.md).
   */
  buildDepositOrder(input: {
    sender: string;
    walletUtxoCbors: string[];
    assetA: string;
    assetB: string;
    amountA: bigint;
    amountB: bigint;
    slippage: number;
  }): Promise<{ cbor: string }>;

  /** Pure, synchronous, no I/O -- see SignatureBehavior above. */
  getSignatureBehavior(): SignatureBehavior;
}

/**
 * The subset of DexAdapter that's pure/no-I/O and safe to import from
 * client ("use client") code -- everything except getPoolState and
 * buildDepositOrder, which need @minswap/sdk-v2's Node-only WASM chain and
 * can only run server-side (see minswap.ts's own header comment). Mirrors
 * exactly which methods already live in minswap-quote.ts vs minswap.ts.
 */
export type ClientSafeDexAdapter = Pick<
  DexAdapter,
  | "getLPQuote"
  | "getPlatformCosts"
  | "getEstimatedNetworkFeeReserve"
  | "getUnderlyingAssets"
  | "getSignatureBehavior"
>;

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
}

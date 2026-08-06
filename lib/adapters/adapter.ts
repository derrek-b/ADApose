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
}

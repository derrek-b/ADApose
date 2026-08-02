export type FeeApr = {
  value: number;
  /** Actual measured window in days — not guaranteed to equal the nominal 7/30. */
  actualDays: number;
};

export type PoolRow = {
  pair: string;
  venue: string;
  tvlAda: number | null;
  feeApr7d: FeeApr | null;
  feeApr30d: FeeApr | null;
};

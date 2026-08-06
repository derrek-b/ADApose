import { getEstimatedNetworkFeeReserve, getPlatformCosts } from "@lib/adapters/minswap-quote";

// ADApose's own fee, not platform-specific -- doesn't belong on DexAdapter.
// Flat, deliberately not tuned (see docs/workflows/zap-in.md).
export const EXECUTION_FEE = 1_000_000n;

// The single number aligned across two different jobs -- see
// docs/workflows/zap-in.md's "Review step" section for why they're the same
// number rather than two: the deposit modal's hard floor for enabling
// "Continue to Review", AND the Max button's fill target for an
// ADA-denominated field. Both jobs only ever need the total, never the
// individual line items -- the Review step is the only place that needs
// getPlatformCosts()'s breakdown itemized.
//
// Direct import from the Minswap adapter rather than going through a
// generic DexAdapter parameter -- v1 is Minswap-only, matches
// deposit-modal.tsx's existing direct-import style for getLPQuote. Becomes
// adapter-parameterized once a second venue exists.
export function getRequiredAdaReserve(): bigint {
  const platformTotal = getPlatformCosts().reduce((sum, cost) => sum + cost.amount, 0n);
  return platformTotal + EXECUTION_FEE + getEstimatedNetworkFeeReserve();
}

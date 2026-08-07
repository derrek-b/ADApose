import type { ClientSafeDexAdapter } from "./adapter";
import {
  getEstimatedNetworkFeeReserve,
  getLPQuote,
  getPlatformCosts,
  getSignatureBehavior,
  getUnderlyingAssets,
} from "./minswap-quote";

// Client-safe: every entry is built from explicit minswap-quote exports
// (not a namespace spread), so each is obviously exactly the
// ClientSafeDexAdapter shape -- pure, no I/O, safe to import from "use
// client" code. Server-only methods (getPoolState, buildDepositOrder) go
// through the API routes instead -- see registry.ts, which must never be
// imported here or from client code.
const CLIENT_ADAPTERS: Record<string, ClientSafeDexAdapter> = {
  "minswap-v2": {
    getLPQuote,
    getPlatformCosts,
    getEstimatedNetworkFeeReserve,
    getUnderlyingAssets,
    getSignatureBehavior,
  },
};

export function getClientAdapter(venue: string): ClientSafeDexAdapter {
  const adapter = CLIENT_ADAPTERS[venue];
  if (!adapter) throw new Error(`No adapter registered for venue "${venue}"`);
  return adapter;
}

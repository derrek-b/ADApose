import type { DexAdapter } from "./adapter";
import { minswapAdapter } from "./minswap";

// Server-only, same reason as minswap.ts itself: minswapAdapter carries
// getPoolState/buildDepositOrder, which pull in @minswap/sdk-v2's
// Node-only WASM chain and cannot be bundled for a browser at all. Never
// import this file from client code -- use registry-client.ts instead,
// which only carries the pure/no-I/O subset.
const ADAPTERS: Record<string, DexAdapter> = {
  "minswap-v2": minswapAdapter,
};

export function getAdapter(venue: string): DexAdapter {
  const adapter = ADAPTERS[venue];
  if (!adapter) throw new Error(`No adapter registered for venue "${venue}"`);
  return adapter;
}

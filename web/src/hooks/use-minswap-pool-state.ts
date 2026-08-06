import { useQuery } from "@tanstack/react-query";

type PoolStateResponse = {
  reserveA: string;
  reserveB: string;
  totalLiquidity: string;
  feeANumerator: string;
  feeBNumerator: string;
  error?: string;
};

async function fetchPoolState(assetA: string, assetB: string) {
  const params = new URLSearchParams({ assetA, assetB });
  const res = await fetch(`/api/minswap/pool-state?${params}`);
  const data: PoolStateResponse = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Pool state lookup failed (${res.status})`);
  }
  return {
    reserveA: BigInt(data.reserveA),
    reserveB: BigInt(data.reserveB),
    totalLiquidity: BigInt(data.totalLiquidity),
    feeANumerator: BigInt(data.feeANumerator),
    feeBNumerator: BigInt(data.feeBNumerator),
  };
}

// Thin wrapper, no Minswap-specific knowledge of its own -- just caches and
// tracks loading/error state for a fetch to /api/minswap/pool-state (a
// server-only route: @minswap/sdk-v2 pulls in Node-only WASM code that
// can't be bundled for the browser at all, see lib/adapters/minswap.ts's
// own header comment). The future executor doesn't need this hook or the
// route -- it calls the adapter's getPoolState directly, no React, no HTTP.
export function useMinswapPoolState(assetA: string, assetB: string) {
  const query = useQuery({
    queryKey: ["minswap-pool-state", assetA, assetB],
    queryFn: () => fetchPoolState(assetA, assetB),
    enabled: assetA !== "" && assetB !== "",
  });

  return { poolState: query.data, isLoading: query.isLoading, isError: query.isError };
}

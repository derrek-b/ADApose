import { useQuery } from "@tanstack/react-query";

type PoolStateResponse = {
  reserveA: string;
  reserveB: string;
  totalLiquidity: string;
  feeANumerator: string;
  feeBNumerator: string;
  error?: string;
};

async function fetchPoolState(venue: string, assetA: string, assetB: string) {
  const params = new URLSearchParams({ venue, assetA, assetB });
  const res = await fetch(`/api/pool-state?${params}`);
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

// Thin wrapper, no DEX-specific knowledge of its own -- just caches and
// tracks loading/error state for a fetch to /api/pool-state (a server-only
// route: DEX SDKs can pull in Node-only WASM code that can't be bundled
// for the browser at all, see lib/adapters/minswap.ts's own header
// comment). Dispatches server-side by `venue` (getAdapter,
// lib/adapters/registry.ts) rather than hardcoding one platform. The
// future executor doesn't need this hook or the route -- it calls the
// looked-up adapter's getPoolState directly, no React, no HTTP.
export function usePoolState(venue: string, assetA: string, assetB: string) {
  const query = useQuery({
    queryKey: ["pool-state", venue, assetA, assetB],
    queryFn: () => fetchPoolState(venue, assetA, assetB),
    enabled: venue !== "" && assetA !== "" && assetB !== "",
  });

  return {
    poolState: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}

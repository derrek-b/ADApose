import { useQuery } from "@tanstack/react-query";

// ADA's decimal count is a fixed Cardano protocol constant, not something to
// look up per-asset -- never worth a network call.
const LOVELACE_DECIMALS = 6;

async function fetchDecimals(unit: string): Promise<number> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BLOCKFROST_BASE_URL}/assets/${unit}`,
    { headers: { project_id: process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID! } },
  );
  if (!res.ok) {
    throw new Error(`Blockfrost asset lookup failed (${res.status}) for ${unit}`);
  }
  const data = await res.json();
  // Absent for an asset with no registered token metadata -- 0 decimals
  // (display the raw integer) is the standard fallback in that case.
  return data.metadata?.decimals ?? 0;
}

export function useAssetDecimals(unit: string) {
  const query = useQuery({
    queryKey: ["asset-decimals", unit],
    queryFn: () => fetchDecimals(unit),
    // Decimals are immutable once an asset is minted -- never worth refetching.
    staleTime: Infinity,
    enabled: unit !== "lovelace" && unit !== "",
  });

  if (unit === "lovelace") {
    return { decimals: LOVELACE_DECIMALS, isLoading: false, isError: false };
  }
  return { decimals: query.data, isLoading: query.isLoading, isError: query.isError };
}

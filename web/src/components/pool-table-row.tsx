"use client";

import { Coins } from "lucide-react";

import { getUnderlyingAssets } from "@lib/adapters/minswap-quote";

import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAssetDecimals } from "@/hooks/use-asset-decimals";
import { useMinswapPoolState } from "@/hooks/use-minswap-pool-state";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { formatAda, formatApr, formatTokenAmount } from "@/lib/format";
import type { FeeApr, PoolRow } from "@/lib/pool-row";

// The measured window is a floor, never below `target` (pickWindow in
// refresh-minswap-readings.mts picks the smallest qualifying daysAgo) -- so
// the whole-day part is either exactly `target` (the common case) or, for a
// quiet pool with no candidate that close, the next day-bucket out (8.x for
// a "7D" column, 31.x for "30D"). Only that second case gets a marker -- a
// value that's already 7.x/30.x needs no alert since it matches what the
// header claims. The marker itself always stays visible without hovering;
// only the fuller explanation lives behind the tooltip.
function AprCell({ apr, target }: { apr: FeeApr | null; target: number }) {
  const matchesHeader = apr != null && Math.floor(apr.actualDays) === target;
  if (!apr || matchesHeader) {
    return <TableCell className="text-center">{formatApr(apr)}</TableCell>;
  }
  return (
    <TableCell className="text-center">
      <Tooltip>
        <TooltipTrigger className="cursor-help border-0 bg-transparent p-0">
          {formatApr(apr)}
          <span className="ml-0.5 align-middle text-[1.2em] leading-none text-amber-500">*</span>
        </TooltipTrigger>
        <TooltipContent>
          Measured over {apr.actualDays.toFixed(1)} days, not {target} -- no
          closer snapshot was available for this pool yet.
        </TooltipContent>
      </Tooltip>
    </TableCell>
  );
}

export function PoolTableRow({
  pool,
  striped,
  walletConnected,
  onEnterPool,
}: {
  pool: PoolRow;
  striped?: boolean;
  walletConnected: boolean;
  onEnterPool: (pool: PoolRow) => void;
}) {
  const lpBalance = useWalletBalance(pool.identity.lpAsset);
  const hasPosition = lpBalance.balance !== undefined && lpBalance.balance > 0n;

  // Empty-string unit reuses each hook's existing "disabled" gate -- no hook
  // API changes needed. Only fetches reserves/decimals once we know there's
  // an actual position to convert, not for every row on every page load.
  const { poolState, isError: poolStateError } = useMinswapPoolState(
    hasPosition ? pool.identity.assetA : "",
    hasPosition ? pool.identity.assetB : "",
  );
  const decimalsA = useAssetDecimals(hasPosition ? pool.identity.assetA : "");
  const decimalsB = useAssetDecimals(hasPosition ? pool.identity.assetB : "");

  const underlying =
    hasPosition && poolState
      ? getUnderlyingAssets({ lpAmount: lpBalance.balance!, pool: poolState })
      : undefined;
  const underlyingReady =
    underlying !== undefined && decimalsA.decimals !== undefined && decimalsB.decimals !== undefined;
  const underlyingFailed = hasPosition && (poolStateError || decimalsA.isError || decimalsB.isError);

  const [labelA, labelB = "Asset B"] = pool.pair.split("/");

  return (
    <TableRow className={striped ? "bg-brand-cardano-blue/10" : undefined}>
      <TableCell className="text-center">
        {underlyingReady || underlyingFailed ? (
          <Tooltip>
            <TooltipTrigger className="inline-flex cursor-help items-center gap-1 border-0 bg-transparent p-0">
              {pool.pair}
              <Coins className="h-3.5 w-3.5 text-amber-500" />
            </TooltipTrigger>
            <TooltipContent>
              {underlyingReady
                ? `Your position: ${formatTokenAmount(underlying.assetA, decimalsA.decimals)} ${labelA} + ${formatTokenAmount(underlying.assetB, decimalsB.decimals)} ${labelB}`
                : "You have a position in this pool"}
            </TooltipContent>
          </Tooltip>
        ) : (
          pool.pair
        )}
      </TableCell>
      <TableCell className="text-center">{pool.venue}</TableCell>
      <TableCell className="text-center">{formatAda(pool.tvlAda)}</TableCell>
      <AprCell apr={pool.feeApr7d} target={7} />
      <AprCell apr={pool.feeApr30d} target={30} />
      <TableCell className="text-center">
        <Button size="sm" disabled={!walletConnected} onClick={() => onEnterPool(pool)}>
          Enter Pool
        </Button>
      </TableCell>
    </TableRow>
  );
}

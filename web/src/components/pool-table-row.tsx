import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAda, formatApr } from "@/lib/format";
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
          <sup className="ml-0.5 text-muted-foreground">*</sup>
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
}: {
  pool: PoolRow;
  striped?: boolean;
}) {
  return (
    <TableRow className={striped ? "bg-brand-cardano-blue/10" : undefined}>
      <TableCell className="text-center">{pool.pair}</TableCell>
      <TableCell className="text-center">{pool.venue}</TableCell>
      <TableCell className="text-center">{formatAda(pool.tvlAda)}</TableCell>
      <AprCell apr={pool.feeApr7d} target={7} />
      <AprCell apr={pool.feeApr30d} target={30} />
      <TableCell className="text-center">
        <Button size="sm" disabled>
          Enter Pool
        </Button>
      </TableCell>
    </TableRow>
  );
}

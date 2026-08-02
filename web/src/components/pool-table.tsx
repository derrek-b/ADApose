import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PoolRow } from "@/lib/pool-row";
import { PoolTableRow } from "@/components/pool-table-row";

export function PoolTable({ pools }: { pools: PoolRow[] }) {
  return (
    <Table className="table-fixed border-l border-r border-b">
      <TableHeader className="border">
        <TableRow className="divide-x bg-brand-crimson">
          <TableHead className="text-center text-white font-bold">Pair</TableHead>
          <TableHead className="text-center text-white font-bold">DEX</TableHead>
          <TableHead className="text-center text-white font-bold">TVL</TableHead>
          <TableHead className="text-center text-white font-bold">7D APR</TableHead>
          <TableHead className="text-center text-white font-bold">30D APR</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {pools.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              No pools found.
            </TableCell>
          </TableRow>
        ) : (
          pools.map((pool, i) => (
            <PoolTableRow
              key={`${pool.venue}-${pool.pair}`}
              pool={pool}
              striped={i % 2 === 1}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}

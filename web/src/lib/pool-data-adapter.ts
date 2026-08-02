import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { currentReadings } from "@/db/schema";
import type { FeeApr, PoolRow } from "@/lib/pool-row";

// pool_label is written as "<venue-script-prefix>-<assetA>-<assetB>" (e.g.
// "MIN2-ADA-MIN") by enumerate_minswap.py -- the prefix duplicates what the
// DEX column already shows, so strip it for a clean "ADA/MIN" pair display.
function poolLabelToPair(poolLabel: string | null): string {
  if (!poolLabel) return "Unknown";
  const [, ...assetParts] = poolLabel.split("-");
  return assetParts.join("/").trim();
}

function toFeeApr(pct: string | null, actualDays: string | null): FeeApr | null {
  if (pct === null || actualDays === null) return null;
  return { value: Number(pct), actualDays: Number(actualDays) };
}

export async function getPoolRows(): Promise<PoolRow[]> {
  const rows = await db
    .select()
    .from(currentReadings)
    .orderBy(sql`${currentReadings.tvlAda} DESC NULLS LAST`);

  return rows.map((row) => ({
    pair: poolLabelToPair(row.poolLabel),
    venue: row.venue,
    tvlAda: row.tvlAda !== null ? Number(row.tvlAda) : null,
    feeApr7d: toFeeApr(row.feeApr7dPct, row.feeApr7dActualDays),
    feeApr30d: toFeeApr(row.feeApr30dPct, row.feeApr30dActualDays),
  }));
}

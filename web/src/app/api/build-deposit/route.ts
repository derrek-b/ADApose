import { getAdapter } from "@lib/adapters/registry";
import { getTxFee } from "@lib/tx-fee";

// Bounded, not unlimited: confirmed via live reproduction (2026-08-06,
// real wallet with a single UTXO holding both ADA and an LP token) that
// one insufficient-balance correction isn't always enough -- reducing the
// deposit amount to fix one shortfall (cause: "change") triggered a
// *different* shortfall (cause: "change_split") once coin selection picked
// a different shape for the smaller amount; it took two corrections to
// land on a working amount. All rounds reuse the same walletUtxoCbors
// snapshot from this one request -- nothing about the wallet changes
// between rounds since nothing is ever submitted, so retrying here (rather
// than round-tripping back to the client each time) is safe and avoids N
// extra client<->server hops for what the client would've done anyway.
const MAX_BUILD_ROUNDS = 5;

// Server-only boundary, same reason as ../pool-state/route.ts -- see
// lib/adapters/minswap.ts's own header comment. Dispatches by `venue`
// (getAdapter, lib/adapters/registry.ts) rather than hardcoding one
// platform.
export async function POST(request: Request) {
  const body = await request.json();
  const { venue, sender, walletUtxoCbors, assetA, assetB, amountA, amountB, slippage } = body;

  if (
    !venue ||
    !sender ||
    !Array.isArray(walletUtxoCbors) ||
    !assetA ||
    !assetB ||
    amountA === undefined ||
    amountB === undefined ||
    slippage === undefined
  ) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  let adapter;
  try {
    adapter = getAdapter(venue);
  } catch (err) {
    // Unregistered venue -- this venue's data shouldn't be reaching the UI
    // at all yet, not a transient failure worth retrying.
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  let currentAmountA = BigInt(amountA);
  let currentAmountB = BigInt(amountB);
  // Whichever asset the most recent round adjusted -- carried outside the
  // loop so the final give-up response (below) can report the right one.
  let lastAdjustedAsset: string | null = null;

  for (let round = 0; round < MAX_BUILD_ROUNDS; round++) {
    try {
      const { cbor } = await adapter.buildDepositOrder({
        sender,
        walletUtxoCbors,
        assetA,
        assetB,
        amountA: currentAmountA,
        amountB: currentAmountB,
        slippage,
      });
      const fee = getTxFee(cbor);
      return Response.json({
        cbor,
        fee: fee.toString(),
        adjustedAmountA: currentAmountA.toString(),
        adjustedAmountB: currentAmountB.toString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Confirmed by actually triggering this failure (an empty
      // walletUtxoCbors against a real sender/amount), not assumed:
      // @minswap/internal-sdk throws a TxBuildingError with this exact
      // message for a coin-selection failure -- this build will fail
      // identically no matter how many times it's retried at the SAME
      // amount, so it's the one case that gets 400 (non-retryable)
      // rather than the 502 (retryable) default. Everything else --
      // network blips, upstream issues -- stays 502, matching
      // ../pool-state/route.ts's own convention.
      const nonRetryable = message === "Insufficient balance";

      // The nested InsufficientBalanceError (confirmed via live testing,
      // not assumed) carries the exact shortfall -- asset, missingQty,
      // cause (e.g. "change_split", when the wallet's other UTXOs force an
      // extra change output).
      const nested = (err as { error?: { asset?: string; missingQty?: string } } | null)?.error;
      const isA = nested?.asset === assetA;
      const isB = nested?.asset === assetB;

      if (!(nonRetryable && nested?.missingQty !== undefined && (isA || isB))) {
        // Not a matched-asset shortfall -- either the ADA-outside-the-pool
        // case (neither assetA nor assetB), or a non-insufficient-balance
        // error. No lever to adjust either way; report it as-is, same
        // shape as before this retry loop existed.
        return Response.json(
          { error: message, asset: nested?.asset, missingQty: nested?.missingQty },
          { status: nonRetryable ? 400 : 502 },
        );
      }

      const missingQty = BigInt(nested.missingQty);
      const before = isA ? currentAmountA : currentAmountB;
      const after = before > missingQty ? before - missingQty : 0n;
      lastAdjustedAsset = nested.asset ?? null;
      if (isA) currentAmountA = after;
      else currentAmountB = after;

      // Already at the floor (0) and still short -- no further reduction
      // is possible, so stop now instead of burning remaining rounds on an
      // identical amount.
      if (after === before) break;
    }
  }

  // Exhausted MAX_BUILD_ROUNDS (or hit the floor early) without a working
  // amount -- report the lowest amount actually tried for whichever asset
  // kept failing, not a generic message. Same 400 (non-retryable) status:
  // retrying this exact request would reproduce the same rounds.
  const finalAmount = lastAdjustedAsset === assetA ? currentAmountA : currentAmountB;
  return Response.json(
    {
      error: "Could not find a working amount",
      asset: lastAdjustedAsset,
      lastTriedAmount: finalAmount.toString(),
    },
    { status: 400 },
  );
}

import { getAdapter } from "@lib/adapters/registry";

// Server-only boundary for anything touching a DEX SDK -- see
// lib/adapters/minswap.ts's own header comment for why (it pulls in a
// Node-only WASM tx-builder that can't be bundled for a browser at all).
// The client calls this route instead of importing an adapter directly.
// Dispatches by `venue` (getAdapter, lib/adapters/registry.ts) rather than
// hardcoding one platform -- every pool row already carries its own venue.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venue = searchParams.get("venue");
  const assetA = searchParams.get("assetA");
  const assetB = searchParams.get("assetB");
  if (!venue || !assetA || !assetB) {
    return Response.json({ error: "venue, assetA and assetB are required" }, { status: 400 });
  }

  try {
    const state = await getAdapter(venue).getPoolState(assetA, assetB);
    // bigint isn't JSON-serializable -- stringify each field, parsed back to
    // bigint on the client side.
    return Response.json({
      reserveA: state.reserveA.toString(),
      reserveB: state.reserveB.toString(),
      totalLiquidity: state.totalLiquidity.toString(),
      feeANumerator: state.feeANumerator.toString(),
      feeBNumerator: state.feeBNumerator.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Confirmed via getAdapter's own throw: an unregistered venue is a bad
    // request (this venue's data shouldn't be reaching the UI at all yet),
    // not a transient upstream failure -- everything else stays 502,
    // matching the retryable/non-retryable split used elsewhere.
    const nonRetryable = message.startsWith("No adapter registered for venue");
    return Response.json({ error: message }, { status: nonRetryable ? 400 : 502 });
  }
}

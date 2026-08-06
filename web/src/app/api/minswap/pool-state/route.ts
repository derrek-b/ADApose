import { getPoolState } from "@lib/adapters/minswap";

// Server-only boundary for anything touching @minswap/sdk-v2 -- see
// lib/adapters/minswap.ts's own header comment for why (it pulls in a
// Node-only WASM tx-builder that can't be bundled for a browser at all).
// The client calls this route instead of importing getPoolState directly.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const assetA = searchParams.get("assetA");
  const assetB = searchParams.get("assetB");
  if (!assetA || !assetB) {
    return Response.json({ error: "assetA and assetB are required" }, { status: 400 });
  }

  try {
    const state = await getPoolState(assetA, assetB);
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
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

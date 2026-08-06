import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack only resolves modules inside its filesystem root. lib/ sits
  // one level up as a workspace sibling, not inside web/, so the root has to
  // be widened explicitly or @lib/* imports 404 at bundle time even though
  // tsc resolves them fine. Only safe now that this is a real npm workspace
  // (root node_modules has everything, including Next's own deps like
  // @swc/helpers) -- tried this once before without the workspace and it
  // broke Next's own module resolution. See node_modules/next/dist/docs/
  // .../08-turbopack.md "Root directory".
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  // These pull in native/WASM code (@minswap/internal-sdk's Cardano
  // serialization bindings) that needs real Node `require()` and real
  // filesystem paths for its .wasm binary -- Turbopack's own bundling of
  // Server Components/Route Handlers rewrites those paths and breaks it
  // (hit this directly: ENOENT looking for a literal "/ROOT/..." path that
  // was never substituted). This opts them out of that bundling entirely.
  serverExternalPackages: [
    "@minswap/sdk-v2",
    "@minswap/internal-sdk",
    "@minswap/cardano-serialization-lib-nodejs",
    "@emurgo/cardano-serialization-lib-nodejs",
    "@minswap/wasm-helpers",
  ],
};

export default nextConfig;

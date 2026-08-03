"use client";

import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";

// `ssr: false` only works when called from a Client Component (Next's App
// Router rejects it from a Server Component), and it's what actually keeps
// this file's future WASM/CIP-30 imports out of the server bundle — see
// docs/decisions.md D29 addendum.
export const ConnectWalletButton = dynamic(
  () =>
    import("@/components/wallet/connect-wallet-button").then(
      (m) => m.ConnectWalletButton,
    ),
  {
    ssr: false,
    loading: () => (
      <Button variant="outline" disabled>
        Connect Wallet
      </Button>
    ),
  },
);

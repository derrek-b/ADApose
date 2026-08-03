"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Lucid } from "@spacebudz/lucid";

import { rememberWallet, forgetWallet } from "@/components/wallet/storage";

type WalletStatus = "disconnected" | "connecting" | "connected";

type WalletState = {
  status: WalletStatus;
  walletKey: string | null;
  address: string | null;
  walletName: string | null;
  walletIcon: string | null;
  network: "mainnet" | "testnet" | null;
  lucid: Lucid | null;
};

const initialState: WalletState = {
  status: "disconnected",
  walletKey: null,
  address: null,
  walletName: null,
  walletIcon: null,
  network: null,
  lucid: null,
};

type ConnectResult = {
  key: string;
  lucid: Lucid;
  address: string;
  walletName: string;
  walletIcon: string;
  network: "mainnet" | "testnet";
};

type WalletContextValue = WalletState & {
  beginConnecting: () => void;
  finishConnecting: (result: ConnectResult) => void;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(initialState);

  // Memoized (stable identity) so components can safely depend on these in
  // their own effects — e.g. a mount-time auto-reconnect attempt — without
  // the effect re-firing on every WalletProvider render.
  const beginConnecting = useCallback(() => {
    setState((s) => ({ ...s, status: "connecting" }));
  }, []);

  const finishConnecting = useCallback(({ key, ...result }: ConnectResult) => {
    rememberWallet(key);
    setState({ status: "connected", walletKey: key, ...result });
  }, []);

  const disconnect = useCallback(() => {
    forgetWallet();
    setState(initialState);
  }, []);

  return (
    <WalletContext.Provider
      value={{ ...state, beginConnecting, finishConnecting, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}

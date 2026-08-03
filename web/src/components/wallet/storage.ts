// Deliberately zero imports (no Lucid, no React) — this file is imported
// directly by wallet-context.tsx, which is NOT behind the ssr:false boundary
// (see connect-wallet-button-dynamic.tsx). Anything imported from cip30.ts
// would drag its real @spacebudz/lucid import (and WASM init side effect)
// into the eagerly-loaded server bundle.

const STORAGE_KEY = "adapose:wallet";

export function rememberWallet(key: string) {
  localStorage.setItem(STORAGE_KEY, key);
}

export function forgetWallet() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getRememberedWallet(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

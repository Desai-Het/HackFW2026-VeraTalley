import { useCallback, useEffect, useState } from "react";
import { describeError, getBrowserProvider } from "./contracts";
import { ensureCorrectNetwork } from "./network";

/** A signer for the wallet's current account, after making sure the wallet is on the right
 *  network. Every transaction the app sends goes through this. */
export async function getWalletSigner() {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error("No wallet found.");
  await ensureCorrectNetwork(ethereum);
  return getBrowserProvider(ethereum).getSigner();
}

/** Shared wallet connection for the pages that need one.
 *
 *  On load it quietly restores a connection the person already approved (eth_accounts never
 *  opens a wallet popup), so moving between pages doesn't ask them to connect again. It follows
 *  account switches made in the wallet. `hasWallet` is null until the page has mounted, because
 *  the browser's wallet isn't there during server rendering. */
export function useWallet() {
  const [account, setAccount] = useState<string | null>(null);
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ethereum = (window as any).ethereum;
    setHasWallet(Boolean(ethereum));
    if (!ethereum) return;

    let cancelled = false;
    Promise.resolve(ethereum.request({ method: "eth_accounts" }))
      .then((accounts: string[]) => {
        if (!cancelled && accounts[0]) setAccount(accounts[0]);
      })
      .catch(() => {
        // Not connected yet - the person can press Connect wallet.
      });

    const onAccountsChanged = (accounts: string[]) => setAccount(accounts[0] ?? null);
    ethereum.on?.("accountsChanged", onAccountsChanged);
    return () => {
      cancelled = true;
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setError(
        "No wallet found. Install MetaMask from metamask.io to continue - you can still look at elections without it."
      );
      return;
    }
    try {
      // Connect first so MetaMask always opens, then guide the wallet onto the right network.
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      await ensureCorrectNetwork(ethereum);
      setAccount(accounts[0] ?? null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  return { account, hasWallet, connect, error };
}

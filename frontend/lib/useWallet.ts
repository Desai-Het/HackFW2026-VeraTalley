import { useCallback, useEffect, useState } from "react";
import { useActiveAccount, useConnectModal } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { describeError, getBrowserProvider } from "./contracts";
import { ensureCorrectNetwork } from "./network";
import { appChain, appWallets, THIRDWEB_ENABLED, thirdwebClient } from "./thirdweb";
import { getActiveWallet } from "./walletStore";

/** A signer for the wallet's current account, after making sure the wallet is on the right
 *  network. Every transaction the app sends goes through this.
 *
 *  With thirdweb on, this is the signed-in email/Google (or MetaMask) wallet wrapped as an ethers
 *  signer, so the rest of the app keeps using ethers contracts unchanged. */
export async function getWalletSigner() {
  if (THIRDWEB_ENABLED && thirdwebClient) {
    const wallet = getActiveWallet();
    const account = wallet?.getAccount();
    if (!wallet || !account) throw new Error("Please sign in first.");
    if (wallet.getChain()?.id !== appChain.id) await wallet.switchChain(appChain);
    return ethers6Adapter.signer.toEthers({ client: thirdwebClient, chain: appChain, account });
  }
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error("No wallet found.");
  await ensureCorrectNetwork(ethereum);
  return getBrowserProvider(ethereum).getSigner();
}

type WalletState = {
  account: string | null;
  /** null until mounted. With thirdweb on it's always true: email/Google sign-in needs no extension. */
  hasWallet: boolean | null;
  connect: () => Promise<void>;
  error: string | null;
};

/** thirdweb version: the account comes from thirdweb's own state (restored on reload by
 *  AutoConnect in WalletProvider), and connect opens the sign-in window. */
function useThirdwebWallet(): WalletState {
  const activeAccount = useActiveAccount();
  const { connect: openConnectModal } = useConnectModal();
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    if (!thirdwebClient) return;
    try {
      await openConnectModal({
        client: thirdwebClient,
        wallets: appWallets,
        chain: appChain,
        title: "Sign in to VeraTally",
        size: "compact",
      });
    } catch (err) {
      // Closing the sign-in window rejects with no error - nothing worth showing.
      if (!err) return;
      setError(describeError(err));
    }
  }, [openConnectModal]);

  return { account: activeAccount?.address ?? null, hasWallet: true, connect, error };
}

/** Original MetaMask-only version, used when no thirdweb client ID is configured.
 *
 *  On load it quietly restores a connection the person already approved (eth_accounts never
 *  opens a wallet popup), so moving between pages doesn't ask them to connect again. It follows
 *  account switches made in the wallet. `hasWallet` is null until the page has mounted, because
 *  the browser's wallet isn't there during server rendering. */
function useInjectedWallet(): WalletState {
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

/** Shared wallet connection for the pages that need one. THIRDWEB_ENABLED is fixed at build time,
 *  so each build always calls the same hook (React's rules of hooks still hold). */
export const useWallet: () => WalletState = THIRDWEB_ENABLED ? useThirdwebWallet : useInjectedWallet;

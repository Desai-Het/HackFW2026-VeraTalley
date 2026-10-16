import { useCallback, useEffect, useState } from "react";
import { describeError, getBrowserProvider, getReadProvider } from "./contracts";
import { ensureCorrectNetwork, getTargetChainId } from "./network";

const GWEI = 1_000_000_000n;
const AMOY_MIN_TIP = 30n * GWEI;

/** Polygon Amoy rejects (or never mines) transactions whose priority fee is under about 25 gwei,
 *  but wallets often suggest much less. The wallet then shows "Interaction failed" even though
 *  nothing reached the chain. So on Amoy every transaction gets a fee that is read from the
 *  network and never below a safe floor. Contract calls go through signer.sendTransaction, so
 *  wrapping that one method covers every call the app makes. */
function withAmoyFees<T extends { sendTransaction: (tx: any) => Promise<any> }>(signer: T): T {
  if (getTargetChainId() !== 80002) return signer;
  const send = signer.sendTransaction.bind(signer);
  signer.sendTransaction = async (tx: any) => {
    if (tx.maxPriorityFeePerGas == null && tx.gasPrice == null) {
      let tip = AMOY_MIN_TIP;
      let max = 2n * AMOY_MIN_TIP;
      try {
        const fee = await getReadProvider().getFeeData();
        if (fee.maxPriorityFeePerGas && fee.maxPriorityFeePerGas > tip) tip = fee.maxPriorityFeePerGas;
        const base = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
        max = base * 2n > tip * 2n ? base * 2n : tip * 2n;
      } catch {
        // Could not read the network: the floor above is still safe.
      }
      tx = { ...tx, maxPriorityFeePerGas: tip, maxFeePerGas: max };
    }
    return send(tx);
  };
  return signer;
}

/** A signer for the wallet's current account, after making sure the wallet is on the right
 *  network. Every transaction the app sends goes through this. */
export async function getWalletSigner() {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error("No wallet found.");
  await ensureCorrectNetwork(ethereum);
  return withAmoyFees(await getBrowserProvider(ethereum).getSigner());
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
      await ensureCorrectNetwork(ethereum);
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0] ?? null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  return { account, hasWallet, connect, error };
}

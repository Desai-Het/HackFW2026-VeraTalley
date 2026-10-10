"use client";

import { useEffect } from "react";
import { ThirdwebProvider, AutoConnect, useActiveAccount, useActiveWallet } from "thirdweb/react";
import { appChain, appWallets, LOCAL_CHAIN_ID, THIRDWEB_ENABLED, thirdwebClient } from "@/lib/thirdweb";
import { setActiveWallet } from "@/lib/walletStore";

const LOCAL_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
// 10 test ETH, as hex wei. Plenty for voting and creating elections on a local node.
const LOCAL_TOP_UP_WEI = "0x8AC7230489E80000";

/** On a local Hardhat node, a brand-new email/Google wallet has no ETH to pay for gas. Hardhat
 *  lets anyone set a balance with hardhat_setBalance, so we top the wallet up once. This only ever
 *  runs against chain 31337; on Amoy, sponsored gas covers fees instead. */
async function topUpLocalWallet(address: string) {
  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(LOCAL_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return (await res.json()).result as string;
  };
  try {
    const balance = await call("eth_getBalance", [address, "latest"]);
    if (BigInt(balance) === 0n) await call("hardhat_setBalance", [address, LOCAL_TOP_UP_WEI]);
  } catch (err) {
    console.warn("Could not top up the local test wallet", err);
  }
}

function ActiveWalletSync() {
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  useEffect(() => {
    setActiveWallet(wallet ?? null);
  }, [wallet]);
  useEffect(() => {
    if (account && appChain.id === LOCAL_CHAIN_ID) topUpLocalWallet(account.address);
  }, [account]);
  return null;
}

/** Wraps the app in thirdweb's provider when a client ID is configured; otherwise does nothing
 *  and the original MetaMask flow is used. AutoConnect restores a session after a page reload. */
export default function WalletProvider({ children }: { children: React.ReactNode }) {
  if (!THIRDWEB_ENABLED || !thirdwebClient) return <>{children}</>;
  return (
    <ThirdwebProvider>
      <AutoConnect client={thirdwebClient} wallets={appWallets} />
      <ActiveWalletSync />
      {children}
    </ThirdwebProvider>
  );
}

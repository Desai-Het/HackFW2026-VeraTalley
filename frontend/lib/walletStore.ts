import type { Wallet } from "thirdweb/wallets";

// The thirdweb wallet that is signed in right now. WalletProvider keeps it up to date from
// thirdweb's React state, so plain (non-hook) code like getWalletSigner can reach it.
let activeWallet: Wallet | null = null;

export function setActiveWallet(wallet: Wallet | null) {
  activeWallet = wallet;
}

export function getActiveWallet(): Wallet | null {
  return activeWallet;
}

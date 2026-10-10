// thirdweb in-app wallets: voters sign in with email or Google and get a wallet created for them,
// so there is no extension to install, no seed phrase and no network to add. MetaMask stays
// available in the same sign-in window for people who already have a wallet.
//
// All of this is switched on by NEXT_PUBLIC_THIRDWEB_CLIENT_ID. Without it the app keeps the
// original MetaMask-only flow (lib/network.ts + window.ethereum), so nothing breaks before the
// team has a thirdweb client ID.

import { createThirdwebClient, defineChain, type ThirdwebClient } from "thirdweb";
import { polygonAmoy } from "thirdweb/chains";
import { createWallet, inAppWallet, type Wallet } from "thirdweb/wallets";

const CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 80002);
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "";

export const LOCAL_CHAIN_ID = 31337;

export const THIRDWEB_ENABLED = Boolean(CLIENT_ID);

export const thirdwebClient: ThirdwebClient | null = THIRDWEB_ENABLED
  ? createThirdwebClient({ clientId: CLIENT_ID })
  : null;

/** The chain the app runs on. A local Hardhat node is defined by hand with our own RPC URL so
 *  thirdweb (and MetaMask, through thirdweb) talk to it directly. */
export const appChain =
  CHAIN_ID === polygonAmoy.id
    ? polygonAmoy
    : defineChain({
        id: CHAIN_ID,
        name: CHAIN_ID === LOCAL_CHAIN_ID ? "Hardhat Local" : `Chain ${CHAIN_ID}`,
        rpc: RPC_URL || "http://127.0.0.1:8545",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        testnet: true,
      });

/** Sponsored gas (the app pays voters' transaction fees) only exists on public chains that
 *  thirdweb runs infrastructure for, so it is on for Amoy and off for a local node. Locally,
 *  new email/Google wallets are topped up with test ETH instead (see WalletProvider). */
export const SPONSOR_GAS = appChain.id === polygonAmoy.id;

export const appWallets: Wallet[] = [
  inAppWallet({
    auth: { options: ["email", "google"] },
    ...(SPONSOR_GAS
      ? {
          executionMode: {
            mode: "EIP4337" as const,
            smartAccount: { chain: appChain, sponsorGas: true },
          },
        }
      : {}),
  }),
  createWallet("io.metamask"),
];

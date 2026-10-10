"use client";

import { ConnectButton } from "thirdweb/react";
import { appChain, appWallets, THIRDWEB_ENABLED, thirdwebClient } from "@/lib/thirdweb";

/** Sign-in button in the top bar. Shows the signed-in address once connected (that's the
 *  address an election admin adds to the voter list). Hidden without a thirdweb client ID. */
export default function NavWallet() {
  if (!THIRDWEB_ENABLED || !thirdwebClient) return null;
  return (
    <span className="site-nav-wallet">
      <ConnectButton
        client={thirdwebClient}
        wallets={appWallets}
        chain={appChain}
        connectButton={{ label: "Sign in" }}
        connectModal={{ title: "Sign in to VeraTally", size: "compact" }}
      />
    </span>
  );
}

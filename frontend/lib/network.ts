// Helpers for getting the connected wallet onto Polygon Amoy (FR-05: "guided onto the right
// network"). Uses the standard EIP-3085/EIP-3326 wallet RPC methods MetaMask supports.

export const AMOY_CHAIN_ID = 80002;
const AMOY_CHAIN_ID_HEX = "0x13882";

const AMOY_PARAMS = {
  chainId: AMOY_CHAIN_ID_HEX,
  chainName: "Polygon Amoy Testnet",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: ["https://rpc-amoy.polygon.technology/"],
  blockExplorerUrls: ["https://amoy.polygonscan.com/"],
};

export const HARDHAT_CHAIN_ID = 31337;

/** Network details for a local Hardhat node, so MetaMask can add it on its own instead of the
 *  person typing them in by hand. Uses the same RPC URL the app reads from. */
function localHardhatParams() {
  return {
    chainId: "0x" + HARDHAT_CHAIN_ID.toString(16),
    chainName: "Hardhat Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545"],
  };
}

/** True when the wallet says it doesn't know the requested network yet. MetaMask normally
 *  reports this as code 4902, but some versions wrap it inside a generic -32603 error. */
function isUnknownChainError(err: any): boolean {
  return (
    err?.code === 4902 ||
    err?.data?.originalError?.code === 4902 ||
    /unrecognized chain|not been added/i.test(err?.message ?? "")
  );
}

export function getTargetChainId(): number {
  const configured = process.env.NEXT_PUBLIC_CHAIN_ID;
  return configured ? Number(configured) : AMOY_CHAIN_ID;
}

/** Asks the wallet to switch to the target network, adding it first if the wallet doesn't know
 *  it yet. Knows how to *add* Polygon Amoy and a local Hardhat node (31337); for any other chain
 *  id it only attempts a switch. */
export async function ensureCorrectNetwork(ethereum: any): Promise<void> {
  const targetChainId = getTargetChainId();
  const targetHex = "0x" + targetChainId.toString(16);

  const currentChainIdHex: string = await ethereum.request({ method: "eth_chainId" });
  if (parseInt(currentChainIdHex, 16) === targetChainId) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
  } catch (switchError: any) {
    const addParams =
      targetChainId === AMOY_CHAIN_ID
        ? AMOY_PARAMS
        : targetChainId === HARDHAT_CHAIN_ID
          ? localHardhatParams()
          : null;
    if (isUnknownChainError(switchError) && addParams) {
      // Adding a network in MetaMask also switches to it once the person approves.
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [addParams],
      });
    } else {
      throw switchError;
    }
  }
}

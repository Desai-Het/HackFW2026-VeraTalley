// Helpers for getting the connected wallet onto Polygon Amoy (FR-05: "guided onto the right
// network"). Uses the standard EIP-3085/EIP-3326 wallet RPC methods MetaMask supports.

export const AMOY_CHAIN_ID = 80002;
const AMOY_CHAIN_ID_HEX = "0x13882";

const AMOY_PARAMS = {
  chainId: AMOY_CHAIN_ID_HEX,
  chainName: "Polygon Amoy Testnet",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL || "https://rpc-amoy.polygon.technology/"],
  blockExplorerUrls: ["https://amoy.polygonscan.com/"],
};

export function getTargetChainId(): number {
  const configured = process.env.NEXT_PUBLIC_CHAIN_ID;
  return configured ? Number(configured) : AMOY_CHAIN_ID;
}

/** Asks the wallet to switch to the target network, adding it first if the wallet doesn't know
 *  it yet. Only knows how to *add* Amoy specifically - for any other configured chain id (e.g.
 *  a local Hardhat node during development) it only attempts a switch, since there's no single
 *  right RPC URL to offer for "add" in that case. */
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
    // 4902 = the wallet doesn't have this network yet.
    if (switchError?.code === 4902 && targetChainId === AMOY_CHAIN_ID) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [AMOY_PARAMS],
      });
    } else {
      throw switchError;
    }
  }
}

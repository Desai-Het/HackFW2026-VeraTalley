import type { Contract, ContractTransactionReceipt } from "ethers";
import { ApiError, enqueue, feeOverrides, relayerWallet } from "./config";

/** Sends one transaction from the server wallet, one at a time (the wallet is shared with the
 *  voting relayer, so everything goes through the same queue). A dry run first means a refused
 *  action fails before any gas is spent. */
export function sendFromServerWallet(
  contract: Contract,
  method: string,
  args: unknown[],
  gasLimit?: bigint
): Promise<ContractTransactionReceipt> {
  const wallet = relayerWallet();
  return enqueue(async () => {
    const c = contract.connect(wallet) as Contract;
    await c[method].staticCall(...args);
    let tx;
    try {
      tx = await c[method](...args, { ...(await feeOverrides()), ...(gasLimit ? { gasLimit } : {}) });
    } catch (err) {
      wallet.reset(); // re-read the real nonce next time
      throw err;
    }
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new ApiError("The transaction did not go through.", 502);
    return receipt as ContractTransactionReceipt;
  });
}

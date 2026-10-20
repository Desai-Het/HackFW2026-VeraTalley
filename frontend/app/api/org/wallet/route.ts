import { formatEther } from "ethers";
import { clientKey, rateLimit, relayerAddress, serverProvider } from "@/lib/server/config";
import { requireOwner } from "@/lib/server/session";
import { fail, ok } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The server wallet's address and balance. Owner only: this is the wallet that creates and runs
 *  every election and pays every fee, so the owner needs to see when it runs low. */
export async function GET(req: Request) {
  try {
    rateLimit("wallet:" + clientKey(req), 30, 60_000);
    await requireOwner(req);
    const address = relayerAddress();
    const balance = Number(formatEther(await serverProvider().getBalance(address)));
    return ok({ address, balance, low: balance < 0.05 });
  } catch (err) {
    return fail(err);
  }
}

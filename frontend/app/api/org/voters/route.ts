import { getAddress, isAddress } from "ethers";
import { ApiError, clientKey, rateLimit, registryAt } from "@/lib/server/config";
import { sendFromServerWallet } from "@/lib/server/orgchain";
import { requireManager } from "@/lib/server/session";
import { fail, ok, readJson } from "@/lib/server/http";
import { MAX_VOTERS_PER_TRANSACTION } from "@/lib/elections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adds voters by wallet address (for people who have their own wallet). */
export async function POST(req: Request) {
  try {
    rateLimit("voters:" + clientKey(req), 20, 60_000);
    const body = await readJson(req);
    const { election } = await requireManager(req, body.electionId);
    if (!Array.isArray(body.addresses) || body.addresses.some((a: unknown) => typeof a !== "string" || !isAddress(a))) {
      throw new ApiError("One of the wallet addresses is not valid.");
    }
    const addresses = [...new Set<string>(body.addresses.map((a: string) => getAddress(a)))];
    if (addresses.length === 0) throw new ApiError("Add at least one wallet address.");
    if (addresses.length > MAX_VOTERS_PER_TRANSACTION) throw new ApiError(`Add at most ${MAX_VOTERS_PER_TRANSACTION} voters at a time.`);
    const registry = registryAt(election.registry);
    const receipt = await sendFromServerWallet(registry, "registerVoters", [addresses]);
    let added = 0;
    for (const log of receipt.logs) {
      try {
        if (registry.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "VoterRegistered") added += 1;
      } catch {
        // not a registry event
      }
    }
    return ok({ added, already: addresses.length - added });
  } catch (err) {
    return fail(err);
  }
}

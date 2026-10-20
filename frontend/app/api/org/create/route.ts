import { ApiError, clientKey, factoryAt, rateLimit } from "@/lib/server/config";
import { MAX_ELECTIONS_PER_USER, electionCountOf, recordElectionOwner } from "@/lib/server/accounts";
import { sendFromServerWallet } from "@/lib/server/orgchain";
import { requireLogin } from "@/lib/server/session";
import { fail, ok, readJson } from "@/lib/server/http";
import { validateCandidates, validateTitle } from "@/lib/elections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates an election. The server wallet signs and pays, so the organiser needs no wallet, and
 *  the account that asked is recorded as the one that manages it. */
export async function POST(req: Request) {
  try {
    const user = await requireLogin(req);
    rateLimit("create:" + user.username, 10, 3_600_000);
    rateLimit("create-ip:" + clientKey(req), 30, 3_600_000);
    const body = await readJson(req);
    if (typeof body.title !== "string" || !Array.isArray(body.candidates) || body.candidates.some((c: unknown) => typeof c !== "string")) {
      throw new ApiError("Bad request.");
    }
    const title = validateTitle(body.title);
    if (title.error) throw new ApiError(title.error);
    const candidates = validateCandidates(body.candidates);
    if (candidates.error) throw new ApiError(candidates.error);
    if (user.role !== "owner" && (await electionCountOf(user.username)) >= MAX_ELECTIONS_PER_USER) {
      throw new ApiError("You have reached the limit of elections for one account.", 403);
    }

    const factory = factoryAt();
    // One transaction deploys two contracts (about 2M gas). Estimates for that can come out too
    // low on public networks, so a generous limit is set; only gas actually used is paid for.
    const receipt = await sendFromServerWallet(factory, "createElection", [title.value, candidates.cleaned], 3_500_000n);
    let id: number | null = null;
    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === "ElectionCreated") id = Number(parsed.args.electionId);
      } catch {
        // not one of the factory's events
      }
    }
    if (id === null) throw new ApiError("The election was created but its number could not be read. Ask the site owner to check.", 502);
    await recordElectionOwner(id, user.username);
    return ok({ electionId: id });
  } catch (err) {
    return fail(err);
  }
}

import { ApiError, ballotAt, clientKey, rateLimit } from "@/lib/server/config";
import { sendFromServerWallet } from "@/lib/server/orgchain";
import { requireManager } from "@/lib/server/session";
import { fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Opens or closes voting. Both are permanent; the page asks the organiser to confirm first. */
export async function POST(req: Request) {
  try {
    rateLimit("state:" + clientKey(req), 20, 60_000);
    const body = await readJson(req);
    const { election } = await requireManager(req, body.electionId);
    if (body.action !== "open" && body.action !== "close") throw new ApiError("Unknown action.");
    await sendFromServerWallet(ballotAt(election.ballot), body.action === "open" ? "openVoting" : "closeVoting", []);
    return ok({});
  } catch (err) {
    return fail(err);
  }
}

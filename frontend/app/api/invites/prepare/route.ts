import { NextResponse } from "next/server";
import { MAX_INVITES_PER_REQUEST, inviteAddressFromCode, parseEmailList } from "@/lib/invite";
import { ApiError, clientKey, rateLimit, reasonFrom, resolveElection } from "@/lib/server/config";
import { deriveInviteCode, requireAdmin } from "@/lib/server/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 1 of sending invites. Returns the invite ADDRESSES for a list of emails (never the
 *  codes). The admin then puts those addresses on-chain with addInvites, and only after that
 *  does step 2 email the links - so nobody ever receives a link that does not work yet. */
export async function POST(req: Request) {
  try {
    rateLimit("prep:" + clientKey(req), 10, 60_000);
    const body = await req.json().catch(() => null);
    const electionId = body?.electionId;
    const emails = parseEmailList(Array.isArray(body?.emails) ? body.emails.join("\n") : "").valid;
    if (emails.length === 0) throw new ApiError("Add at least one valid email address.");
    if (emails.length > MAX_INVITES_PER_REQUEST) {
      throw new ApiError(`Send at most ${MAX_INVITES_PER_REQUEST} invites at a time.`);
    }
    const election = await resolveElection(electionId);
    await requireAdmin(body, "invites", election, electionId, emails);

    const invites = emails.map((email) => ({
      email,
      address: inviteAddressFromCode(deriveInviteCode(election.registry, email)),
    }));
    return NextResponse.json({ ok: true, invites });
  } catch (err) {
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status: err instanceof ApiError ? err.status : 400 });
  }
}

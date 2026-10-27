import { NextResponse } from "next/server";
import { ApiError, ballotAt, clientKey, rateLimit, reasonFrom, requireOrganiser, resolveElection } from "@/lib/server/config";
import { dataOf, electionKey, read } from "@/lib/server/regstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the public registration page needs to draw itself. Contains no personal data. */
export async function GET(req: Request) {
  try {
    rateLimit("reginfo:" + clientKey(req), 60, 60_000);
    const raw = new URL(req.url).searchParams.get("e") ?? "";
    if (!/^\d{1,9}$/.test(raw)) throw new ApiError("Unknown election.", 404);
    const election = await resolveElection(Number(raw));
    requireOrganiser(election);
    const ballot = ballotAt(election.ballot);
    const [title, state] = await Promise.all([ballot.title(), ballot.state()]);
    const config = await read((d) => dataOf(d, electionKey(election.registry)).config);
    const votingStarted = Number(state) !== 0;
    return NextResponse.json({
      ok: true,
      title: String(title),
      open: config.open && !votingStarted,
      reason: votingStarted ? "voting-started" : config.open ? null : "not-open",
      intro: config.intro,
      fields: config.fields,
      allowedDomains: config.allowedDomains,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status: err instanceof ApiError ? err.status : 400 });
  }
}

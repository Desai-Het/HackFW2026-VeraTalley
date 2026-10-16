import { NextResponse } from "next/server";
import { ApiError, clientKey, rateLimit, reasonFrom, resolveElection } from "@/lib/server/config";
import { createSession } from "@/lib/server/regauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    rateLimit("regsess:" + clientKey(req), 10, 60_000);
    const body = await req.json().catch(() => null);
    const election = await resolveElection(body?.electionId);
    const session = await createSession(req, body, body.electionId, election);
    return NextResponse.json({ ok: true, ...session });
  } catch (err) {
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status: err instanceof ApiError ? err.status : 400 });
  }
}

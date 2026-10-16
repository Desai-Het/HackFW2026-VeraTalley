import { NextResponse } from "next/server";
import { sanitizeConfig, type RegStatus } from "@/lib/registration";
import { ApiError, clientKey, rateLimit, reasonFrom, requireOrganiser, resolveElection } from "@/lib/server/config";
import { linkKey, requireSession } from "@/lib/server/regauth";
import { dataOf, electionKey, mutate, publicRecord, read } from "@/lib/server/regstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Organiser-only actions on one election's registrations. Every call carries the 30 minute
 *  token from /api/registration/session. */
export async function POST(req: Request) {
  try {
    rateLimit("regadmin:" + clientKey(req), 60, 60_000);
    const body = await req.json().catch(() => null);
    const election = await resolveElection(body?.electionId);
    requireOrganiser(election);
    requireSession(body?.token, election);
    const key = electionKey(election.registry);
    const action = body?.action;

    const snapshot = () =>
      read((d) => {
        const el = dataOf(d, key);
        return {
          config: el.config,
          linkKey: linkKey(election.registry, el.config.linkVersion),
          registrations: el.registrations.map(publicRecord),
        };
      });

    if (action === "list") return NextResponse.json({ ok: true, ...(await snapshot()) });

    if (action === "config") {
      const settings = sanitizeConfig(body?.config);
      await mutate((d) => {
        const el = dataOf(d, key);
        el.config = { ...settings, linkVersion: el.config.linkVersion }; // the QR number is not editable here
      });
      return NextResponse.json({ ok: true, ...(await snapshot()) });
    }

    if (action === "decide") {
      const decision: unknown = body?.decision;
      if (decision !== "approved" && decision !== "rejected" && decision !== "pending") throw new ApiError("Unknown decision.");
      const ids = new Set(Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : []);
      await mutate((d) => {
        for (const r of dataOf(d, key).registrations) {
          if (ids.has(r.id) && !r.invited) {
            r.status = decision as RegStatus;
            r.decided = decision !== "pending";
          }
        }
      });
      return NextResponse.json({ ok: true, ...(await snapshot()) });
    }

    if (action === "new-link") {
      await mutate((d) => {
        dataOf(d, key).config.linkVersion += 1;
      });
      return NextResponse.json({ ok: true, ...(await snapshot()) });
    }

    if (action === "purge") {
      if (body?.confirm !== true) throw new ApiError("Please confirm.");
      await mutate((d) => {
        dataOf(d, key).registrations = [];
      });
      return NextResponse.json({ ok: true, ...(await snapshot()) });
    }

    throw new ApiError("Unknown action.");
  } catch (err) {
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status: err instanceof ApiError ? err.status : 400 });
  }
}

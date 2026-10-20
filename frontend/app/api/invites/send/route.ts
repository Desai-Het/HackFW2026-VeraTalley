import { NextResponse } from "next/server";
import { MAX_INVITES_PER_REQUEST, formatCode, inviteAddressFromCode, parseEmailList } from "@/lib/invite";
import {
  ApiError,
  ballotAt,
  clientKey,
  inviteDelivery,
  rateLimit,
  reasonFrom,
  registryAt,
  resolveElection,
} from "@/lib/server/config";
import { sendInviteEmail } from "@/lib/server/email";
import { deriveInviteCode, requireAdmin } from "@/lib/server/invites";
import { markInvited } from "@/lib/server/regstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Result = { email: string; status: "sent" | "already-claimed" | "not-registered" | "failed"; link?: string };

/** Step 2. For each email, checks the invite really is on-chain and unused, then emails the
 *  magic link. Safe to run again: it just re-sends the same link. With INVITE_DELIVERY=links
 *  it returns the links to the admin instead of emailing them (a printable fallback). */
export async function POST(req: Request) {
  try {
    rateLimit("send:" + clientKey(req), 10, 60_000);
    const body = await req.json().catch(() => null);
    const electionId = body?.electionId;
    const emails = parseEmailList(Array.isArray(body?.emails) ? body.emails.join("\n") : "").valid;
    if (emails.length === 0) throw new ApiError("Add at least one valid email address.");
    if (emails.length > MAX_INVITES_PER_REQUEST) {
      throw new ApiError(`Send at most ${MAX_INVITES_PER_REQUEST} invites at a time.`);
    }
    const election = await resolveElection(electionId);
    await requireAdmin(req, body, "invites", election, electionId, emails);

    const registry = registryAt(election.registry);
    const title: string = await ballotAt(election.ballot).title();
    const origin = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
    const delivery = inviteDelivery();
    if (delivery === "email" && !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)) {
      throw new ApiError("Email sending is not set up on this server.", 503);
    }

    const results: Result[] = [];
    for (const email of emails) {
      const code = deriveInviteCode(election.registry, email);
      const status = Number(await registry.inviteStatus(inviteAddressFromCode(code)));
      if (status === 0) {
        results.push({ email, status: "not-registered" });
        continue;
      }
      if (status === 2) {
        results.push({ email, status: "already-claimed" });
        continue;
      }
      // The code travels after the "#", which browsers never send to a server, so it stays out
      // of web server logs.
      const link = `${origin}/elections/${electionId}/vote#${formatCode(code)}`;
      if (delivery === "links") {
        results.push({ email, status: "sent", link });
        continue;
      }
      try {
        await sendInviteEmail(email, title, link);
        results.push({ email, status: "sent" });
      } catch {
        results.push({ email, status: "failed" });
      }
    }
    // Remember who now has an invitation, so the registration screen can show it. Best effort:
    // an invite that went out must never be reported as failed because of bookkeeping.
    try {
      await markInvited(
        election.registry,
        results.filter((r) => r.status === "sent" || r.status === "already-claimed").map((r) => r.email)
      );
    } catch {
      // ignore
    }
    return NextResponse.json({ ok: true, delivery, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status: err instanceof ApiError ? err.status : 400 });
  }
}

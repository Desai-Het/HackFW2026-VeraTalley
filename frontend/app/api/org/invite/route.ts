import { MAX_INVITES_PER_REQUEST, formatCode, inviteAddressFromCode, parseEmailList } from "@/lib/invite";
import { ApiError, ballotAt, clientKey, inviteDelivery, rateLimit, registryAt } from "@/lib/server/config";
import { sendInviteEmail } from "@/lib/server/email";
import { deriveInviteCode } from "@/lib/server/invites";
import { sendFromServerWallet } from "@/lib/server/orgchain";
import { markInvited } from "@/lib/server/regstore";
import { requireManager } from "@/lib/server/session";
import { fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Result = { email: string; status: "sent" | "already-claimed" | "not-registered" | "failed"; link?: string };
const CHUNK = 50;

/** Invites people by email in one step: records their invitations on the blockchain (while the
 *  election is still a draft), then emails each person their personal link, or hands the links
 *  to the organiser when INVITE_DELIVERY=links. Safe to repeat: the same email always gets the
 *  same link. */
export async function POST(req: Request) {
  try {
    rateLimit("invite-ip:" + clientKey(req), 30, 60_000);
    const body = await readJson(req);
    const { user, election, id } = await requireManager(req, body.electionId);
    rateLimit("invite:" + user.username, 10, 60_000);

    const emails = parseEmailList(Array.isArray(body.emails) ? body.emails.join("\n") : "").valid;
    if (emails.length === 0) throw new ApiError("Add at least one valid email address.");
    if (emails.length > MAX_INVITES_PER_REQUEST) throw new ApiError(`Send at most ${MAX_INVITES_PER_REQUEST} invitations at a time.`);

    const delivery = inviteDelivery();
    if (delivery === "email" && !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)) {
      throw new ApiError("Email sending is not set up on this server. Ask the site owner.", 503);
    }

    const registry = registryAt(election.registry);
    const ballot = ballotAt(election.ballot);
    const state = Number(await ballot.state());
    if (state === 2) throw new ApiError("Voting is closed, so invitations can no longer be sent.");

    const items = emails.map((email) => {
      const code = deriveInviteCode(election.registry, email);
      return { email, code, address: inviteAddressFromCode(code) };
    });

    // While the election is a draft, put any new invitations on the blockchain first, so nobody
    // is ever emailed a link that does not work yet.
    if (state === 0) {
      const fresh: string[] = [];
      for (const it of items) if (Number(await registry.inviteStatus(it.address)) === 0) fresh.push(it.address);
      for (let i = 0; i < fresh.length; i += CHUNK) {
        await sendFromServerWallet(registry, "addInvites", [fresh.slice(i, i + CHUNK)]);
      }
    }

    const title: string = await ballot.title();
    const origin = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
    const results: Result[] = [];
    for (const it of items) {
      const status = Number(await registry.inviteStatus(it.address));
      if (status === 0) {
        results.push({ email: it.email, status: "not-registered" });
        continue;
      }
      if (status === 2) {
        results.push({ email: it.email, status: "already-claimed" });
        continue;
      }
      // The code travels after the "#", which browsers never send to a server, so it stays out
      // of web server logs.
      const link = `${origin}/elections/${id}/vote#${formatCode(it.code)}`;
      if (delivery === "links") {
        results.push({ email: it.email, status: "sent", link });
        continue;
      }
      try {
        await sendInviteEmail(it.email, title, link);
        results.push({ email: it.email, status: "sent" });
      } catch (err) {
        console.error("invite email failed:", err);
        results.push({ email: it.email, status: "failed" });
      }
    }
    // Remember who now has an invitation, so the registration screen can show it. Best effort.
    try {
      await markInvited(election.registry, results.filter((r) => r.status === "sent" || r.status === "already-claimed").map((r) => r.email));
    } catch {
      // ignore
    }
    return ok({ delivery, results });
  } catch (err) {
    return fail(err);
  }
}

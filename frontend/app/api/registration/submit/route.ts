import { createHash, randomBytes, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/invite";
import {
  MAX_NAME_LEN,
  MAX_REGISTRATIONS_PER_ELECTION,
  MAX_VALUE_LEN,
  cleanText,
  domainAllowed,
  emailKey,
} from "@/lib/registration";
import { ApiError, ballotAt, clientKey, inviteSecret, rateLimit, reasonFrom, requireOrganiser, resolveElection } from "@/lib/server/config";
import { linkKeyMatches } from "@/lib/server/regauth";
import { dataOf, electionKey, mutate, type StoredRegistration } from "@/lib/server/regstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVICE_COOKIE = "vt_dev";
const SAME_NETWORK_LIMIT = 5; // this many from one network within an hour gets everyone flagged
const HOUR = 3_600_000;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** A new warning on someone registered earlier: record it, and if they were only approved by the
 *  automatic rule (nobody has looked at them), send them back for a look. */
function flagEarlier(r: StoredRegistration, flag: string): void {
  if (!r.flags.includes(flag)) r.flags.push(flag);
  if (r.status === "approved" && !r.decided && !r.invited) r.status = "pending";
}

function hash(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}|${inviteSecret()}|${value}`).digest("hex").slice(0, 32);
}

/** A person registers from the QR code link. They give a name, an email and whatever extra
 *  questions the organiser added. Nothing here proves who they are - it records who asked, and
 *  marks anything suspicious for the organiser to look at. The invitation email that follows is
 *  what proves the person really owns the address. */
export async function POST(req: Request) {
  try {
    const ip = clientKey(req);
    rateLimit("reg:" + ip, 6, 60_000);
    rateLimit("reg-h:" + ip, 40, HOUR);
    const body = await req.json().catch(() => null);

    // Hidden field that only a script fills in. Pretend it worked, store nothing.
    if (typeof body?.website === "string" && body.website.trim() !== "") return NextResponse.json({ ok: true, status: "received" });

    const electionId = body?.electionId;
    const election = await resolveElection(electionId);
    requireOrganiser(election);
    const state = Number(await ballotAt(election.ballot).state());
    if (state !== 0) throw new ApiError("Registration is closed because voting has already started.", 409);

    const name = cleanText(body?.name, MAX_NAME_LEN);
    const email = cleanText(body?.email, 254).toLowerCase();
    if (name.length < 2) throw new ApiError("Please enter your name.");
    if (!isValidEmail(email)) throw new ApiError("Please enter a valid email address.");
    if (body?.consent !== true) throw new ApiError("Please tick the box to agree.");

    const key = electionKey(election.registry);
    const deviceCookie = readCookie(req, DEVICE_COOKIE);
    const device = deviceCookie && /^[a-f0-9]{32}$/.test(deviceCookie) ? deviceCookie : randomBytes(16).toString("hex");
    const deviceHash = hash("dev", device);
    const ipHash = hash("ip", ip);
    const ek = emailKey(email);

    const outcome = await mutate((d) => {
      const el = dataOf(d, key);
      if (!el.config.open) throw new ApiError("Registration is not open for this election.", 409);
      if (!linkKeyMatches(election.registry, el.config.linkVersion, body?.key)) {
        throw new ApiError("This registration link is not valid any more. Please scan the QR code again.", 403);
      }
      if (!domainAllowed(email, el.config.allowedDomains)) {
        throw new ApiError(`Registration is limited to these email domains: ${el.config.allowedDomains.join(", ")}.`, 403);
      }
      const extra: Record<string, string> = {};
      for (const f of el.config.fields) {
        const v = cleanText(body?.extra?.[f.key], MAX_VALUE_LEN);
        if (f.required && !v) throw new ApiError(`Please fill in: ${f.label}.`);
        if (v) extra[f.key] = v;
      }
      if (el.registrations.some((r) => r.emailKey === ek)) return { already: true as const };
      if (el.registrations.length >= MAX_REGISTRATIONS_PER_ELECTION) {
        throw new ApiError("Registration is full for this election.", 409);
      }

      const now = Date.now();
      const flags: string[] = [];
      const sameDevice = el.registrations.filter((r) => r.deviceHash === deviceHash);
      if (sameDevice.length > 0) {
        flags.push("same-device");
        for (const r of sameDevice) flagEarlier(r, "same-device");
      }
      const sameNet = el.registrations.filter((r) => r.ipHash === ipHash && now - r.createdAt < HOUR);
      if (sameNet.length + 1 >= SAME_NETWORK_LIMIT) {
        flags.push("same-network");
        for (const r of sameNet) flagEarlier(r, "same-network");
      }

      const rec: StoredRegistration = {
        id: randomUUID(),
        name,
        email,
        extra,
        createdAt: now,
        status: el.config.autoApprove && flags.length === 0 ? "approved" : "pending",
        flags,
        invited: false,
        emailKey: ek,
        deviceHash,
        ipHash,
      };
      el.registrations.push(rec);
      return { already: false as const };
    });

    // Same answer whether or not the email was already on the list, so the form cannot be used
    // to find out who has registered.
    void outcome;
    const res = NextResponse.json({ ok: true, status: "received" });
    if (!deviceCookie || device !== deviceCookie) {
      const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
      res.cookies.set(DEVICE_COOKIE, device, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 365 * 24 * 3600 });
    }
    return res;
  } catch (err) {
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status: err instanceof ApiError ? err.status : 400 });
  }
}

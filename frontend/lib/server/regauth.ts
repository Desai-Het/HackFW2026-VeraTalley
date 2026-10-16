import { createHmac, timingSafeEqual } from "crypto";
import { verifyMessage } from "ethers";
import { SESSION_MAX_AGE_MS, loginMessage } from "../registration";
import { ADMIN_MESSAGE_MAX_AGE_MS } from "../invite";
import { ApiError, expectedSite, inviteSecret, registryAt, requireOrganiser, type ResolvedElection } from "./config";
import { electionKey } from "./regstore";

/** Organiser sign-in for the registration screens. The organiser signs one free message with the
 *  election's admin wallet; the server answers with a token that is good for 30 minutes and for
 *  that one election only. The token is an HMAC, so the server stores nothing. */

function mac(registry: string, admin: string, exp: number): string {
  return createHmac("sha256", inviteSecret())
    .update(`veratally-reg-session-v1|${electionKey(registry)}|${admin.toLowerCase()}|${exp}`)
    .digest("hex");
}

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The secret in the QR code's address. Derived, not stored: raising the election's
 *  `linkVersion` changes it. Only people who scanned the code (or were sent the link) know it,
 *  so strangers cannot register just by guessing /register/1, /register/2... */
export function linkKey(registry: string, version: number): string {
  const digest = createHmac("sha256", inviteSecret())
    .update(`veratally-reg-link-v1|${electionKey(registry)}|${version}`)
    .digest();
  let out = "";
  for (let i = 0; i < 16; i++) out += KEY_ALPHABET[digest[i] & 31];
  return out;
}

export function linkKeyMatches(registry: string, version: number, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const want = Buffer.from(linkKey(registry, version));
  const got = Buffer.from(given.trim().toUpperCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function createSession(
  req: Request,
  body: any,
  electionId: number,
  election: ResolvedElection
): Promise<{ token: string; expiresAt: number }> {
  requireOrganiser(election);
  const issuedAt = Number(body?.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > ADMIN_MESSAGE_MAX_AGE_MS) {
    throw new ApiError("That request has expired. Please try again.", 401);
  }
  if (typeof body?.signature !== "string") throw new ApiError("Missing signature.", 401);
  let signer: string;
  try {
    signer = verifyMessage(loginMessage(electionId, issuedAt, expectedSite(req)), body.signature);
  } catch {
    throw new ApiError("The signature is not valid.", 401);
  }
  const admin: string = await registryAt(election.registry).admin();
  if (signer.toLowerCase() !== admin.toLowerCase()) throw new ApiError("Only this election's admin can do that.", 403);
  const exp = Date.now() + SESSION_MAX_AGE_MS;
  return { token: `${admin.toLowerCase()}.${exp}.${mac(election.registry, admin, exp)}`, expiresAt: exp };
}

export function requireSession(token: unknown, election: ResolvedElection): void {
  const parts = typeof token === "string" ? token.split(".") : [];
  const exp = Number(parts[1]);
  if (parts.length !== 3 || !Number.isFinite(exp) || exp < Date.now()) {
    throw new ApiError("Your sign-in expired. Please sign in again.", 401);
  }
  const expected = Buffer.from(mac(election.registry, parts[0], exp));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new ApiError("Your sign-in is not valid. Please sign in again.", 401);
  }
}

import { createHmac, timingSafeEqual } from "crypto";
import type { Role, SessionUser } from "../auth";
import { sessionStillValid } from "./accounts";
import { ApiError, clientKey, inviteSecret, rateLimit, relayerAddress, requireOrganiser, resolveElection, type ResolvedElection } from "./config";
import { ownerOfElection } from "./accounts";

/** Signed-in state lives in one cookie: who you are, your role, when it ends, and a version
 *  number. The cookie is signed (HMAC) so it cannot be edited, is HttpOnly so page scripts
 *  cannot read it, and SameSite=Lax so other websites cannot send it along with their own
 *  requests. The server stores no sessions: it re-checks the account on every request, so
 *  switching an account off or changing its password ends its sign-ins at once. */

export const SESSION_COOKIE = "vt_session";
export const SESSION_HOURS = 12;

function key(): Buffer {
  return createHmac("sha256", inviteSecret()).update("veratalley-login-session-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function secretForAccounts(): string {
  return inviteSecret();
}

export function makeToken(username: string, role: Role, sv: string): { token: string; maxAge: number } {
  const maxAge = SESSION_HOURS * 3600;
  const payload = Buffer.from(JSON.stringify({ u: username, r: role, e: Date.now() + maxAge * 1000, v: sv })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, maxAge };
}

function secureCookies(req: Request): boolean {
  const base = process.env.PUBLIC_BASE_URL || "";
  if (base.startsWith("https://")) return true;
  if (base.startsWith("http://")) return false;
  return (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim() === "https" || new URL(req.url).protocol === "https:";
}

export function cookieHeader(req: Request, token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies(req) ? "; Secure" : ""}`;
}
export function clearCookieHeader(req: Request): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies(req) ? "; Secure" : ""}`;
}

function readCookie(req: Request, name: string): string {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** The signed-in user for this request, or null. */
export async function getSession(req: Request): Promise<SessionUser | null> {
  const raw = readCookie(req, SESSION_COOKIE);
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(raw.slice(dot + 1));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let data: any;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data?.u !== "string" || (data.r !== "owner" && data.r !== "organiser") || typeof data.v !== "string") return null;
  if (!Number.isFinite(data.e) || data.e < Date.now()) return null;
  if (!(await sessionStillValid(data.u, data.r, data.v, inviteSecret()))) return null;
  return { username: data.u, role: data.r };
}

export async function requireLogin(req: Request): Promise<SessionUser> {
  const s = await getSession(req);
  if (!s) throw new ApiError("Please sign in.", 401);
  return s;
}

export async function requireOwner(req: Request): Promise<SessionUser> {
  const s = await requireLogin(req);
  if (s.role !== "owner") throw new ApiError("Only the site owner can do that.", 403);
  return s;
}

/** Sign-in attempts that failed, remembered for 15 minutes. Three counters, so a slow guesser
 *  on one account, a fast one from one address and a spread-out attack are each caught. */
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
function recent(k: string, now: number): number[] {
  const list = (failures.get(k) || []).filter((t) => now - t < WINDOW);
  if (list.length) failures.set(k, list);
  else failures.delete(k);
  return list;
}
export function checkLoginAllowed(req: Request, username: string): void {
  const now = Date.now();
  const ip = clientKey(req);
  if (recent(`ua:${username}|${ip}`, now).length >= 5 || recent(`ip:${ip}`, now).length >= 30 || recent(`u:${username}`, now).length >= 40) {
    throw new ApiError("Too many failed attempts. Please wait 15 minutes and try again.", 429);
  }
  rateLimit("login:" + ip, 20, 60_000);
}
export function recordLoginFailure(req: Request, username: string): void {
  const now = Date.now();
  const ip = clientKey(req);
  for (const k of [`ua:${username}|${ip}`, `ip:${ip}`, `u:${username}`]) failures.set(k, [...recent(k, now), now]);
  if (failures.size > 10_000) for (const k of failures.keys()) recent(k, now);
}
export function clearLoginFailures(req: Request, username: string): void {
  failures.delete(`ua:${username}|${clientKey(req)}`);
}

/** The signed-in user, the election they asked about, and proof that they may manage it.
 *  Elections must have been created by this server's own wallet: that wallet is the on-chain
 *  admin, so the site can only manage elections it created itself. */
export async function requireManager(req: Request, electionId: unknown): Promise<{ user: SessionUser; election: ResolvedElection; id: number }> {
  const user = await requireLogin(req);
  const election = await resolveElection(electionId);
  requireOrganiser(election);
  if (election.creator.toLowerCase() !== relayerAddress().toLowerCase()) {
    throw new ApiError("This election was not created on this website, so it cannot be managed here.", 403);
  }
  const id = electionId as number;
  if (user.role !== "owner") {
    const owner = await ownerOfElection(id);
    if (owner !== user.username) throw new ApiError("You do not manage this election.", 403);
  }
  return { user, election, id };
}

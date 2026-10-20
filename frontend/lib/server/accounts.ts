import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { normaliseUsername, passwordError, usernameError, type Role } from "../auth";
import { ApiError } from "./config";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Accounts and who runs which election.
 *
 *  - The OWNER is set in the server's environment (OWNER_USERNAME and OWNER_PASSWORD). It is the
 *    only account that can create other accounts, and it can manage every election. Because it
 *    lives in the settings, it still works if the data folder is ever lost.
 *  - ORGANISER accounts are created by the owner and stored in accounts.json next to the
 *    registrations file. Passwords are never stored, only a salted scrypt hash.
 *  - Each election remembers which account created it, and only that account (and the owner)
 *    can manage it. */

export type StoredUser = {
  username: string;
  hash: string;
  /** Raised when the password changes or the account is switched off, which ends old sign-ins. */
  sv: number;
  disabled: boolean;
  createdAt: number;
  createdBy: string;
  lastLogin?: number;
};
type Data = { version: 1; users: Record<string, StoredUser>; owners: Record<string, string> };

export const MAX_USERS = 200;
export const MAX_ELECTIONS_PER_USER = 100;

const FILE = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "accounts.json");

let cache: Data | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function load(): Promise<Data> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(FILE(), "utf8"));
    cache = parsed?.version === 1 && parsed.users && parsed.owners ? parsed : { version: 1, users: {}, owners: {} };
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.error(`[accounts] cannot read ${FILE()}: ${err?.code || ""} ${err?.message || err}`);
      throw new ApiError("The account data could not be read.", 503);
    }
    cache = { version: 1, users: {}, owners: {} };
  }
  return cache!;
}

async function save(d: Data): Promise<void> {
  const file = FILE();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(d), { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err: any) {
    console.error(`[accounts] cannot write ${file}: ${err?.code || ""} ${err?.message || err}`);
    cache = null;
    throw new ApiError("The account data could not be saved. Please try again.", 503);
  }
}

function mutate<T>(fn: (d: Data) => T): Promise<T> {
  const run = chain.then(async () => {
    const d = await load();
    const snapshot = JSON.stringify(d);
    try {
      const result = fn(d);
      await save(d);
      return result;
    } catch (err) {
      cache = JSON.parse(snapshot); // a refused change must not linger in memory
      throw err;
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

async function read<T>(fn: (d: Data) => T): Promise<T> {
  await chain;
  return fn(await load());
}

// ---- passwords ----

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `s1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [v, saltB64, hashB64] = stored.split("$");
  if (v !== "s1" || !saltB64 || !hashB64) return false;
  const want = Buffer.from(hashB64, "base64");
  const got = await scrypt(password, Buffer.from(saltB64, "base64"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

let dummyHash: Promise<string> | null = null;
/** Checked when the username does not exist, so a wrong username takes as long as a wrong password. */
function burnTime(password: string): Promise<boolean> {
  dummyHash ??= hashPassword("veratalley-timing-placeholder");
  return dummyHash.then((h) => checkPassword(password, h)).then(() => false);
}

// ---- the owner (from the environment) ----

export function ownerName(): string {
  return normaliseUsername(process.env.OWNER_USERNAME);
}
export function ownerConfigured(): boolean {
  const pw = process.env.OWNER_PASSWORD || "";
  return ownerName().length >= 3 && pw.length >= 12;
}

function same(a: string, b: string): boolean {
  const k = "veratalley-compare";
  const x = createHmac("sha256", k).update(a).digest();
  const y = createHmac("sha256", k).update(b).digest();
  return timingSafeEqual(x, y);
}

/** Changes whenever OWNER_PASSWORD changes, so changing it signs the owner out everywhere. */
export function ownerVersion(secret: string): string {
  return createHmac("sha256", secret).update("veratalley-owner-version|" + (process.env.OWNER_PASSWORD || "")).digest("hex").slice(0, 12);
}

// ---- sign in ----

export type LoginResult = { username: string; role: Role; sv: string } | null;

/** Checks a username and password. Returns null for any failure, whatever the reason, so the
 *  answer never reveals whether a username exists. */
export async function checkLogin(rawUsername: unknown, rawPassword: unknown, secret: string): Promise<LoginResult> {
  const username = normaliseUsername(rawUsername);
  const password = typeof rawPassword === "string" && rawPassword.length <= 256 ? rawPassword : "";
  if (!username || !password) return null;

  if (ownerConfigured() && username === ownerName()) {
    const ok = same(password, process.env.OWNER_PASSWORD || "");
    return ok ? { username, role: "owner", sv: ownerVersion(secret) } : null;
  }
  const user = await read((d) => d.users[username]);
  if (!user) return burnTime(password).then(() => null);
  const ok = await checkPassword(password, user.hash);
  if (!ok || user.disabled) return null;
  await mutate((d) => {
    if (d.users[username]) d.users[username].lastLogin = Date.now();
  }).catch(() => undefined); // bookkeeping only
  return { username, role: "organiser", sv: String(user.sv) };
}

/** Is this signed-in session still valid? (The account may have been switched off since.) */
export async function sessionStillValid(username: string, role: Role, sv: string, secret: string): Promise<boolean> {
  if (role === "owner") return ownerConfigured() && username === ownerName() && sv === ownerVersion(secret);
  const user = await read((d) => d.users[username]);
  return Boolean(user && !user.disabled && String(user.sv) === sv);
}

export async function hasAnyAccount(): Promise<boolean> {
  return ownerConfigured() || (await read((d) => Object.keys(d.users).length > 0));
}

// ---- managing accounts (owner only; the routes check that) ----

export type PublicUser = { username: string; disabled: boolean; createdAt: number; lastLogin?: number; elections: number };

export async function listUsers(): Promise<PublicUser[]> {
  return read((d) => {
    const counts: Record<string, number> = {};
    for (const u of Object.values(d.owners)) counts[u] = (counts[u] || 0) + 1;
    return Object.values(d.users)
      .map((u) => ({ username: u.username, disabled: u.disabled, createdAt: u.createdAt, lastLogin: u.lastLogin, elections: counts[u.username] || 0 }))
      .sort((a, b) => a.username.localeCompare(b.username));
  });
}

export async function createUser(rawUsername: unknown, password: unknown, by: string): Promise<void> {
  const username = normaliseUsername(rawUsername);
  const bad = usernameError(username) || passwordError(password, username);
  if (bad) throw new ApiError(bad);
  if (username === ownerName()) throw new ApiError("That username is reserved.");
  const hash = await hashPassword(password as string);
  await mutate((d) => {
    if (d.users[username]) throw new ApiError("That username is already taken.", 409);
    if (Object.keys(d.users).length >= MAX_USERS) throw new ApiError(`At most ${MAX_USERS} accounts are allowed.`);
    d.users[username] = { username, hash, sv: 1, disabled: false, createdAt: Date.now(), createdBy: by };
  });
}

/** Sets a new password and ends every existing sign-in for that account. */
export async function setPassword(rawUsername: unknown, password: unknown): Promise<number> {
  const username = normaliseUsername(rawUsername);
  const bad = passwordError(password, username);
  if (bad) throw new ApiError(bad);
  const hash = await hashPassword(password as string);
  return mutate((d) => {
    const u = d.users[username];
    if (!u) throw new ApiError("No such account.", 404);
    u.hash = hash;
    u.sv += 1;
    return u.sv;
  });
}

/** For the account holder changing their own password. */
export async function verifyOwnPassword(username: string, password: unknown): Promise<boolean> {
  if (typeof password !== "string") return false;
  const user = await read((d) => d.users[username]);
  if (!user) return burnTime(password);
  return checkPassword(password, user.hash);
}

export async function setDisabled(rawUsername: unknown, disabled: boolean): Promise<void> {
  const username = normaliseUsername(rawUsername);
  await mutate((d) => {
    const u = d.users[username];
    if (!u) throw new ApiError("No such account.", 404);
    u.disabled = disabled;
    u.sv += 1; // ends current sign-ins straight away
  });
}

export async function deleteUser(rawUsername: unknown): Promise<void> {
  const username = normaliseUsername(rawUsername);
  await mutate((d) => {
    if (!d.users[username]) throw new ApiError("No such account.", 404);
    delete d.users[username];
  });
}

// ---- who runs which election ----

export async function recordElectionOwner(electionId: number, username: string): Promise<void> {
  await mutate((d) => {
    d.owners[String(electionId)] = username;
  });
}

export async function electionCountOf(username: string): Promise<number> {
  return read((d) => Object.values(d.owners).filter((u) => u === username).length);
}

export async function ownerOfElection(electionId: number): Promise<string | null> {
  return read((d) => d.owners[String(electionId)] ?? null);
}

/** Election numbers this account may manage. The site owner sees all of them. */
export async function electionsOf(username: string, role: Role): Promise<number[]> {
  return read((d) =>
    Object.entries(d.owners)
      .filter(([, u]) => role === "owner" || u === username)
      .map(([id]) => Number(id))
      .sort((a, b) => b - a)
  );
}

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { ApiError, CHAIN_ID } from "./config";
import { DEFAULT_CONFIG, MAX_REGISTRATIONS_PER_ELECTION, emailKey, type RegConfig, type RegRecord } from "../registration";

/** Where registrations live: one JSON file on the server's disk.
 *
 *  This is deliberately simple. It needs a server whose disk survives restarts (a VPS, or a host
 *  that offers a persistent volume - set DATA_DIR to that volume's path). It does NOT work on
 *  serverless hosting such as Vercel, where each request may run on a different machine and the
 *  disk is wiped between runs. */

export type StoredRegistration = RegRecord & {
  emailKey: string;
  deviceHash: string;
  ipHash: string;
  /** The organiser has made a decision on this person, so automatic rules leave them alone. */
  decided?: boolean;
};

type ElectionData = { config: RegConfig; registrations: StoredRegistration[] };
type Data = { version: 1; elections: Record<string, ElectionData> };

const FILE = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "registrations.json");

let cache: Data | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function load(): Promise<Data> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(FILE(), "utf8"));
    cache = parsed?.version === 1 && parsed.elections ? parsed : { version: 1, elections: {} };
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw new ApiError("The registration data could not be read.", 503);
    cache = { version: 1, elections: {} };
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
  } catch {
    cache = null; // re-read next time so memory never drifts from the disk
    throw new ApiError("The registration could not be saved. Please try again.", 503);
  }
}

/** Runs `fn` on the data with nobody else touching it, then writes the result to disk. */
export function mutate<T>(fn: (d: Data) => T): Promise<T> {
  const run = chain.then(async () => {
    const d = await load();
    const result = fn(d);
    await save(d);
    return result;
  });
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function read<T>(fn: (d: Data) => T): Promise<T> {
  const run = chain.then(async () => fn(await load()));
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** One key per election: the chain and the registry contract, so a redeployed contract starts
 *  with a clean slate instead of inheriting someone else's list. */
export function electionKey(registry: string): string {
  return `${CHAIN_ID}:${registry.toLowerCase()}`;
}

export function dataOf(d: Data, key: string): ElectionData {
  if (!d.elections[key]) d.elections[key] = { config: { ...DEFAULT_CONFIG }, registrations: [] };
  const el = d.elections[key];
  if (typeof el.config.linkVersion !== "number") el.config.linkVersion = 1; // older saved data
  return el;
}

export function publicRecord(r: StoredRegistration): RegRecord {
  const { id, name, email, extra, createdAt, status, flags, invited } = r;
  return { id, name, email, extra, createdAt, status, flags, invited };
}

/** After invitations go out, remember which people have one. Emails the organiser typed in by
 *  hand (nobody registered them) are added to the list too, already approved and invited. */
export async function markInvited(registry: string, emails: string[]): Promise<void> {
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()));
  if (wanted.size === 0) return;
  const key = electionKey(registry);
  await mutate((d) => {
    const el = dataOf(d, key);
    for (const r of el.registrations) if (wanted.has(r.email)) r.invited = true;
    for (const email of wanted) {
      const ek = emailKey(email);
      if (el.registrations.some((r) => r.emailKey === ek)) continue;
      if (el.registrations.length >= MAX_REGISTRATIONS_PER_ELECTION) break;
      el.registrations.push({
        id: randomUUID(),
        name: "",
        email,
        extra: {},
        createdAt: Date.now(),
        status: "approved",
        flags: [],
        invited: true,
        emailKey: ek,
        deviceHash: "",
        ipHash: "",
        decided: true,
      });
    }
  });
}

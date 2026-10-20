import { Contract, JsonRpcProvider, Network, NonceManager, Wallet, getAddress, isAddress, parseUnits } from "ethers";
import factoryAbi from "../abi/ElectionFactory.abi.json";
import registryAbi from "../abi/VoterRegistry.abi.json";
import ballotAbi from "../abi/ElectionBallot.abi.json";
import { parseOrganisers } from "../organisers";

/** Server-side settings. Everything secret lives in environment variables and is only ever read
 *  here, in code that runs on the server. None of these names start with NEXT_PUBLIC_, so Next.js
 *  never ships them to the browser. */

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 80002);
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || (CHAIN_ID === 31337 ? "http://127.0.0.1:8545" : "");
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS || "";

let provider: JsonRpcProvider | null = null;
export function serverProvider(): JsonRpcProvider {
  if (!RPC_URL) throw new ApiError("The server has no RPC URL configured (NEXT_PUBLIC_RPC_URL).", 500);
  if (!provider) provider = new JsonRpcProvider(RPC_URL, Network.from(CHAIN_ID), { staticNetwork: true });
  return provider;
}

let relayer: NonceManager | null = null;
let relayerAddr = "";
/** The signer that pays gas for voters. Use a dedicated throwaway wallet with a small balance.
 *  Wrapped in a NonceManager because the provider caches its transaction count for a moment:
 *  without it, a vote sent right after a confirmed claim reuses the old nonce and fails. */
export function relayerWallet(): NonceManager {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) throw new ApiError("Gasless voting is not set up on this server.", 503);
  if (!relayer) {
    const wallet = new Wallet(key, serverProvider());
    relayerAddr = wallet.address;
    relayer = new NonceManager(wallet);
  }
  return relayer;
}

export function relayerAddress(): string {
  relayerWallet();
  return relayerAddr;
}

export function inviteSecret(): string {
  const secret = process.env.INVITE_SECRET;
  if (!secret || secret.length < 16) throw new ApiError("Invites are not set up on this server.", 503);
  return secret;
}

export function inviteDelivery(): "email" | "links" {
  return process.env.INVITE_DELIVERY === "links" ? "links" : "email";
}

export type ResolvedElection = { creator: string; registry: string; ballot: string };

/** Looks the election up in the factory, so the relayer can only ever be pointed at contracts
 *  that VeraTally itself created - never at an arbitrary address a caller supplies. */
export async function resolveElection(electionId: unknown): Promise<ResolvedElection> {
  if (typeof electionId !== "number" || !Number.isInteger(electionId) || electionId < 0) {
    throw new ApiError("Unknown election.");
  }
  if (!isAddress(FACTORY_ADDRESS)) throw new ApiError("This server is not connected to a factory.", 503);
  const factory = new Contract(FACTORY_ADDRESS, factoryAbi, serverProvider());
  try {
    const [creator, registry, ballot] = await factory.getElection(electionId);
    return { creator: getAddress(creator), registry: getAddress(registry), ballot: getAddress(ballot) };
  } catch {
    throw new ApiError("Unknown election.");
  }
}

/** Read at request time (a computed key stops the bundler freezing it at build time), so the
 *  list can be changed with a restart instead of a rebuild. */
function organiserList(): string[] {
  const name = ["NEXT_PUBLIC", "ORGANISER_WALLETS"].join("_");
  return parseOrganisers(process.env[name]);
}

/** Only elections created by an organiser wallet may use this server's relayer, invitation
 *  emails and registration forms. Without this, anyone could create an election on the public
 *  factory and then spend this server's gas money and send email from its address. */
export function requireOrganiser(election: ResolvedElection): void {
  const list = organiserList();
  if (list.length === 0 && CHAIN_ID === 31337) return; // local test chain: no allowlist needed
  // Elections made by this server's own wallet (the ones organisers create after signing in) are
  // always served. The list adds wallets whose older elections should keep working too.
  let own = "";
  try {
    own = relayerAddress().toLowerCase();
  } catch {
    // no server wallet configured
  }
  const allowed = own ? [...list, own] : list;
  if (allowed.length === 0) {
    throw new ApiError("This server has no organiser wallet set up (RELAYER_PRIVATE_KEY).", 503);
  }
  if (!allowed.includes(election.creator.toLowerCase())) {
    throw new ApiError("This website does not serve that election.", 403);
  }
}

/** The website address a signed request must have been made for (host and port). A signature
 *  made on some other website is refused, so a look-alike site cannot trick an organiser into
 *  signing something that works here. */
export function expectedSite(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    try {
      return new URL(configured).host.toLowerCase();
    } catch {
      // fall through to the request's own host
    }
  }
  const fwd = req.headers.get("x-forwarded-host");
  return (fwd ? fwd.split(",")[0].trim() : req.headers.get("host") || new URL(req.url).host).toLowerCase();
}

export function factoryAt(runner: NonceManager | JsonRpcProvider = serverProvider()): Contract {
  if (!isAddress(FACTORY_ADDRESS)) throw new ApiError("This server is not connected to a factory.", 503);
  return new Contract(FACTORY_ADDRESS, factoryAbi, runner);
}
export function registryAt(address: string, runner: NonceManager | JsonRpcProvider = serverProvider()): Contract {
  return new Contract(address, registryAbi, runner);
}
export function ballotAt(address: string, runner: NonceManager | JsonRpcProvider = serverProvider()): Contract {
  return new Contract(address, ballotAbi, runner);
}

/** Amoy rejects transactions that tip less than about 25 gwei, and public RPCs sometimes
 *  suggest less. Floor the tip so relayed transactions are not stuck. */
export async function feeOverrides() {
  const fees = await serverProvider().getFeeData();
  if (CHAIN_ID !== 80002) return {};
  const floor = parseUnits("30", "gwei");
  const tip = fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > floor ? fees.maxPriorityFeePerGas : floor;
  const base = fees.maxFeePerGas ?? floor * 2n;
  return { maxPriorityFeePerGas: tip, maxFeePerGas: base > tip * 2n ? base : tip * 2n };
}

// One transaction at a time from the relayer wallet, so simultaneous voters cannot collide on
// the same nonce. Fine for one server instance; a multi-instance deployment would need a real
// queue.
let tail: Promise<unknown> = Promise.resolve();
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.catch(() => undefined);
  return run;
}

// Small in-memory rate limit. Best effort: it resets on restart and is per server instance,
// which is enough to stop a casual script from draining the relayer or flooding the forms.
const hits = new Map<string, number[]>();
let lastSweep = 0;
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new ApiError("Too many requests. Please wait a moment and try again.", 429);
  recent.push(now);
  hits.set(key, recent);
  // Housekeeping: drop idle keys. Never wipe the whole table: that would let an attacker reset
  // everyone's limits just by sending lots of different keys.
  if (hits.size > 5000 && now - lastSweep > 10_000) {
    lastSweep = now;
    for (const [k, times] of hits) if (now - times[times.length - 1] > 3_600_000) hits.delete(k);
  }
}

/** The caller's address as seen by OUR proxy. X-Forwarded-For is a list, and anything left of
 *  the entry our own proxy added can be forged by the caller, so we count from the right:
 *  TRUSTED_PROXY_HOPS (default 1) is how many proxies sit in front of this server. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (!fwd) return "local";
  const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  return parts[Math.max(0, parts.length - hops)] || "local";
}

/** Plain-language message for an error, in the same wording the contracts use. */
export function reasonFrom(err: any): string {
  if (err instanceof ApiError) return err.message;
  const raw: string[] = [err?.reason, err?.shortMessage, err?.info?.error?.message, err?.message].filter(
    (m): m is string => typeof m === "string"
  );
  for (const m of raw) {
    const match = m.match(/VeraTally: ([^"]+?)(?:"|$)/);
    if (match) {
      const reason = match[1].trim();
      return reason.charAt(0).toUpperCase() + reason.slice(1) + ".";
    }
  }
  return "Something went wrong. Please try again.";
}

import { getAddress, isAddress, ZeroAddress, type Contract, type ContractTransactionReceipt } from "ethers";
import { getElectionBallotAt, getElectionFactory, getReadProvider } from "./contracts";

// Limits for what the create/manage forms will send. The contracts themselves enforce only the
// rules that matter for correctness (at least two candidates, no zero addresses); these keep a
// single transaction a sensible size so it can't fail for gas or flood the page with long text.
export const MAX_CANDIDATES = 20;
export const MAX_TITLE_LENGTH = 120;
export const MAX_CANDIDATE_LENGTH = 80;
export const MAX_VOTERS_PER_TRANSACTION = 200;

export type ParsedAddresses = {
  /** Checksummed, de-duplicated addresses ready to send to registerVoters. */
  valid: string[];
  /** Entries that are not usable wallet addresses, exactly as typed. */
  invalid: string[];
  /** How many entries were repeats of an address already in the list. */
  duplicates: number;
};

/** Turns whatever an admin pastes (one address per line, or separated by commas, spaces or
 *  semicolons) into a clean list. Addresses with a wrong mixed-case checksum are treated as
 *  invalid on purpose: that is how a typo gets caught before it costs gas. */
export function parseAddressList(raw: string): ParsedAddresses {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const token of tokens) {
    if (!isAddress(token) || token.toLowerCase() === ZeroAddress) {
      invalid.push(token);
      continue;
    }
    const checksummed = getAddress(token);
    const key = checksummed.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    valid.push(checksummed);
  }
  return { valid, invalid, duplicates };
}

export function validateTitle(raw: string): { value: string; error: string | null } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { value, error: "Give your election a title." };
  if (value.length > MAX_TITLE_LENGTH) {
    return { value, error: `Keep the title under ${MAX_TITLE_LENGTH} characters.` };
  }
  return { value, error: null };
}

/** Blank rows are ignored, so people can leave spare rows in the form. */
export function validateCandidates(raw: string[]): { cleaned: string[]; error: string | null } {
  const cleaned = raw.map((name) => name.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (cleaned.length < 2) return { cleaned, error: "Add at least two candidates." };
  if (cleaned.length > MAX_CANDIDATES) {
    return { cleaned, error: `An election can have at most ${MAX_CANDIDATES} candidates.` };
  }
  if (cleaned.some((name) => name.length > MAX_CANDIDATE_LENGTH)) {
    return { cleaned, error: `Keep each candidate name under ${MAX_CANDIDATE_LENGTH} characters.` };
  }
  if (new Set(cleaned.map((name) => name.toLowerCase())).size !== cleaned.length) {
    return { cleaned, error: "Each candidate needs a different name." };
  }
  return { cleaned, error: null };
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

/** Reads the new election's id out of the receipt of a createElection transaction. */
export function parseCreatedElectionId(
  factory: Contract,
  receipt: ContractTransactionReceipt
): number | null {
  for (const log of receipt.logs) {
    try {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === "ElectionCreated") return Number(parsed.args.electionId);
    } catch {
      // Not one of the factory's events - keep looking.
    }
  }
  return null;
}

/** True when the factory rejected an id that doesn't exist (as opposed to a network failure). */
export function isUnknownElectionError(err: any): boolean {
  const messages = [err?.reason, err?.shortMessage, err?.info?.error?.message, err?.error?.message, err?.message];
  return messages.some((m) => typeof m === "string" && /unknown election/i.test(m));
}

export type ElectionSummary = {
  id: number;
  creator: string;
  registry: string;
  ballot: string;
  title: string;
  state: number;
  candidateCount: number;
};

/** One row of the elections list: factory record plus the few ballot fields worth showing. */
export async function fetchElectionSummary(id: number): Promise<ElectionSummary> {
  const provider = getReadProvider();
  const factory = getElectionFactory(provider);
  const [creator, registry, ballotAddress] = await factory.getElection(id);
  const ballot = getElectionBallotAt(ballotAddress, provider);
  const [title, state, candidateCount] = await Promise.all([
    ballot.title(),
    ballot.state(),
    ballot.candidateCount(),
  ]);
  return {
    id,
    creator,
    registry,
    ballot: ballotAddress,
    title,
    state: Number(state),
    candidateCount: Number(candidateCount),
  };
}

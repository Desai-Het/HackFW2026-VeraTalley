import type { Contract, EventLog, Log, Provider } from "ethers";
import { getElectionBallotAt, getReadProvider, getVoterRegistryAt } from "./contracts";

export type VerificationResult = {
  atBlock: number;
  candidates: string[];
  /** Counts taken from the contract's own tally. */
  reportedTally: bigint[];
  /** Counts rebuilt by reading every VoteCast event. */
  recountedTally: number[];
  totalVotesCast: number;
  registeredVoters: number;
  /** One entry per problem found. Empty means every check passed. */
  problems: string[];
  tallyMatches: boolean;
};

/** First block at which the address has code, found by binary search. Needs a node that can
 *  answer eth_getCode for old blocks (nearly all do for recent history). Lets us start reading
 *  events at the deployment instead of at block 0, which public RPCs reject or time out on. */
export async function findDeploymentBlock(provider: Provider, address: string, latest: number): Promise<number> {
  let lo = 0;
  let hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await provider.getCode(address, mid);
    if (code && code !== "0x") hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Reads every log for one event, in block ranges small enough for public RPC limits. If the node
 *  rejects a range as too large it halves the range and tries again. */
async function queryAll(contract: Contract, eventName: string, from: number, to: number): Promise<EventLog[]> {
  const out: EventLog[] = [];
  let step = 5000;
  let start = from;
  while (start <= to) {
    const end = Math.min(start + step - 1, to);
    try {
      const logs: Array<EventLog | Log> = await contract.queryFilter(eventName, start, end);
      for (const l of logs) if ("args" in l) out.push(l as EventLog);
      start = end + 1;
    } catch (err) {
      if (step <= 50) throw err;
      step = Math.floor(step / 2);
    }
  }
  return out;
}

/** Rebuilds the result of an election from the chain's event history alone and compares it with
 *  what the contract reports. Anyone can run this with no wallet and no trust in the app. */
export async function verifyElection(registryAddress: string, ballotAddress: string): Promise<VerificationResult> {
  const provider = getReadProvider();
  const ballot = getElectionBallotAt(ballotAddress, provider);
  const registry = getVoterRegistryAt(registryAddress, provider);

  // Pin everything to one block so a vote arriving mid-check can't cause a false mismatch.
  const atBlock = await provider.getBlockNumber();
  const [candidates, reportedTally] = await Promise.all([
    ballot.getCandidates({ blockTag: atBlock }) as Promise<string[]>,
    ballot.getTally({ blockTag: atBlock }) as Promise<bigint[]>,
  ]);

  const [ballotFrom, registryFrom] = await Promise.all([
    findDeploymentBlock(provider, ballotAddress, atBlock),
    findDeploymentBlock(provider, registryAddress, atBlock),
  ]);
  const [voteLogs, registeredLogs] = await Promise.all([
    queryAll(ballot, "VoteCast", ballotFrom, atBlock),
    queryAll(registry, "VoterRegistered", registryFrom, atBlock),
  ]);

  const registered = new Set(registeredLogs.map((l) => String(l.args.voter).toLowerCase()));
  const seen = new Set<string>();
  const recounted: number[] = candidates.map(() => 0);
  const problems: string[] = [];

  for (const log of voteLogs) {
    const voter = String(log.args.voter).toLowerCase();
    const id = Number(log.args.candidateId);
    if (id >= candidates.length) {
      problems.push(`A vote in block ${log.blockNumber} names a candidate that does not exist.`);
      continue;
    }
    if (seen.has(voter)) problems.push(`Wallet ${log.args.voter} appears to have voted more than once.`);
    seen.add(voter);
    if (!registered.has(voter)) problems.push(`Wallet ${log.args.voter} voted but was never on the voter list.`);
    recounted[id] += 1;
  }

  const tallyMatches = candidates.every((_, i) => BigInt(recounted[i]) === reportedTally[i]);
  if (!tallyMatches) problems.push("The recounted votes do not match the tally the contract reports.");

  return {
    atBlock,
    candidates,
    reportedTally,
    recountedTally: recounted,
    totalVotesCast: voteLogs.length,
    registeredVoters: registered.size,
    problems,
    tallyMatches,
  };
}

/** Winner(s) of a tally: one index, several on a tie, none if nobody has votes. */
export function leaders(tally: bigint[]): number[] {
  const max = tally.reduce((m, v) => (v > m ? v : m), 0n);
  if (max === 0n) return [];
  return tally.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0);
}

import { getAddress } from "ethers";
import { getElectionBallotAt, getElectionFactory, getReadProvider } from "./contracts";
import ballotAbi from "./abi/ElectionBallot.abi.json";
import { Interface } from "ethers";

/** "Where did my vote go?" - read one transaction from the chain and say, in plain terms, which
 *  election it was a vote in and for which candidate. Nothing here trusts this website: the
 *  answer comes from the transaction's own log, and the log only counts if it was emitted by a
 *  ballot contract that the factory created. */

export type CheckedVote = {
  txHash: string;
  blockNumber: number;
  confirmations: number;
  /** Unix milliseconds of the block, or null if the node didn't return it. */
  time: number | null;
  /** Who paid for the transaction. Different from `voter` when the vote was sent for the voter. */
  submittedBy: string;
  relayed: boolean;
  electionId: number;
  title: string;
  ballot: string;
  registry: string;
  state: number;
  voter: string;
  candidateId: number;
  candidateName: string;
  candidates: string[];
  tally: number[];
  /** The ballot contract itself says this voter has voted (an independent read, not the log). */
  contractAgrees: boolean;
};

export type TxCheck =
  | { kind: "invalid" }
  | { kind: "notfound" }
  | { kind: "failed" }
  | { kind: "novote" }
  | { kind: "ok"; votes: CheckedVote[] };

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Pulls a transaction id out of whatever was pasted: a bare hash, or a block explorer link. */
export function extractTxHash(raw: string): string | null {
  const m = raw.match(/0x[0-9a-fA-F]{64}/);
  return m ? m[0].toLowerCase() : null;
}

export function isTxHash(raw: string): boolean {
  return TX_HASH.test(raw.trim());
}

const iface = new Interface(ballotAbi);
const VOTE_CAST_TOPIC = iface.getEvent("VoteCast")!.topicHash;

type Known = { id: number; registry: string; ballot: string };
let known: Known[] = [];
let scanned = 0; // how many of the factory's elections are in `known`

/** Finds the factory election whose ballot lives at `address`, reading the factory's list (and
 *  only the part of it not already read). Returns null when the address isn't one of its ballots. */
async function electionAt(address: string): Promise<Known | null> {
  const want = address.toLowerCase();
  const hit = () => known.find((k) => k.ballot.toLowerCase() === want) ?? null;
  const first = hit();
  if (first) return first;

  const factory = getElectionFactory(getReadProvider());
  const count = Number(await factory.electionCount());
  while (scanned < count) {
    const ids = Array.from({ length: Math.min(25, count - scanned) }, (_, i) => scanned + i);
    const rows = await Promise.all(ids.map((id) => factory.getElection(id)));
    rows.forEach((r, i) => known.push({ id: ids[i], registry: r[1], ballot: r[2] }));
    scanned += ids.length;
    const found = hit();
    if (found) return found;
  }
  return null;
}

/** Forget what was read, e.g. after the local chain was reset. */
export function resetTxCheckCache() {
  known = [];
  scanned = 0;
}

export async function checkVoteTx(input: string): Promise<TxCheck> {
  const hash = extractTxHash(input);
  if (!hash) return { kind: "invalid" };

  const provider = getReadProvider();
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) return { kind: "notfound" };
  if (receipt.status !== 1) return { kind: "failed" };

  const voteLogs = receipt.logs.filter((l) => l.topics[0] === VOTE_CAST_TOPIC);
  const votes: CheckedVote[] = [];

  const [latest, block, tx] = await Promise.all([
    provider.getBlockNumber(),
    provider.getBlock(receipt.blockNumber),
    provider.getTransaction(hash),
  ]);

  for (const log of voteLogs) {
    const election = await electionAt(log.address);
    if (!election) continue; // a look-alike event from some other contract: ignore it

    const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) continue;
    const voter = getAddress(parsed.args.voter);
    const candidateId = Number(parsed.args.candidateId);

    const ballot = getElectionBallotAt(log.address, provider);
    const [title, state, names, counts, hasVoted] = await Promise.all([
      ballot.title(),
      ballot.state(),
      ballot.getCandidates(),
      ballot.getTally(),
      ballot.hasVoted(voter),
    ]);
    const candidates = (names as string[]).map(String);
    const submittedBy = tx ? getAddress(tx.from) : getAddress(receipt.from);

    votes.push({
      txHash: hash,
      blockNumber: receipt.blockNumber,
      confirmations: Math.max(latest - receipt.blockNumber + 1, 1),
      time: block ? block.timestamp * 1000 : null,
      submittedBy,
      relayed: submittedBy.toLowerCase() !== voter.toLowerCase(),
      electionId: election.id,
      title,
      ballot: getAddress(log.address),
      registry: getAddress(election.registry),
      state: Number(state),
      voter,
      candidateId,
      candidateName: candidates[candidateId] ?? `Candidate ${candidateId}`,
      candidates,
      tally: (counts as bigint[]).map((n) => Number(n)),
      contractAgrees: Boolean(hasVoted) && Number((counts as bigint[])[candidateId] ?? 0n) >= 1,
    });
  }

  if (votes.length === 0) return { kind: "novote" };
  return { kind: "ok", votes };
}

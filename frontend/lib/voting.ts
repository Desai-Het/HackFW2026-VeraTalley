import { Wallet } from "ethers";
import { getElectionBallotAt, getReadProvider, getVoterRegistryAt } from "./contracts";
import { findDeploymentBlock } from "./verify";

/** Where a person's invite stands, read straight from the chain. */
export type InviteInfo = {
  status: 0 | 1 | 2; // unknown, unused, claimed
  voter: string | null; // the address that claimed it
};

export async function readInvite(registryAddress: string, inviteAddress: string): Promise<InviteInfo> {
  const registry = getVoterRegistryAt(registryAddress, getReadProvider());
  const status = Number(await registry.inviteStatus(inviteAddress)) as 0 | 1 | 2;
  if (status !== 2) return { status, voter: null };
  return { status, voter: await registry.inviteClaimedBy(inviteAddress) };
}

export type FoundVote = { candidateId: number; txHash: string };

/** Finds one voter's VoteCast event. Reads from the ballot's deployment onward in small block
 *  ranges so public RPC limits are respected. */
export async function findVoteOf(ballotAddress: string, voter: string): Promise<FoundVote | null> {
  const provider = getReadProvider();
  const ballot = getElectionBallotAt(ballotAddress, provider);
  const latest = await provider.getBlockNumber();
  const from = await findDeploymentBlock(provider, ballotAddress, latest);
  const filter = ballot.filters.VoteCast(voter);
  let step = 5000;
  let start = from;
  while (start <= latest) {
    const end = Math.min(start + step - 1, latest);
    try {
      const logs = await ballot.queryFilter(filter, start, end);
      for (const l of logs) {
        if ("args" in l) return { candidateId: Number(l.args.candidateId), txHash: l.transactionHash };
      }
      start = end + 1;
    } catch (err) {
      if (step <= 50) throw err;
      step = Math.floor(step / 2);
    }
  }
  return null;
}

// The voter's own key lives only in this browser, between claiming the invite and voting. It is
// never sent anywhere. If it is lost after claiming but before voting, that invite cannot vote.
function keyName(registryAddress: string, inviteAddress: string) {
  return `veratally:voterkey:${registryAddress.toLowerCase()}:${inviteAddress.toLowerCase()}`;
}

export function loadVoterWallet(registryAddress: string, inviteAddress: string): Wallet | null {
  try {
    const key = window.localStorage.getItem(keyName(registryAddress, inviteAddress));
    return key ? new Wallet(key) : null;
  } catch {
    return null;
  }
}

export function saveVoterWallet(registryAddress: string, inviteAddress: string, wallet: Wallet): boolean {
  try {
    window.localStorage.setItem(keyName(registryAddress, inviteAddress), wallet.privateKey);
    return true;
  } catch {
    return false;
  }
}

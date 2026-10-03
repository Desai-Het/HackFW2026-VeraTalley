import { BrowserProvider, Contract, JsonRpcProvider, type Provider, type Signer } from "ethers";
import voterRegistryAbi from "./abi/VoterRegistry.abi.json";
import electionBallotAbi from "./abi/ElectionBallot.abi.json";

export const VOTER_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS || "";
export const ELECTION_BALLOT_ADDRESS = process.env.NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS || "";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc-amoy.polygon.technology/";

export const BALLOT_STATE_LABELS = ["Draft", "Open", "Closed"] as const;

/** A read-only provider for public views (tally, candidates, state) - works with no wallet
 *  connected at all, which is what lets an observer check results without installing MetaMask. */
export function getReadProvider(): Provider {
  return new JsonRpcProvider(RPC_URL);
}

export function getBrowserProvider(ethereum: any): BrowserProvider {
  return new BrowserProvider(ethereum);
}

export function getVoterRegistry(runner: Provider | Signer): Contract {
  return new Contract(VOTER_REGISTRY_ADDRESS, voterRegistryAbi, runner);
}

export function getElectionBallot(runner: Provider | Signer): Contract {
  return new Contract(ELECTION_BALLOT_ADDRESS, electionBallotAbi, runner);
}

export function contractsConfigured(): boolean {
  return Boolean(VOTER_REGISTRY_ADDRESS && ELECTION_BALLOT_ADDRESS);
}

/** Turns a raw ethers/revert error into the plain-language message the contract already
 *  provides (NFR-04). Falls back to something generic rather than showing raw JSON-RPC text. */
export function describeError(err: any): string {
  const raw: string | undefined =
    err?.reason || err?.shortMessage || err?.info?.error?.message || err?.error?.message || err?.message;
  if (!raw) return "Something went wrong. Please try again.";

  const match = raw.match(/VeraTally: ([^"]+?)(?:"|$)/);
  if (match) {
    const reason = match[1].trim();
    return reason.charAt(0).toUpperCase() + reason.slice(1) + ".";
  }
  if (raw.toLowerCase().includes("user rejected")) {
    return "You cancelled the request in your wallet.";
  }
  return "Something went wrong. Please try again.";
}

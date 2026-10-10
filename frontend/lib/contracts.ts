import { BrowserProvider, Contract, JsonRpcProvider, Network, type Provider, type Signer } from "ethers";
import voterRegistryAbi from "./abi/VoterRegistry.abi.json";
import electionBallotAbi from "./abi/ElectionBallot.abi.json";
import electionFactoryAbi from "./abi/ElectionFactory.abi.json";

export const VOTER_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS || "";
export const ELECTION_BALLOT_ADDRESS = process.env.NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS || "";
// The factory that creates elections (Increment C). The create/list/manage pages read every
// election's registry and ballot addresses from it, so this is the only address they need.
export const ELECTION_FACTORY_ADDRESS = process.env.NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS || "";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc-amoy.polygon.technology/";
const READ_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 80002);

export const BALLOT_STATE_LABELS = ["Draft", "Open", "Closed"] as const;

let readProvider: JsonRpcProvider | null = null;

/** A read-only provider for public views (tally, candidates, state) - works with no wallet
 *  connected at all, which is what lets an observer check results without installing MetaMask.
 *
 *  One shared instance with a fixed network. Creating a new JsonRpcProvider per call (as the
 *  first version did, on every 5s poll) costs an extra chain-id request each time, and if the RPC
 *  is unreachable each instance retries network detection every second forever - so a short RPC
 *  outage during a demo would pile up dozens of retrying providers. With staticNetwork, a failed
 *  call just fails and the next poll tries again. */
export function getReadProvider(): Provider {
  if (!readProvider) {
    readProvider = new JsonRpcProvider(RPC_URL, Network.from(READ_CHAIN_ID), { staticNetwork: true });
  }
  return readProvider;
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

/** The same contracts, but at an address chosen at runtime - used by the pages that show any
 *  election made through the factory rather than the single one set in the env file. */
export function getVoterRegistryAt(address: string, runner: Provider | Signer): Contract {
  return new Contract(address, voterRegistryAbi, runner);
}

export function getElectionBallotAt(address: string, runner: Provider | Signer): Contract {
  return new Contract(address, electionBallotAbi, runner);
}

export function getElectionFactory(runner: Provider | Signer): Contract {
  return new Contract(ELECTION_FACTORY_ADDRESS, electionFactoryAbi, runner);
}

export function factoryConfigured(): boolean {
  return Boolean(ELECTION_FACTORY_ADDRESS);
}

/** Turns a raw ethers/revert error into the plain-language message the contract already
 *  provides (NFR-04). Falls back to something generic rather than showing raw JSON-RPC text. */
export function describeError(err: any): string {
  // Wallet cancel: ethers v6 turns MetaMask's 4001 into code ACTION_REJECTED with
  // reason "rejected", so the error code is the reliable signal, not the message text.
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001 || err?.info?.error?.code === 4001) {
    return "You cancelled the request in your wallet.";
  }

  // -32002: MetaMask already has a request open (often from an earlier click) and is waiting.
  if (err?.code === -32002 || err?.info?.error?.code === -32002) {
    return "MetaMask is already waiting for you. Click the MetaMask icon in your browser toolbar to finish.";
  }

  // The revert reason can sit in different fields depending on the wallet and on whether the
  // failure came from gas estimation or the transaction itself, so check all of them.
  const messages: string[] = [
    err?.reason,
    err?.shortMessage,
    err?.info?.error?.message,
    err?.error?.message,
    err?.message,
  ].filter((m): m is string => typeof m === "string");

  for (const raw of messages) {
    const match = raw.match(/VeraTally: ([^"]+?)(?:"|$)/);
    if (match) {
      const reason = match[1].trim();
      return reason.charAt(0).toUpperCase() + reason.slice(1) + ".";
    }
  }
  if (messages.some((m) => /user (rejected|denied)/i.test(m))) {
    return "You cancelled the request in your wallet.";
  }
  return "Something went wrong. Please try again.";
}

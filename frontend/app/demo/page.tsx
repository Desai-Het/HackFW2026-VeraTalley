"use client";

import { APP_NAME } from "@/lib/brand";
import { useCallback, useEffect, useState } from "react";
import CandidateList from "@/components/CandidateList";
import {
  BALLOT_STATE_LABELS,
  contractsConfigured,
  describeError,
  getBrowserProvider,
  getElectionBallot,
  getReadProvider,
  getVoterRegistry,
  ELECTION_BALLOT_ADDRESS,
} from "@/lib/contracts";
import { ensureCorrectNetwork, getTargetChainId } from "@/lib/network";

const POLL_INTERVAL_MS = 5000;
const AMOY_CHAIN_ID = 80002;

type Status = { kind: "error" | "success" | "info"; text: string } | null;

export default function Home() {
  const [configured] = useState(contractsConfigured());

  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [tally, setTally] = useState<bigint[]>([]);
  const [ballotState, setBallotState] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [account, setAccount] = useState<string | null>(null);
  const [isEligible, setIsEligible] = useState<boolean | null>(null);
  const [hasVoted, setHasVoted] = useState<boolean | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const refreshPublicData = useCallback(async () => {
    if (!configured) return;
    try {
      const provider = getReadProvider();
      const ballot = getElectionBallot(provider);
      const [currentTitle, currentCandidates, currentTally, currentState] = await Promise.all([
        ballot.title(),
        ballot.getCandidates(),
        ballot.getTally(),
        ballot.state(),
      ]);
      setTitle(currentTitle);
      setCandidates(currentCandidates);
      setTally(currentTally);
      setBallotState(Number(currentState));
      setLoadError(false);
    } catch (err) {
      console.error("Failed to load election data", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [configured]);

  const refreshAccountData = useCallback(
    async (addr: string) => {
      if (!configured) return;
      try {
        const provider = getReadProvider();
        const registry = getVoterRegistry(provider);
        const ballot = getElectionBallot(provider);
        const [eligible, voted] = await Promise.all([registry.isEligible(addr), ballot.hasVoted(addr)]);
        setIsEligible(eligible);
        setHasVoted(voted);
      } catch (err) {
        console.error("Failed to load voter status", err);
      }
    },
    [configured]
  );

  // Initial load + poll the public tally/state so results update live for anyone watching,
  // connected wallet or not (NFR-02: within ~15s of a vote confirming).
  useEffect(() => {
    refreshPublicData();
    const id = setInterval(refreshPublicData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshPublicData]);

  useEffect(() => {
    if (account) refreshAccountData(account);
  }, [account, refreshAccountData]);

  useEffect(() => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) return;
    const onAccountsChanged = (accounts: string[]) => {
      setAccount(accounts[0] ?? null);
      if (!accounts[0]) {
        setIsEligible(null);
        setHasVoted(null);
      }
    };
    const onChainChanged = () => {
      // Simplest correct thing to do on a network switch: reload account-scoped state.
      if (account) refreshAccountData(account);
    };
    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [account, refreshAccountData]);

  async function connectWallet() {
    setStatus(null);
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setStatus({
        kind: "error",
        text: "No wallet found. Install MetaMask from metamask.io to vote - you can still watch results below without it.",
      });
      return;
    }
    try {
      await ensureCorrectNetwork(ethereum);
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
    } catch (err) {
      setStatus({ kind: "error", text: describeError(err) });
    }
  }

  async function castVote() {
    if (selectedId === null || !account) return;
    setPending(true);
    setStatus(null);
    try {
      const ethereum = (window as any).ethereum;
      await ensureCorrectNetwork(ethereum);
      const provider = getBrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const ballot = getElectionBallot(signer);
      const tx = await ballot.castVote(selectedId);
      setStatus({ kind: "info", text: "Vote submitted. Waiting for confirmation..." });
      const receipt = await tx.wait();
      setLastTxHash(receipt.hash);
      setStatus({ kind: "success", text: "Your vote was recorded." });
      await Promise.all([refreshPublicData(), refreshAccountData(account)]);
    } catch (err) {
      setStatus({ kind: "error", text: describeError(err) });
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <main>
        <h1>{APP_NAME}</h1>
        <div className="status-banner error">
          This app isn&apos;t pointed at a deployed election yet. Set NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS
          and NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS in frontend/.env.local - see .env.local.example and the
          addresses printed by <code>npm run contracts:deploy:local</code> or{" "}
          <code>npm run contracts:deploy:amoy</code>.
        </div>
      </main>
    );
  }

  const stateLabel = BALLOT_STATE_LABELS[ballotState] ?? "Unknown";
  const canVote = ballotState === 1 && Boolean(account) && isEligible === true && hasVoted === false;
  const explorerBase =
    getTargetChainId() === AMOY_CHAIN_ID ? "https://amoy.polygonscan.com/tx/" : null;

  return (
    <main>
      <h1>{loading ? APP_NAME : title || APP_NAME}</h1>
      <p>
        <span className="badge">{stateLabel}</span>
      </p>

      {loadError && (
        <div className="status-banner error" role="status">
          Can&apos;t reach the blockchain network right now. Retrying every few seconds.
        </div>
      )}

      {status && (
        <div className={`status-banner ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
          {status.text}
          {status.kind === "success" && lastTxHash && explorerBase && (
            <>
              {" "}
              <a href={`${explorerBase}${lastTxHash}`} target="_blank" rel="noreferrer">
                View on Polygonscan
              </a>
            </>
          )}
        </div>
      )}

      {!account ? (
        <button className="primary" onClick={connectWallet}>
          Connect wallet
        </button>
      ) : (
        <p>
          Connected as <span className="mono">{account}</span>
          {isEligible === false && " - this wallet is not registered to vote in this election."}
          {hasVoted === true && " - this wallet has already voted."}
        </p>
      )}

      <h2>Candidates</h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <CandidateList
          candidates={candidates}
          tally={tally}
          selectedId={selectedId}
          onSelect={setSelectedId}
          canVote={canVote}
        />
      )}

      {account && (
        <p>
          <button className="primary" onClick={castVote} disabled={!canVote || selectedId === null || pending}>
            {pending ? "Submitting..." : "Cast vote"}
          </button>
        </p>
      )}

      <p>
        <small>
          Contract: <span className="mono">{ELECTION_BALLOT_ADDRESS}</span>
        </small>
      </p>
    </main>
  );
}

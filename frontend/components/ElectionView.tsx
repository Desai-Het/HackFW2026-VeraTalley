"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminPanel from "@/components/AdminPanel";
import CandidateList from "@/components/CandidateList";
import {
  BALLOT_STATE_LABELS,
  describeError,
  getElectionBallotAt,
  getReadProvider,
  getVoterRegistryAt,
} from "@/lib/contracts";
import { shortAddress } from "@/lib/elections";
import { getTargetChainId } from "@/lib/network";
import { leaders } from "@/lib/verify";
import { getWalletSigner, useWallet } from "@/lib/useWallet";

const POLL_INTERVAL_MS = 5000;
const AMOY_CHAIN_ID = 80002;

type Status = { kind: "error" | "success" | "info"; text: string } | null;

type Props = { registryAddress: string; ballotAddress: string; electionId?: string };

/** One election, for anyone: public title/candidates/tally, the voter experience for registered
 *  wallets, and the admin panel when the connected wallet is this ballot's admin. */
export default function ElectionView({ registryAddress, ballotAddress, electionId }: Props) {
  const { account, hasWallet, connect, error: walletError } = useWallet();

  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [tally, setTally] = useState<bigint[]>([]);
  const [ballotState, setBallotState] = useState(0);
  const [admin, setAdmin] = useState<string | null>(null);
  const [voterCount, setVoterCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [isEligible, setIsEligible] = useState<boolean | null>(null);
  const [hasVoted, setHasVoted] = useState<boolean | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const refreshPublicData = useCallback(async () => {
    try {
      const provider = getReadProvider();
      const ballot = getElectionBallotAt(ballotAddress, provider);
      const registry = getVoterRegistryAt(registryAddress, provider);
      const [t, c, tl, s, a, vc] = await Promise.all([
        ballot.title(),
        ballot.getCandidates(),
        ballot.getTally(),
        ballot.state(),
        ballot.admin(),
        registry.voterCount(),
      ]);
      setTitle(t);
      setCandidates(c);
      setTally(tl);
      setBallotState(Number(s));
      setAdmin(a);
      setVoterCount(Number(vc));
      setLoadError(false);
    } catch (err) {
      console.error("Failed to load election data", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [ballotAddress, registryAddress]);

  const refreshAccountData = useCallback(
    async (addr: string) => {
      try {
        const provider = getReadProvider();
        const registry = getVoterRegistryAt(registryAddress, provider);
        const ballot = getElectionBallotAt(ballotAddress, provider);
        const [eligible, voted] = await Promise.all([registry.isEligible(addr), ballot.hasVoted(addr)]);
        setIsEligible(eligible);
        setHasVoted(voted);
      } catch (err) {
        console.error("Failed to load voter status", err);
      }
    },
    [ballotAddress, registryAddress]
  );

  useEffect(() => {
    refreshPublicData();
    const id = setInterval(refreshPublicData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshPublicData]);

  useEffect(() => {
    if (account) {
      refreshAccountData(account);
    } else {
      setIsEligible(null);
      setHasVoted(null);
    }
  }, [account, refreshAccountData]);

  async function castVote() {
    if (selectedId === null || !account) return;
    setPending(true);
    setStatus(null);
    try {
      const signer = await getWalletSigner();
      const ballot = getElectionBallotAt(ballotAddress, signer);
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

  const refreshAll = useCallback(async () => {
    await refreshPublicData();
    if (account) await refreshAccountData(account);
  }, [account, refreshAccountData, refreshPublicData]);

  const isAdmin = Boolean(account && admin && account.toLowerCase() === admin.toLowerCase());
  const stateLabel = BALLOT_STATE_LABELS[ballotState] ?? "Unknown";
  const canVote = ballotState === 1 && Boolean(account) && isEligible === true && hasVoted === false;
  const explorerBase = getTargetChainId() === AMOY_CHAIN_ID ? "https://amoy.polygonscan.com/tx/" : null;

  return (
    <main>
      <h1>{loading ? "Loading election..." : title || "Election"}</h1>
      <p>
        <span className={`badge badge-${["draft", "open", "closed"][ballotState] ?? "draft"}`}>{stateLabel}</span>
        {isAdmin && (
          <>
            {" "}
            <span className="badge">You are the admin</span>
          </>
        )}
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

      {walletError && (
        <div className="status-banner error" role="status">
          {walletError}
        </div>
      )}

      {!account ? (
        <button className="primary" onClick={connect}>
          Connect wallet
        </button>
      ) : (
        <div className="wallet-line">
          <span className="wallet-pill mono" title={account}>
            {shortAddress(account)}
          </span>
          <span>
            {isEligible === true && hasVoted === false && ballotState === 1 && "You can vote in this election."}
            {isEligible === false && !isAdmin && "This wallet isn't registered to vote here."}
            {isEligible === false && isAdmin && "You're the admin. Add your own address below if you want to vote."}
            {hasVoted === true && "This wallet has already voted."}
          </span>
        </div>
      )}
      {hasWallet === false && (
        <p>
          <small>No wallet detected. You can still follow the results below.</small>
        </p>
      )}

      {isAdmin && (
        <AdminPanel
          registryAddress={registryAddress}
          ballotAddress={ballotAddress}
          state={ballotState}
          voterCount={voterCount}
          candidateCount={candidates.length}
          onChanged={refreshAll}
        />
      )}

      {ballotState === 2 && !loading && (
        <div className="result-banner" role="status">
          {(() => {
            const top = leaders(tally);
            if (top.length === 0) return <strong>Voting is closed. No votes were cast.</strong>;
            if (top.length === 1) return <strong>Result: {candidates[top[0]]} won with {tally[top[0]].toString()} {tally[top[0]] === 1n ? "vote" : "votes"}.</strong>;
            return <strong>Result: a tie between {top.map((i) => candidates[i]).join(" and ")}, with {tally[top[0]].toString()} each.</strong>;
          })()}
          {electionId && (
            <>
              {" "}
              <Link href={`/elections/${electionId}/verify`}>Check this result yourself</Link>
            </>
          )}
        </div>
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

      {electionId && ballotState !== 0 && ballotState !== 2 && (
        <p>
          <small>
            <Link href={`/elections/${electionId}/verify`}>Verify the count so far</Link>
          </small>
        </p>
      )}

      <p>
        <small>
          Ballot: <span className="mono">{ballotAddress}</span>
          <br />
          Voter list: <span className="mono">{registryAddress}</span>
        </small>
      </p>
    </main>
  );
}

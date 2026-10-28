"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminPanel from "@/components/AdminPanel";
import CandidateList from "@/components/CandidateList";
import TallyScene from "@/components/TallySceneLazy";
import StateBadge from "@/components/StateBadge";
import { getElectionBallotAt, getReadProvider, getVoterRegistryAt } from "@/lib/contracts";
import { shortAddress } from "@/lib/elections";
import { useWallet } from "@/lib/useWallet";
import { useMyElections } from "@/lib/useAuth";
import { leaders } from "@/lib/verify";

const POLL_INTERVAL_MS = 5000;

type Props = { registryAddress: string; ballotAddress: string; electionId?: string };

/** One election, for anyone. Voters see a short prompt for where they stand (ready,
 *  not registered, already voted), the ballot, and the result once closed. The election's admin
 *  additionally gets the manage panel. Technical details sit in a collapsed section. */
export default function ElectionView({ registryAddress, ballotAddress, electionId }: Props) {
  const { account, error: walletError } = useWallet();
  const myElections = useMyElections();

  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [tally, setTally] = useState<bigint[]>([]);
  const [ballotState, setBallotState] = useState(0);
  const [admin, setAdmin] = useState<string | null>(null);
  const [voterCount, setVoterCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0); // everyone invited, plus wallets added directly
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [isEligible, setIsEligible] = useState<boolean | null>(null);
  const [hasVoted, setHasVoted] = useState<boolean | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const refreshPublicData = useCallback(async () => {
    try {
      const provider = getReadProvider();
      const ballot = getElectionBallotAt(ballotAddress, provider);
      const registry = getVoterRegistryAt(registryAddress, provider);
      const [t, c, tl, s, a, vc, ic, icc] = await Promise.all([
        ballot.title(),
        ballot.getCandidates(),
        ballot.getTally(),
        ballot.state(),
        ballot.admin(),
        registry.voterCount(),
        registry.inviteCount(),
        registry.inviteClaimedCount(),
      ]);
      setTitle(t);
      setCandidates(c);
      setTally(tl);
      setBallotState(Number(s));
      setAdmin(a);
      setVoterCount(Number(vc));
      setApprovedCount(Number(ic) + Number(vc) - Number(icc));
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
    // A different wallet starts with a clean slate: no leftover ballot choice.
    setSelectedId(null);
    if (account) {
      refreshAccountData(account);
    } else {
      setIsEligible(null);
      setHasVoted(null);
    }
  }, [account, refreshAccountData]);

  const refreshAll = useCallback(async () => {
    await refreshPublicData();
    if (account) await refreshAccountData(account);
  }, [account, refreshAccountData, refreshPublicData]);

  const isAdmin = Boolean(electionId && myElections && myElections.includes(Number(electionId)));
  const canVote = ballotState === 1 && Boolean(account) && isEligible === true && hasVoted === false;
  // Someone choosing a candidate needs the selectable list; everyone else gets the 3D results (the
  // list stays in the page, hidden, for screen readers) so the same numbers are not shown twice.
  const showScene = ballotState !== 0 && !canVote;

  const manage = isAdmin ? (
    <AdminPanel
      registryAddress={registryAddress}
      ballotAddress={ballotAddress}
      state={ballotState}
      voterCount={voterCount}
      onChanged={refreshAll}
      electionId={electionId}
      title={title}
    />
  ) : null;

  /** One sentence telling this visitor where they stand, with the next action if there is one. */
  function prompt() {
    if (loading || ballotState === 2) return null;
    if (ballotState === 0) {
      return (
        <div className="vote-prompt">
          <p>Voting hasn&apos;t opened yet. Check back once the organizer opens it.</p>
        </div>
      );
    }
    if (!account) return null;
    const pill = (
      <span className="wallet-pill mono" title={account}>
        {shortAddress(account)}
      </span>
    );
    if (hasVoted === true) {
      return (
        <div className="vote-prompt">
          <p>
            {pill} has already voted.
          </p>
        </div>
      );
    }
    if (isEligible === true) {
      return (
        <div className="vote-prompt ready">
          <p>
            {pill} can vote in this election. Choose one candidate, then confirm.
          </p>
        </div>
      );
    }
    if (isEligible === false && !isAdmin) {
      return (
        <div className="vote-prompt">
          <p>
            {pill} isn&apos;t registered to vote here. Ask the organizer to add this wallet.
          </p>
        </div>
      );
    }
    return null;
  }

  const top = leaders(tally);

  return (
    <main>
      <div className="election-head">
        <h1>{loading ? "Loading election..." : title || "Election"}</h1>
        <div className="meta-line">
          {isAdmin && <span className="badge">You manage this election</span>}
          {!loading && (
            <span>
              {approvedCount} approved {approvedCount === 1 ? "voter" : "voters"}
            </span>
          )}
        </div>
      </div>

      <div className="stack">
        {loadError && (
          <div className="status-banner error" role="status">
            Can&apos;t reach the blockchain network right now. Retrying every few seconds.
          </div>
        )}

        {walletError && (
          <div className="status-banner error" role="status">
            {walletError}
          </div>
        )}

        {/* The manage panel keeps one place in the tree (so it keeps its own messages when the
            election opens) and is moved visually: first while setting up, after the ballot later. */}
        {manage && <div className={ballotState === 0 ? "order-first" : "order-late"}>{manage}</div>}

        {ballotState === 2 && !loading && (
          <div className="result-banner" role="status">
            {top.length === 0 && <strong>Voting is closed. No votes were cast.</strong>}
            {top.length === 1 && (
              <strong>
                Result: {candidates[top[0]]} won with {tally[top[0]].toString()} {tally[top[0]] === 1n ? "vote" : "votes"}.
              </strong>
            )}
            {top.length > 1 && (
              <strong>
                Result: a tie between {top.map((i) => candidates[i]).join(" and ")}, with {tally[top[0]].toString()} each.
              </strong>
            )}
          </div>
        )}

        {/* While setting up, the organiser sees only the manage steps; the ballot is for voters. */}
        {!(isAdmin && ballotState === 0) && (
          <section className="card" aria-label="Ballot">
            {prompt()}
            <div className="ballot-head">
              <h2>{ballotState === 2 ? "Final results" : "Candidates"}</h2>
              <StateBadge state={ballotState} />
            </div>
            {loading ? (
              <p>Loading...</p>
            ) : (
              <>
                {showScene && (
                  <TallyScene candidates={candidates} tally={tally.map((x) => Number(x ?? 0n))} closed={ballotState === 2} />
                )}
                <div className={showScene ? "sr-only" : undefined}>
                  <CandidateList
                    candidates={candidates}
                    tally={tally}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    canVote={canVote}
                  />
                </div>
              </>
            )}
          </section>
        )}

        {electionId && ballotState !== 0 && (
          <div className="tools-row">
            <Link href={`/elections/${electionId}/live`} target="_blank" rel="noreferrer" className="btn">
              Open live display
            </Link>
          </div>
        )}

        <details className="details order-last">
          <summary>Election details</summary>
          <dl className="details-body">
            <dt>Organizer</dt>
            <dd className="mono">{admin ?? "..."}</dd>
            <dt>Ballot contract</dt>
            <dd className="mono">{ballotAddress}</dd>
            <dt>Voter list contract</dt>
            <dd className="mono">{registryAddress}</dd>
          </dl>
        </details>
      </div>
    </main>
  );
}

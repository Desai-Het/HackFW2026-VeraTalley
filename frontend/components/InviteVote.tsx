"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CandidateList from "@/components/CandidateList";
import StateBadge from "@/components/StateBadge";
import { getElectionBallotAt, getReadProvider } from "@/lib/contracts";
import { shortAddress } from "@/lib/elections";
import {
  CODE_LENGTH,
  createVoterWallet,
  inviteAddressFromCode,
  inviteWalletFromCode,
  isValidCode,
  normalizeCode,
  signClaim,
  signVote,
} from "@/lib/invite";
import { CHAIN_ID_PUBLIC } from "@/lib/network-public";
import { explorerAddressUrl, explorerTxUrl, getRelayStatus, relay, type RelayStatus } from "@/lib/relay";
import { findVoteOf, loadVoterWallet, readInvite, saveVoterWallet, type FoundVote, type InviteInfo } from "@/lib/voting";

type Props = { registryAddress: string; ballotAddress: string; electionId: number };

type Election = { title: string; candidates: string[]; tally: bigint[]; state: number };

/** The whole voter experience for someone arriving from an invitation email: open the link,
 *  pick a candidate, vote. No wallet, no coins. Behind the scenes the browser makes the voter a
 *  private key, signs two messages, and a server pays to submit them - but the contract checks
 *  every signature, so the server cannot change a vote. */
export default function InviteVote({ registryAddress, ballotAddress, electionId }: Props) {
  const [rawCode, setRawCode] = useState("");
  const [typed, setTyped] = useState("");
  const [election, setElection] = useState<Election | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [found, setFound] = useState<FoundVote | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const codeOk = isValidCode(rawCode);
  const inviteAddress = useMemo(() => (codeOk ? inviteAddressFromCode(rawCode) : null), [rawCode, codeOk]);

  // The code arrives after the "#" in the emailed link; read it once on load.
  useEffect(() => {
    const fromLink = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (fromLink) setRawCode(fromLink);
  }, []);

  useEffect(() => {
    getRelayStatus().then(setRelayStatus);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const provider = getReadProvider();
      const ballot = getElectionBallotAt(ballotAddress, provider);
      const [title, candidates, tally, state] = await Promise.all([
        ballot.title(),
        ballot.getCandidates(),
        ballot.getTally(),
        ballot.state(),
      ]);
      setElection({ title, candidates, tally, state: Number(state) });
      if (inviteAddress) {
        const info = await readInvite(registryAddress, inviteAddress);
        setInvite(info);
        if (info.voter) {
          const voted: boolean = await ballot.hasVoted(info.voter);
          setHasVoted(voted);
          if (voted) setFound((prev) => prev ?? null);
        }
      }
      setLoadError(false);
    } catch (err) {
      console.error("Failed to load voting page", err);
      setLoadError(true);
    }
  }, [ballotAddress, registryAddress, inviteAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Once we know this person voted, look up which candidate the chain recorded for them.
  useEffect(() => {
    if (!hasVoted || !invite?.voter || found) return;
    findVoteOf(ballotAddress, invite.voter)
      .then((f) => f && setFound(f))
      .catch((err) => console.error("Could not look up the recorded vote", err));
  }, [hasVoted, invite?.voter, found, ballotAddress]);

  async function castVote() {
    if (selected === null || !inviteAddress || !election) return;
    setBusy(true);
    setError("");
    try {
      let voter = invite?.voter ? loadVoterWallet(registryAddress, inviteAddress) : null;
      if (invite?.status === 2 && (!voter || voter.address.toLowerCase() !== invite.voter?.toLowerCase())) {
        throw new Error(
          "This invitation was already used on another device or browser, so you can't vote from here. Open the link on the device you used first."
        );
      }
      if (invite?.status === 1) {
        // First visit: make a private key in this browser, keep it, then register it using the
        // invite. Saved before the network call so a dropped connection can be resumed.
        voter = createVoterWallet();
        if (!saveVoterWallet(registryAddress, inviteAddress, voter)) {
          throw new Error("This browser is blocking storage, which voting needs. Turn off private browsing and try again.");
        }
        setStep("Registering you as a voter...");
        const sig = await signClaim(inviteWalletFromCode(rawCode), CHAIN_ID_PUBLIC, registryAddress, voter.address);
        await relay({ kind: "claim", electionId, voter: voter.address, sig });
      }
      if (!voter) throw new Error("Something went wrong. Please reload the page.");
      setStep("Recording your vote...");
      const sig = await signVote(voter, CHAIN_ID_PUBLIC, ballotAddress, selected);
      const hash = await relay({ kind: "vote", electionId, voter: voter.address, candidateId: selected, sig });
      setFound({ candidateId: selected, txHash: hash });
      setStep("");
      await refresh();
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
      setStep("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  if (loadError && !election) {
    return (
      <main>
        <h1>Vote</h1>
        <div className="status-banner error" role="status">
          Can&apos;t reach the blockchain network right now. Reload the page to try again.
        </div>
      </main>
    );
  }
  if (!election) {
    return (
      <main>
        <h1>Loading...</h1>
      </main>
    );
  }

  const header = (
    <div className="election-head">
      <h1>{election.title}</h1>
      <div className="meta-line">
        <StateBadge state={election.state} />
      </div>
    </div>
  );

  // No usable code yet: ask for it.
  if (!codeOk) {
    return (
      <main>
        {header}
        <section className="card">
          <h2>Enter your voting code</h2>
          <p className="hint">
            Open the link from your invitation email and this page fills in by itself. If you only have the code, type it below.
          </p>
          <label htmlFor="code" className="sr-only">
            Voting code
          </label>
          <input
            id="code"
            className="mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="K7QM2-9XWPA-4HT8R-D3VNC"
            autoComplete="off"
            spellCheck={false}
          />
          {typed && !isValidCode(typed) && normalizeCode(typed).length >= CODE_LENGTH && (
            <div className="status-banner error" role="status">
              That code isn&apos;t valid. Check it for typos.
            </div>
          )}
          <button className="primary" disabled={!isValidCode(typed)} onClick={() => setRawCode(typed)}>
            Continue
          </button>
        </section>
      </main>
    );
  }

  if (!invite) {
    return (
      <main>
        {header}
        <p className="hint">Checking your invitation...</p>
      </main>
    );
  }

  if (invite.status === 0) {
    return (
      <main>
        {header}
        <div className="status-banner error" role="status">
          This voting code isn&apos;t valid for this election. Check that you opened the link from the right email.
        </div>
      </main>
    );
  }

  // Already voted: show what the chain recorded, with a way to check it independently.
  if (hasVoted && invite.voter) {
    const choice = found ? election.candidates[found.candidateId] : null;
    const txUrl = found ? explorerTxUrl(found.txHash) : null;
    const addrUrl = explorerAddressUrl(invite.voter);
    return (
      <main>
        {header}
        <section className="card receipt">
          <h2>Your vote is recorded</h2>
          <p>
            {choice ? (
              <>
                The blockchain shows your vote for <strong>{choice}</strong>.
              </>
            ) : (
              "The blockchain shows that you voted. Looking up your choice..."
            )}
          </p>
          <dl className="receipt-list">
            <dt>Your anonymous voter ID</dt>
            <dd className="mono">{shortAddress(invite.voter)}</dd>
            {found && (
              <>
                <dt>Transaction</dt>
                <dd className="mono">{shortAddress(found.txHash)}</dd>
              </>
            )}
          </dl>
          {(txUrl || addrUrl) && (
            <p className="hint">
              Don&apos;t take our word for it. Check it yourself on the public block explorer:{" "}
              {txUrl && (
                <a href={txUrl} target="_blank" rel="noreferrer">
                  see the transaction
                </a>
              )}
              {txUrl && addrUrl && " or "}
              {addrUrl && (
                <a href={addrUrl} target="_blank" rel="noreferrer">
                  see your voter ID
                </a>
              )}
              .
            </p>
          )}
          <p className="hint">
            Everyone can see how each anonymous ID voted, but nothing public links an ID to a person.{" "}
            <Link href={`/elections/${electionId}/verify`}>Recount the whole election</Link>
          </p>
        </section>
      </main>
    );
  }

  if (election.state === 2) {
    return (
      <main>
        {header}
        <p>
          Voting has closed
          {invite.status === 2 ? "." : " and this invitation was not used."}{" "}
          <Link href={`/elections/${electionId}`}>See the result</Link>
        </p>
      </main>
    );
  }

  if (election.state === 0) {
    return (
      <main>
        {header}
        <section className="card">
          <h2>Voting hasn&apos;t opened yet</h2>
          <p>Your invitation is valid. Keep this link and come back once the organizer opens voting.</p>
        </section>
      </main>
    );
  }

  const relayDown = relayStatus && !relayStatus.ok;
  const lowFunds = relayStatus && relayStatus.ok && Number(relayStatus.balance) < 0.01;

  return (
    <main>
      {header}
      <section className="card vote-card">
        <h2>Choose one candidate</h2>
        <p className="hint">You don&apos;t need a crypto wallet or any coins. You can vote once, and it can&apos;t be changed.</p>
        <CandidateList
          candidates={election.candidates}
          tally={election.tally}
          showCounts={false}
          selectedId={selected}
          onSelect={setSelected}
          canVote={!busy}
        />
        {relayDown && (
          <div className="status-banner error" role="status">
            Voting from this page is unavailable right now. Please try again in a few minutes, or ask the organizer.
          </div>
        )}
        {lowFunds && (
          <div className="status-banner" role="status">
            The voting server is low on funds. Votes may fail until the organizer tops it up.
          </div>
        )}
        {error && (
          <div className="status-banner error" role="alert">
            {error}
          </div>
        )}
        {busy && step && (
          <p className="hint" role="status">
            {step}
          </p>
        )}
        <button className="primary" onClick={castVote} disabled={busy || selected === null || !!relayDown}>
          {busy ? "Working..." : invite.status === 2 ? "Finish voting" : "Cast my vote"}
        </button>
        {invite.status === 2 && !busy && (
          <p className="hint">You&apos;re registered. Choose a candidate and finish voting.</p>
        )}
      </section>
    </main>
  );
}

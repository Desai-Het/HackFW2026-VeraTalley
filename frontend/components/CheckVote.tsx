"use client";

import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import StateBadge from "@/components/StateBadge";
import VoteJourney from "@/components/VoteJourneyLazy";
import { factoryConfigured } from "@/lib/contracts";
import { shortAddress } from "@/lib/elections";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/relay";
import { checkVoteTx, extractTxHash, type CheckedVote } from "@/lib/txcheck";

type Phase =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "invalid" }
  | { kind: "notfound" }
  | { kind: "failed" }
  | { kind: "novote" }
  | { kind: "error" }
  | { kind: "ok"; votes: CheckedVote[] };

function when(ms: number | null): string {
  if (!ms) return "Time not available";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function CheckVote() {
  const params = useSearchParams();
  const router = useRouter();
  const configured = factoryConfigured();
  const initial = params?.get("tx") ?? "";
  const [input, setInput] = useState(initial);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const run = useCallback(async (raw: string) => {
    if (!extractTxHash(raw)) {
      setPhase({ kind: "invalid" });
      return;
    }
    setPhase({ kind: "busy" });
    try {
      const r = await checkVoteTx(raw);
      setPhase(r.kind === "ok" ? { kind: "ok", votes: r.votes } : { kind: r.kind });
    } catch (err) {
      console.error("Vote check failed", err);
      setPhase({ kind: "error" });
    }
  }, []);

  // A link such as /check?tx=0x... (from a vote receipt) checks straight away.
  useEffect(() => {
    if (configured && initial) void run(initial);
  }, [configured, initial, run]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = extractTxHash(input);
    if (h) router.replace(`/check?tx=${h}`);
    void run(input);
  };

  if (!configured) {
    return (
      <main>
        <h1>Check a vote</h1>
        <ConfigNotice />
      </main>
    );
  }

  return (
    <main className="page-wide check-page">
      <h1>Where did my vote go?</h1>
      <p className="lede">
        Paste the transaction ID from your vote receipt. We read that transaction straight from the blockchain and show which
        election it belongs to and which candidate it was recorded for.
      </p>

      <form className="check-form" onSubmit={submit}>
        <label htmlFor="tx">Transaction ID</label>
        <div className="check-row">
          <input
            id="tx"
            className="mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
          />
          <button className="primary" type="submit" disabled={phase.kind === "busy"}>
            {phase.kind === "busy" ? "Checking..." : "Check this vote"}
          </button>
        </div>
        <p className="hint">You can also paste a block explorer link. No wallet or sign-in needed.</p>
      </form>

      {phase.kind === "invalid" && (
        <div className="status-banner error" role="status">
          That doesn&apos;t look like a transaction ID. It starts with 0x and is 66 characters long.
        </div>
      )}
      {phase.kind === "notfound" && (
        <div className="status-banner error" role="status">
          This network has no transaction with that ID. Check that you copied all of it, and that this site is pointed at the same
          network the vote was cast on. If you voted a moment ago, wait a few seconds and try again.
        </div>
      )}
      {phase.kind === "failed" && (
        <div className="status-banner error" role="status">
          That transaction exists but failed, so it did not record a vote.
        </div>
      )}
      {phase.kind === "novote" && (
        <div className="status-banner error" role="status">
          That transaction doesn&apos;t record a vote in any {APP_NAME} election.
        </div>
      )}
      {phase.kind === "error" && (
        <div className="status-banner error" role="status">
          Couldn&apos;t reach the blockchain network right now. Try again in a moment.
        </div>
      )}

      {phase.kind === "ok" &&
        phase.votes.map((v, i) => {
          const txUrl = explorerTxUrl(v.txHash);
          const voterUrl = explorerAddressUrl(v.voter);
          return (
            <section key={i} className="card check-result" aria-label="Vote found">
              <div className={`status-banner ${v.contractAgrees ? "success" : "error"}`} role="status">
                {v.contractAgrees
                  ? `Confirmed: this transaction recorded a vote for ${v.candidateName}, and the ballot contract still agrees.`
                  : "The transaction contains this vote, but the ballot contract's current records don't back it up. Do not rely on it."}
              </div>

              <VoteJourney
                voterLabel={shortAddress(v.voter)}
                senderLabel={shortAddress(v.txHash)}
                ballotLabel={shortAddress(v.ballot)}
                candidates={v.candidates}
                tally={v.tally}
                chosen={v.candidateId}
              />

              <h2 className="check-title">
                {v.title} <StateBadge state={v.state} />
              </h2>
              <dl className="receipt-list">
                <dt>Recorded for</dt>
                <dd>
                  <strong>{v.candidateName}</strong>
                </dd>
                <dt>Election</dt>
                <dd>
                  <Link href={`/elections/${v.electionId}`}>{v.title}</Link>
                </dd>
                <dt>Voter ID</dt>
                <dd className="mono">{v.voter}</dd>
                <dt>Sent by</dt>
                <dd className="mono">
                  {v.relayed ? `${v.submittedBy} (the voting server, which paid the fee for the voter)` : `${v.submittedBy} (the voter)`}
                </dd>
                <dt>Recorded</dt>
                <dd>
                  {when(v.time)} · block {v.blockNumber} · {v.confirmations} {v.confirmations === 1 ? "confirmation" : "confirmations"}
                </dd>
                <dt>Ballot contract</dt>
                <dd className="mono">{v.ballot}</dd>
              </dl>
              <p className="hint">
                {v.tally[v.candidateId]} {v.tally[v.candidateId] === 1 ? "vote is" : "votes are"} now counted for {v.candidateName} in
                this election.{" "}
                <Link href={`/elections/${v.electionId}/verify`}>Recount the whole election</Link>
                {(txUrl || voterUrl) && (
                  <>
                    {" · "}
                    {txUrl && (
                      <a href={txUrl} target="_blank" rel="noreferrer">
                        open on the block explorer
                      </a>
                    )}
                    {txUrl && voterUrl && " · "}
                    {voterUrl && (
                      <a href={voterUrl} target="_blank" rel="noreferrer">
                        voter ID on the explorer
                      </a>
                    )}
                  </>
                )}
              </p>
            </section>
          );
        })}
    </main>
  );
}

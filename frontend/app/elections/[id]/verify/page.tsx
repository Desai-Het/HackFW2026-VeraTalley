"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import StateBadge from "@/components/StateBadge";
import { factoryConfigured, getElectionBallotAt, getElectionFactory, getReadProvider } from "@/lib/contracts";
import { isUnknownElectionError } from "@/lib/elections";
import { verifyElection, type VerificationResult } from "@/lib/verify";

type Phase =
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error" }
  | { kind: "ready"; registry: string; ballot: string; title: string; state: number };

export default function VerifyPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const configured = factoryConfigured();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(false);

  useEffect(() => {
    if (!configured) return;
    if (!/^\d+$/.test(id) || id.length > 20) {
      setPhase({ kind: "notfound" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const provider = getReadProvider();
        const record = await getElectionFactory(provider).getElection(BigInt(id));
        const ballot = getElectionBallotAt(record[2], provider);
        const [title, state] = await Promise.all([ballot.title(), ballot.state()]);
        if (!cancelled) setPhase({ kind: "ready", registry: record[1], ballot: record[2], title, state: Number(state) });
      } catch (err) {
        if (cancelled) return;
        if (isUnknownElectionError(err)) setPhase({ kind: "notfound" });
        else {
          console.error(err);
          setPhase({ kind: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, configured]);

  const run = useCallback(async () => {
    if (phase.kind !== "ready") return;
    setRunning(true);
    setRunError(false);
    try {
      setResult(await verifyElection(phase.registry, phase.ballot));
    } catch (err) {
      console.error("Verification failed", err);
      setRunError(true);
    } finally {
      setRunning(false);
    }
  }, [phase]);

  if (!configured) {
    return (
      <main>
        <h1>Verify an election</h1>
        <ConfigNotice />
      </main>
    );
  }
  if (phase.kind === "loading") {
    return (
      <main>
        <h1>Loading...</h1>
      </main>
    );
  }
  if (phase.kind === "notfound") {
    return (
      <main>
        <h1>Election not found</h1>
        <p>There is no election with that number.</p>
      </main>
    );
  }
  if (phase.kind === "error") {
    return (
      <main>
        <h1>Verify an election</h1>
        <div className="status-banner error" role="status">
          Can&apos;t reach the blockchain network right now. Reload the page to try again.
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Verify: {phase.title}</h1>
      <p>
        <StateBadge state={phase.state} />{" "}
        <Link href={`/elections/${id}`}>Back to the election</Link>
      </p>
      <p>
        This reads every vote recorded on the blockchain for this election, counts them again from scratch, and compares the
        result with the tally the contract reports. It needs no wallet and does not rely on this website&apos;s own numbers.
      </p>
      {phase.state !== 2 && (
        <div className="status-banner" role="status">
          Voting isn&apos;t closed yet, so this is a check of the votes so far, not a final result.
        </div>
      )}

      <button className="primary" onClick={run} disabled={running}>
        {running ? "Checking..." : result ? "Check again" : "Verify this election"}
      </button>

      {runError && (
        <div className="status-banner error" role="status">
          The check couldn&apos;t finish. The network may be busy or limiting how much history it will return. Try again in a moment.
        </div>
      )}

      {result && (
        <section className="panel" aria-label="Verification result">
          <div className={`status-banner ${result.problems.length === 0 ? "success" : "error"}`} role="status">
            {result.problems.length === 0
              ? "Verified: the recount matches the contract's tally and every vote came from a registered wallet, once each."
              : "Problems found. Do not rely on this result until they are explained."}
          </div>
          {result.problems.length > 0 && (
            <ul>
              {result.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          <table className="verify-table">
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Contract tally</th>
                <th scope="col">Recount</th>
              </tr>
            </thead>
            <tbody>
              {result.candidates.map((name, i) => (
                <tr key={i}>
                  <th scope="row">{name}</th>
                  <td>{result.reportedTally[i].toString()}</td>
                  <td>{result.recountedTally[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {result.totalVotesCast} {result.totalVotesCast === 1 ? "vote" : "votes"} from {result.registeredVoters}{" "}
            registered {result.registeredVoters === 1 ? "voter" : "voters"}. Checked as of block {result.atBlock}.
          </p>
        </section>
      )}

      <p>
        <small>
          Ballot: <span className="mono">{phase.ballot}</span>
          <br />
          Voter list: <span className="mono">{phase.registry}</span>
        </small>
      </p>
    </main>
  );
}

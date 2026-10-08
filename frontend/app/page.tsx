"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BALLOT_STATE_LABELS, factoryConfigured, getElectionFactory, getReadProvider } from "@/lib/contracts";
import { fetchElectionSummary, shortAddress, type ElectionSummary } from "@/lib/elections";

const LATEST_COUNT = 5;

export default function Landing() {
  const configured = factoryConfigured();
  const [items, setItems] = useState<ElectionSummary[]>([]);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    (async () => {
      try {
        const count = Number(await getElectionFactory(getReadProvider()).electionCount());
        const ids: number[] = [];
        for (let i = count - 1; i >= Math.max(0, count - LATEST_COUNT); i--) ids.push(i);
        const rows = await Promise.all(ids.map((id) => fetchElectionSummary(id)));
        if (!cancelled) setItems(rows);
      } catch (err) {
        console.error("Failed to load elections", err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  return (
    <main>
      <section className="hero">
        <h1>Vote, then check the result yourself.</h1>
        <p>
          VeraTally runs elections on a public blockchain. Every vote is recorded openly, nobody can change the count
          afterwards, and anyone can recount it without an account.
        </p>
        <div className="page-actions">
          <Link href="/elections/create" className="btn primary">
            Create an election
          </Link>
          <Link href="/elections" className="btn">
            Browse elections
          </Link>
        </div>
      </section>

      {!configured && (
        <div className="status-banner error">
          This app isn&apos;t pointed at an election factory yet. Set NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS in
          frontend/.env.local, then restart the app.
        </div>
      )}

      {configured && (
        <>
          <h2>Latest elections</h2>
          {loading && <p>Loading...</p>}
          {error && (
            <div className="status-banner error" role="status">
              Can&apos;t reach the blockchain network right now. Reload the page to try again.
            </div>
          )}
          {!loading && !error && items.length === 0 && <p>No elections yet. Create the first one.</p>}
          <ul className="election-list">
            {items.map((e) => {
              const label = BALLOT_STATE_LABELS[e.state] ?? "Unknown";
              return (
                <li key={e.id}>
                  <Link href={`/elections/${e.id}`} className="election-row">
                    <span>
                      <strong>{e.title}</strong>
                      <br />
                      <small>
                        {e.candidateCount} candidates, created by <span className="mono">{shortAddress(e.creator)}</span>
                      </small>
                    </span>
                    <span className={`badge badge-${label.toLowerCase()}`}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > 0 && (
            <p style={{ marginTop: 16 }}>
              <Link href="/elections">See all elections</Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}

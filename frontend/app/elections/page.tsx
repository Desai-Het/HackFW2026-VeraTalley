"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BALLOT_STATE_LABELS, factoryConfigured, getElectionFactory, getReadProvider } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { fetchElectionSummary, shortAddress, type ElectionSummary } from "@/lib/elections";

const PAGE_SIZE = 20;

export default function ElectionsPage() {
  const configured = factoryConfigured();
  const [items, setItems] = useState<ElectionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [mineOnly, setMineOnly] = useState(false);
  const { account, connect } = useWallet();

  const load = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    try {
      const count = Number(await getElectionFactory(getReadProvider()).electionCount());
      setTotal(count);
      // Newest first.
      const ids: number[] = [];
      for (let i = count - 1; i >= Math.max(0, count - shown); i--) ids.push(i);
      setItems(await Promise.all(ids.map((id) => fetchElectionSummary(id))));
      setError(false);
    } catch (err) {
      console.error("Failed to load elections", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [configured, shown]);

  useEffect(() => {
    load();
  }, [load]);

  const visible =
    mineOnly && account ? items.filter((e) => e.creator.toLowerCase() === account.toLowerCase()) : items;

  if (!configured) {
    return (
      <main>
        <h1>Elections</h1>
        <div className="status-banner error">
          This app isn&apos;t pointed at an election factory yet. Set NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS in
          frontend/.env.local, then restart the app.
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Elections</h1>
      <div className="page-actions">
        <Link href="/elections/create" className="btn primary">
          Create an election
        </Link>
        <button onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="status-banner error" role="status">
          Can&apos;t reach the blockchain network right now. Press Refresh to try again.
        </div>
      )}

      {!error && !loading && total === 0 && <p>No elections yet. Be the first to create one.</p>}

      <div className="tabs" role="group" aria-label="Filter elections">
        <button aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>
          All
        </button>
        {account ? (
          <button aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>
            Created by me
          </button>
        ) : (
          <button onClick={connect}>Connect wallet to see mine</button>
        )}
      </div>

      {mineOnly && !loading && !error && visible.length === 0 && (
        <p>You haven&apos;t created any elections in the {items.length} shown. Try &quot;Show older elections&quot; or create one.</p>
      )}

      <ul className="election-list">
        {visible.map((e) => (
          <li key={e.id}>
            <Link href={`/elections/${e.id}`} className="election-row">
              <span>
                <strong>{e.title}</strong>
                <br />
                <small>
                  {e.candidateCount} candidates, created by <span className="mono">{shortAddress(e.creator)}</span>
                </small>
              </span>
              <span className={`badge badge-${["draft", "open", "closed"][e.state] ?? "draft"}`}>{BALLOT_STATE_LABELS[e.state] ?? "Unknown"}</span>
            </Link>
          </li>
        ))}
      </ul>

      {total > shown && (
        <p>
          <button onClick={() => setShown(shown + PAGE_SIZE)} disabled={loading}>
            Show older elections
          </button>
        </p>
      )}
    </main>
  );
}

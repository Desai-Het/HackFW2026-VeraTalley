"use client";

import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import StateBadge from "@/components/StateBadge";
import { factoryConfigured } from "@/lib/contracts";
import { fetchVisibleElections, shortAddress, type ElectionSummary } from "@/lib/elections";
import { useAuth, useMyElections } from "@/lib/useAuth";

const PAGE_SIZE = 24;

type Filter = "all" | "open" | "closed" | "mine";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "mine", label: "My elections" },
];

export default function ElectionsPage() {
  const configured = factoryConfigured();
  const [items, setItems] = useState<ElectionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const { user } = useAuth();
  const myIds = useMyElections();

  const load = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    try {
      // Newest first. Strangers' elections are left out when organiser wallets are configured.
      const { items: rows, more } = await fetchVisibleElections(shown);
      setItems(rows);
      setTotal(more ? shown + 1 : rows.length);
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((e) => {
      if (q && !e.title.toLowerCase().includes(q)) return false;
      if (filter === "open") return e.state === 1;
      if (filter === "closed") return e.state === 2;
      if (filter === "mine") return Boolean(myIds) && myIds!.includes(e.id);
      return true;
    });
  }, [items, filter, query, myIds]);

  function pick(next: Filter) {
    setFilter(next);
  }

  return (
    <main className="page-wide">
      <div className="page-title-row">
        <h1>Elections</h1>
        <p>Every election on {APP_NAME}, newest first.</p>
      </div>

      {!configured ? (
        <ConfigNotice />
      ) : (
        <>
          <div className="toolbar">
            <input
              type="search"
              className="search"
              placeholder="Search by title"
              aria-label="Search elections by title"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="chips" role="group" aria-label="Filter elections">
              {FILTERS.map((f) => (
                <button key={f.id} aria-pressed={filter === f.id} onClick={() => pick(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <button className="btn-sm" onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {error && (
            <div className="status-banner error" role="status">
              Can&apos;t reach the blockchain network right now. Press Refresh to try again.
            </div>
          )}

          {filter === "mine" && !user && (
            <div className="status-banner">
              <Link href="/login?next=/elections">Sign in</Link> to see the elections you run.
            </div>
          )}

          {!error && !loading && total === 0 && (
            <div className="empty">
              <h3>No elections yet</h3>
              <p>Use Create election at the top to start the first one.</p>
            </div>
          )}

          {!error && !loading && total > 0 && visible.length === 0 && !(filter === "mine" && !user) && (
            <div className="empty">
              <h3>Nothing matches</h3>
              <p>
                {total > shown
                  ? "Try a different search or filter, or load older elections below."
                  : "Try a different search or filter."}
              </p>
            </div>
          )}

          <ul className="election-grid">
            {visible.map((e) => (
              <li key={e.id}>
                <Link href={`/elections/${e.id}`} className="election-card" data-tilt="6">
                  <span className="election-card-title">{e.title}</span>
                  <span className="election-card-meta">
                    <span>
                      {e.candidateCount} candidates, by <span className="mono">{shortAddress(e.creator)}</span>
                    </span>
                    <StateBadge state={e.state} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {total > shown && (
            <p style={{ marginTop: 20 }}>
              <button onClick={() => setShown(shown + PAGE_SIZE)} disabled={loading}>
                Show older elections
              </button>
            </p>
          )}
        </>
      )}
    </main>
  );
}

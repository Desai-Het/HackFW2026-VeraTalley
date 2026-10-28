"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StateBadge from "@/components/StateBadge";
import { api } from "@/lib/api";
import { passwordError } from "@/lib/auth";
import { fetchElectionSummary, type ElectionSummary } from "@/lib/elections";
import { factoryConfigured } from "@/lib/contracts";
import { useAuth } from "@/lib/useAuth";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<ElectionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) window.location.replace("/login?next=/dashboard");
  }, [loading, user]);

  useEffect(() => {
    if (!user || !factoryConfigured()) return;
    let cancelled = false;
    (async () => {
      try {
        const { ids } = await api<{ ids: number[] }>("/api/org/mine");
        const rows = await Promise.all(ids.slice(0, 100).map((id) => fetchElectionSummary(id).catch(() => null)));
        if (!cancelled) setItems(rows.filter((r): r is ElectionSummary => r !== null));
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Could not load your elections.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading || !user) {
    return (
      <main>
        <h1>Loading...</h1>
      </main>
    );
  }

  return (
    <main className="page-wide">
      <div className="page-title-row">
        <h1>Your elections</h1>
        <p>
          Signed in as <strong>{user.username}</strong>
          {user.role === "owner" ? " (site owner: you can manage every election)" : ""}.
        </p>
      </div>

      <div className="tools-row" style={{ marginBottom: 16 }}>
        <Link href="/elections/create" className="btn primary">
          Create an election
        </Link>
        {user.role === "owner" && (
          <Link href="/accounts" className="btn">
            Manage accounts
          </Link>
        )}
      </div>

      {error && (
        <div className="status-banner error" role="status">
          {error}
        </div>
      )}

      {items && items.length === 0 && (
        <div className="empty">
          <h3>No elections yet</h3>
          <p>Create your first election, then share the registration QR code or invite voters by email.</p>
        </div>
      )}

      <ul className="election-grid">
        {(items ?? []).map((e) => (
          <li key={e.id}>
            <Link href={`/elections/${e.id}`} className="election-card" data-tilt="6">
              <span className="election-card-head">
                <span className="election-card-title">{e.title}</span>
                <StateBadge state={e.state} />
              </span>
              <span className="election-card-meta">
                <span>{e.candidateCount} candidates</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {user.role !== "owner" && <ChangePassword username={user.username} />}
    </main>
  );
}

function ChangePassword({ username }: { username: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const bad = passwordError(next, username);
    if (bad) return setMsg({ kind: "error", text: bad });
    setBusy(true);
    try {
      await api("/api/auth/password", { current, next });
      setCurrent("");
      setNext("");
      setMsg({ kind: "success", text: "Password changed." });
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message || "Could not change the password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="details" style={{ marginTop: 32 }}>
      <summary>Change my password</summary>
      <form onSubmit={submit} className="details-body" style={{ maxWidth: 420 }}>
        {msg && <div className={`status-banner ${msg.kind === "error" ? "error" : "success"}`} role="status">{msg.text}</div>}
        <div className="field">
          <label htmlFor="cur-pw">Current password</label>
          <input id="cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} required />
        </div>
        <div className="field">
          <label htmlFor="new-pw">New password</label>
          <input id="new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} disabled={busy} required />
          <p className="hint">At least 10 characters.</p>
        </div>
        <button type="submit" disabled={busy || !current || !next}>
          {busy ? "Saving..." : "Change password"}
        </button>
      </form>
    </details>
  );
}

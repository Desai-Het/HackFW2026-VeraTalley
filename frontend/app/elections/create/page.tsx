"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import Link from "next/link";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { factoryConfigured } from "@/lib/contracts";
import { useAuth } from "@/lib/useAuth";
import {
  MAX_CANDIDATES,
  MAX_CANDIDATE_LENGTH,
  MAX_TITLE_LENGTH,
  validateCandidates,
  validateTitle,
} from "@/lib/elections";

export default function CreateElectionPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) window.location.replace("/login?next=/elections/create");
  }, [loading, user]);

  if (!factoryConfigured()) {
    return (
      <main>
        <h1>Create an election</h1>
        <ConfigNotice />
      </main>
    );
  }

  function setCandidate(index: number, value: string) {
    setCandidates((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const t = validateTitle(title);
    if (t.error) return setStatus({ kind: "error", text: t.error });
    const c = validateCandidates(candidates);
    if (c.error) return setStatus({ kind: "error", text: c.error });

    setBusy(true);
    try {
      setStatus({ kind: "info", text: "Creating your election. This can take up to a minute..." });
      const data = await api<{ electionId: number }>("/api/org/create", { title: t.value, candidates: c.cleaned });
      router.push(`/elections/${data.electionId}`);
    } catch (err: any) {
      setStatus({ kind: "error", text: err?.message || "Could not create the election." });
      setBusy(false);
    }
  }

  if (!loading && !user) {
    return <main><h1>Create an election</h1><p><Link href="/login?next=/elections/create">Sign in</Link> to continue.</p></main>;
  }

  const previewNames = candidates.map((c) => c.trim()).filter(Boolean);

  return (
    <main className="page-wide">
      <div className="page-title-row">
        <h1>Create an election</h1>
        <p className="lede">
          Only you (and the site owner) can add voters and open or close voting. No wallet is needed. Candidates cannot be changed afterwards.
        </p>
      </div>

      {status && (
        <div className={`status-banner ${status.kind === "error" ? "error" : ""}`} role="status">
          {status.text}
        </div>
      )}

      <div className="create-layout">
        <form onSubmit={submit} className="card">
          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="title">Election title</label>
            <input
              id="title"
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="For example: Club president 2026"
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <span className="field-label">Candidates</span>
            <div className="candidate-inputs">
              {candidates.map((value, i) => (
                <div key={i} className="candidate-input-row">
                  <input
                    type="text"
                    aria-label={`Candidate ${i + 1}`}
                    value={value}
                    maxLength={MAX_CANDIDATE_LENGTH}
                    placeholder={`Candidate ${i + 1}`}
                    onChange={(e) => setCandidate(i, e.target.value)}
                    disabled={busy}
                  />
                  {candidates.length > 2 && (
                    <button type="button" onClick={() => setCandidates((p) => p.filter((_, j) => j !== i))} disabled={busy} aria-label={`Remove candidate ${i + 1}`}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {candidates.length < MAX_CANDIDATES && (
              <button type="button" onClick={() => setCandidates((p) => [...p, ""])} disabled={busy}>
                Add candidate
              </button>
            )}
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <button type="submit" className="primary btn-lg" disabled={busy || !user}>
              {busy ? "Creating..." : "Create election"}
            </button>
            <p className="hint" style={{ marginTop: 12 }}>
              Signed in as <strong>{user?.username ?? "..."}</strong>. The site pays the blockchain fee for you.
            </p>
          </div>
        </form>

        <aside className="card preview-card" aria-label="Ballot preview">
          <h3>What voters will see</h3>
          <p className={`preview-title${title.trim() ? "" : " placeholder"}`}>{title.trim() || "Your election title"}</p>
          {(previewNames.length > 0 ? previewNames : ["Candidate 1", "Candidate 2"]).map((name, i) => (
            <div key={i} className={`preview-option${previewNames.length > 0 ? "" : " placeholder"}`}>
              {name}
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}

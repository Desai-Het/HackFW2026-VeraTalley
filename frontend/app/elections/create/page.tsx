"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import { describeError, factoryConfigured, getElectionFactory } from "@/lib/contracts";
import {
  MAX_CANDIDATES,
  MAX_CANDIDATE_LENGTH,
  MAX_TITLE_LENGTH,
  parseCreatedElectionId,
  validateCandidates,
  validateTitle,
} from "@/lib/elections";
import { getWalletSigner, useWallet } from "@/lib/useWallet";

export default function CreateElectionPage() {
  const router = useRouter();
  const { account, hasWallet, connect, error: walletError } = useWallet();
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);

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
      const signer = await getWalletSigner();
      const factory = getElectionFactory(signer);
      const tx = await factory.createElection(t.value, c.cleaned);
      setStatus({ kind: "info", text: "Creating your election. Waiting for confirmation..." });
      const receipt = await tx.wait();
      const id = parseCreatedElectionId(factory, receipt);
      if (id === null) {
        setStatus({ kind: "info", text: "Election created. Find it under All elections." });
        router.push("/elections");
      } else {
        router.push(`/elections/${id}`);
      }
    } catch (err) {
      setStatus({ kind: "error", text: describeError(err) });
      setBusy(false);
    }
  }

  const previewNames = candidates.map((c) => c.trim()).filter(Boolean);

  return (
    <main className="page-wide">
      <div className="page-title-row">
        <h1>Create an election</h1>
        <p className="lede">
          You will be the only person who can add voters and open or close voting. Candidates cannot be changed afterwards.
        </p>
      </div>

      {walletError && <div className="status-banner error">{walletError}</div>}
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
            {account ? (
              <button type="submit" className="primary btn-lg" disabled={busy}>
                {busy ? "Creating..." : "Create election"}
              </button>
            ) : (
              <button type="button" className="primary btn-lg" onClick={connect}>
                Connect wallet to create
              </button>
            )}
            <p className="hint" style={{ marginTop: 12 }}>
              {account ? (
                <>
                  Creating as <span className="mono">{account}</span>. You&apos;ll confirm in your wallet.
                </>
              ) : hasWallet === false ? (
                "You need a wallet such as MetaMask to create an election."
              ) : (
                "Creating an election is a blockchain transaction, so you'll confirm it in your wallet."
              )}
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

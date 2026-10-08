"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
        <div className="status-banner error">
          This app isn&apos;t pointed at an election factory yet. Set NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS in
          frontend/.env.local, then restart the app.
        </div>
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

  return (
    <main>
      <h1>Create an election</h1>
      <p>You will be the only person who can add voters and open or close voting. Candidates cannot be changed afterwards.</p>

      {walletError && <div className="status-banner error">{walletError}</div>}
      {status && (
        <div className={`status-banner ${status.kind === "error" ? "error" : ""}`} role="status">
          {status.text}
        </div>
      )}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="title">Election title</label>
          <input
            id="title"
            type="text"
            value={title}
            maxLength={MAX_TITLE_LENGTH}
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

        {account ? (
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating..." : "Create election"}
          </button>
        ) : (
          <button type="button" className="primary" onClick={connect}>
            Connect wallet to create
          </button>
        )}
        {account && (
          <p>
            <small>
              Creating as <span className="mono">{account}</span>
            </small>
          </p>
        )}
        {hasWallet === false && (
          <p>
            <small>You need a wallet such as MetaMask to create an election.</small>
          </p>
        )}
      </form>
    </main>
  );
}

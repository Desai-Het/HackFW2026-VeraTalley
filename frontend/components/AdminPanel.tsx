"use client";

import { useMemo, useState } from "react";
import InvitePanel from "@/components/InvitePanel";
import RegistrationPanel from "@/components/RegistrationPanel";
import { api } from "@/lib/api";
import { MAX_VOTERS_PER_TRANSACTION, parseAddressList } from "@/lib/elections";

type Props = {
  registryAddress: string;
  ballotAddress: string;
  /** 0 = Draft, 1 = Open, 2 = Closed */
  state: number;
  voterCount: number;
  candidateCount: number;
  /** Called after any confirmed change so the page re-reads the chain straight away. */
  onChanged: () => Promise<void> | void;
  /** Used to build the shareable voting link/QR code - not every page that renders this panel
   *  necessarily has one yet, so it's optional. */
  electionId?: string;
  title: string;
};

type Status = { kind: "error" | "success" | "info"; text: string } | null;
type Confirming = "open" | "close" | null;
type Mode = "email" | "wallet";

/** Controls only the election's admin should see (CR-02). Hiding them is a convenience - the
 *  contracts refuse anyone else regardless - so nothing here is a security boundary. */
export default function AdminPanel({
  registryAddress,
  ballotAddress,
  state,
  voterCount,
  candidateCount,
  onChanged,
  electionId,
  title,
}: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [mode, setMode] = useState<Mode>("email");
  const [prefill, setPrefill] = useState({ text: "", n: 0 });

  const parsed = useMemo(() => parseAddressList(raw), [raw]);
  const tooMany = parsed.valid.length > MAX_VOTERS_PER_TRANSACTION;
  // The voter list freezes once voting opens (the contract enforces it).
  const canAdd = !busy && parsed.valid.length > 0 && !tooMany && state === 0;

  async function addVoters() {
    setBusy(true);
    setStatus(null);
    try {
      const { added, already } = await api<{ added: number; already: number }>("/api/org/voters", {
        electionId: Number(electionId),
        addresses: parsed.valid,
      });
      setStatus({
        kind: "success",
        text:
          `Added ${added} voter${added === 1 ? "" : "s"}.` +
          (already > 0 ? ` ${already} ${already === 1 ? "was" : "were"} already on the list.` : ""),
      });
      setRaw("");
      await onChanged();
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error)?.message || "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function changeState(action: "open" | "close") {
    setBusy(true);
    setStatus(null);
    setConfirming(null);
    try {
      setStatus({ kind: "info", text: "Submitting. This can take a few seconds..." });
      await api("/api/org/state", { electionId: Number(electionId), action });
      setStatus({ kind: "success", text: action === "open" ? "Voting is now open." : "Voting is closed. The result is final." });
      await onChanged();
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error)?.message || "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  if (state === 2 && !status) return null;

  // Setup is a real sequence while the election is still a draft, so the steps are numbered then.
  const numbered = state === 0;

  return (
    <section className="panel" aria-label="Election admin controls">
      <h2>Manage this election</h2>
      <p className="hint">Only you, as the organizer, can see and use these. The site pays the blockchain fees.</p>

      {status && (
        <div className={`status-banner ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
          {status.text}
        </div>
      )}

      {electionId && state !== 2 && (
        <div className="field">
          <StepHead n={numbered ? 1 : undefined} title="Collect registrations" />
          <div className={numbered ? "setup-body" : undefined}>
            <RegistrationPanel
              electionId={Number(electionId)}
              state={state}
              onLoadApproved={(emails) => {
                setMode("email");
                setPrefill((p) => ({ text: emails.join("\n"), n: p.n + 1 }));
              }}
            />
          </div>
        </div>
      )}

      {state !== 2 && (
        <div className="field">
          <StepHead n={numbered ? 2 : undefined} title="Add voters" />
          <div className={numbered ? "setup-body" : undefined}>
            {electionId && (
              <div className="mode-tabs" role="group" aria-label="How to add voters">
                <button type="button" aria-pressed={mode === "email"} onClick={() => setMode("email")}>
                  By email
                </button>
                <button type="button" aria-pressed={mode === "wallet"} onClick={() => setMode("wallet")}>
                  By wallet address
                </button>
              </div>
            )}
            {electionId && mode === "email" ? (
              <InvitePanel registryAddress={registryAddress} electionId={Number(electionId)} state={state} onChanged={onChanged} prefill={prefill} />
            ) : (
              <>
            <label htmlFor="voter-addresses" className="sr-only">
              Voter wallet addresses
            </label>
            <textarea
              id="voter-addresses"
              rows={4}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"Paste wallet addresses, one per line (commas and spaces work too)"}
              disabled={busy}
            />
            <p className="hint">
              {voterCount} {voterCount === 1 ? "voter" : "voters"} registered so far.
              {parsed.valid.length > 0 && ` ${parsed.valid.length} ready to add.`}
              {parsed.duplicates > 0 && ` ${parsed.duplicates} repeated ${parsed.duplicates === 1 ? "entry" : "entries"} ignored.`}
            </p>
            {parsed.invalid.length > 0 && (
              <div className="status-banner error" role="status">
                {parsed.invalid.length} {parsed.invalid.length === 1 ? "entry isn't" : "entries aren't"} a valid address and will not be added:{" "}
                <span className="mono">
                  {parsed.invalid.slice(0, 3).join(", ")}
                  {parsed.invalid.length > 3 ? ", ..." : ""}
                </span>
              </div>
            )}
            {tooMany && (
              <div className="status-banner error" role="status">
                Add at most {MAX_VOTERS_PER_TRANSACTION} voters at a time.
              </div>
            )}
            <button className="primary" onClick={addVoters} disabled={!canAdd}>
              {busy ? "Working..." : parsed.valid.length > 0 ? `Add ${parsed.valid.length} ${parsed.valid.length === 1 ? "voter" : "voters"}` : "Add voters"}
            </button>
            {state === 1 && <p className="hint">Voting has started, so the voter list is locked.</p>}
              </>
            )}
          </div>
        </div>
      )}

      {state === 0 && (
        <div className="field">
          <StepHead n={3} title="Open voting" />
          <div className="setup-body">
            {confirming === "open" ? (
              <div className="status-banner" role="alert">
                Opening voting lets registered voters start casting votes, and the candidates cannot be changed. Open voting for{" "}
                {candidateCount} candidates and {voterCount} registered {voterCount === 1 ? "voter" : "voters"}?
                <div className="row-actions">
                  <button className="primary" onClick={() => changeState("open")} disabled={busy}>
                    Yes, open voting
                  </button>
                  <button onClick={() => setConfirming(null)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="primary" onClick={() => setConfirming("open")} disabled={busy}>
                Open voting
              </button>
            )}
          </div>
        </div>
      )}

      {state === 1 && (
        <div className="field">
          <StepHead title="Close voting" />
          {confirming === "close" ? (
            <div className="status-banner error" role="alert">
              Closing voting is permanent. Nobody can vote afterwards and it cannot be reopened. Close voting now?
              <div className="row-actions">
                <button className="primary" onClick={() => changeState("close")} disabled={busy}>
                  Yes, close voting
                </button>
                <button onClick={() => setConfirming(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming("close")} disabled={busy}>
              Close voting
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function StepHead({ n, title }: { n?: number; title: string }) {
  return (
    <div className="setup-head">
      {n !== undefined && <span className="setup-num">{n}</span>}
      <h3>{title}</h3>
    </div>
  );
}

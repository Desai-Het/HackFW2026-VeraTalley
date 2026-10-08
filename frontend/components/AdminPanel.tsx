"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ShareQrCode from "@/components/ShareQrCode";
import { describeError, getElectionBallotAt, getVoterRegistryAt } from "@/lib/contracts";
import { MAX_VOTERS_PER_TRANSACTION, parseAddressList } from "@/lib/elections";
import { getWalletSigner } from "@/lib/useWallet";

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

  const parsed = useMemo(() => parseAddressList(raw), [raw]);
  const tooMany = parsed.valid.length > MAX_VOTERS_PER_TRANSACTION;
  const canAdd = !busy && parsed.valid.length > 0 && !tooMany && state !== 2;

  async function addVoters() {
    setBusy(true);
    setStatus(null);
    try {
      const signer = await getWalletSigner();
      const registry = getVoterRegistryAt(registryAddress, signer);
      const tx = await registry.registerVoters(parsed.valid);
      setStatus({ kind: "info", text: "Submitted. Waiting for confirmation..." });
      const receipt = await tx.wait();
      let added = 0;
      for (const log of receipt.logs) {
        try {
          if (registry.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "VoterRegistered") added += 1;
        } catch {
          // not a registry event
        }
      }
      const already = parsed.valid.length - added;
      setStatus({
        kind: "success",
        text:
          `Added ${added} voter${added === 1 ? "" : "s"}.` +
          (already > 0 ? ` ${already} ${already === 1 ? "was" : "were"} already on the list.` : ""),
      });
      setRaw("");
      await onChanged();
    } catch (err) {
      setStatus({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function changeState(action: "open" | "close") {
    setBusy(true);
    setStatus(null);
    setConfirming(null);
    try {
      const signer = await getWalletSigner();
      const ballot = getElectionBallotAt(ballotAddress, signer);
      const tx = action === "open" ? await ballot.openVoting() : await ballot.closeVoting();
      setStatus({ kind: "info", text: "Submitted. Waiting for confirmation..." });
      await tx.wait();
      setStatus({ kind: "success", text: action === "open" ? "Voting is now open." : "Voting is closed. The result is final." });
      await onChanged();
    } catch (err) {
      setStatus({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Election admin controls">
      <h2 style={{ marginTop: 0 }}>Admin controls</h2>
      <p className="hint">Only you, as this election&apos;s creator, can see and use these.</p>

      {status && (
        <div className={`status-banner ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
          {status.text}
        </div>
      )}

      {electionId && (
        <div className="field field-share">
          <h3>Share this election</h3>
          <p className="hint">
            Anyone who opens this link or scans the QR code can see the ballot, and can vote if they&apos;re
            registered.
          </p>
          <ShareQrCode path={`/elections/${electionId}`} shareTitle={`Vote: ${title}`} />
        </div>
      )}

      {state !== 2 && (
        <div className="field">
          <label htmlFor="voter-addresses">Add voters</label>
          <textarea
            id="voter-addresses"
            rows={5}
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
        </div>
      )}

      {state === 0 && (
        <div className="field">
          <h3>Open voting</h3>
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
            <button onClick={() => setConfirming("open")} disabled={busy}>
              Open voting
            </button>
          )}
        </div>
      )}

      {state === 1 && (
        <div className="field">
          <h3>Voting is open</h3>
          <div className="row-actions">
            {electionId && (
              <Link href={`/elections/${electionId}/live`} target="_blank" rel="noreferrer" className="btn primary">
                View live stats
              </Link>
            )}
            {confirming !== "close" && (
              <button onClick={() => setConfirming("close")} disabled={busy}>
                Close voting
              </button>
            )}
          </div>
          {confirming === "close" && (
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
          )}
        </div>
      )}

      {state === 2 && !status && <p className="hint">Voting is closed. There is nothing left to manage.</p>}
    </section>
  );
}

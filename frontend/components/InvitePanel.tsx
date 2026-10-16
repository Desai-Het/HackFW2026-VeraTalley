"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { describeError, getReadProvider, getVoterRegistryAt } from "@/lib/contracts";
import { MAX_INVITES_PER_REQUEST, adminMessage, parseEmailList } from "@/lib/invite";
import { getWalletSigner } from "@/lib/useWallet";

type Props = {
  registryAddress: string;
  electionId: number;
  /** 0 = Draft, 1 = Open, 2 = Closed */
  state: number;
  onChanged: () => Promise<void> | void;
  /** Fills the email box (used by the registration list). `n` changes each time so the same text can be loaded again. */
  prefill?: { text: string; n: number };
};

type Result = { email: string; status: "sent" | "already-claimed" | "not-registered" | "failed"; link?: string };
type Status = { kind: "error" | "success" | "info"; text: string } | null;

const LABELS: Record<Result["status"], string> = {
  sent: "Sent",
  "already-claimed": "Already voted or registered",
  "not-registered": "Not invited (invites close once voting opens)",
  failed: "Failed to send",
};

/** Invite voters by email. Each person gets a personal link; they need no wallet. The admin
 *  signs one short message (free) to prove who they are, puts the invites on-chain, and the
 *  server then emails the links. Safe to repeat: re-sending the same email re-sends the same
 *  link. */
export default function InvitePanel({ registryAddress, electionId, state, onChanged, prefill }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [counts, setCounts] = useState<{ invited: number; claimed: number } | null>(null);

  useEffect(() => {
    if (prefill && prefill.n > 0) setRaw(prefill.text);
  }, [prefill?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => parseEmailList(raw), [raw]);
  const tooMany = parsed.valid.length > MAX_INVITES_PER_REQUEST;
  const locked = state === 1; // can resend, cannot add new invites
  const canSend = !busy && parsed.valid.length > 0 && !tooMany && state !== 2;

  const refreshCounts = useCallback(async () => {
    try {
      const registry = getVoterRegistryAt(registryAddress, getReadProvider());
      const [invited, claimed] = await Promise.all([registry.inviteCount(), registry.inviteClaimedCount()]);
      setCounts({ invited: Number(invited), claimed: Number(claimed) });
    } catch {
      // Counts are a nicety; ignore a failed read.
    }
  }, [registryAddress]);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!data?.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
    return data;
  }

  async function send() {
    setBusy(true);
    setStatus(null);
    setResults(null);
    try {
      const emails = parsed.valid;
      const signer = await getWalletSigner();
      const issuedAt = Date.now();
      setStatus({ kind: "info", text: "Approve the sign-in request in your wallet. It is free and sends nothing." });
      const signature = await signer.signMessage(adminMessage("invites", electionId, emails, issuedAt, window.location.host.toLowerCase()));
      const auth = { electionId, emails, issuedAt, signature };

      if (state === 0) {
        setStatus({ kind: "info", text: "Preparing invitations..." });
        const prepared = await post("/api/invites/prepare", auth);
        const registry = getVoterRegistryAt(registryAddress, signer);
        const fresh: string[] = [];
        for (const inv of prepared.invites as { email: string; address: string }[]) {
          if (Number(await registry.inviteStatus(inv.address)) === 0) fresh.push(inv.address);
        }
        if (fresh.length > 0) {
          setStatus({ kind: "info", text: `Recording ${fresh.length} invitation${fresh.length === 1 ? "" : "s"} on the blockchain. Confirm in your wallet...` });
          const tx = await registry.addInvites(fresh);
          await tx.wait();
        }
      }

      setStatus({ kind: "info", text: "Sending emails..." });
      const sent = await post("/api/invites/send", auth);
      const list = sent.results as Result[];
      setResults(list);
      const ok = list.filter((r) => r.status === "sent").length;
      setStatus({
        kind: ok === list.length ? "success" : "error",
        text:
          sent.delivery === "links"
            ? `${ok} link${ok === 1 ? "" : "s"} ready. Copy them below and deliver each one privately.`
            : `${ok} of ${list.length} invitation${list.length === 1 ? "" : "s"} sent.`,
      });
      if (ok === list.length) setRaw("");
      await refreshCounts();
      await onChanged();
    } catch (err: any) {
      setStatus({ kind: "error", text: err?.message && !/VeraTally|ethers|execution reverted/i.test(err.message) ? err.message : describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  function downloadLinks() {
    const rows = (results ?? []).filter((r) => r.link).map((r) => `${r.email},${r.link}`);
    const blob = new Blob(["email,link\n" + rows.join("\n") + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invite-links-election-${electionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasLinks = (results ?? []).some((r) => r.link);

  return (
    <div>
      <label htmlFor="voter-emails" className="sr-only">
        Voter email addresses
      </label>
      <textarea
        id="voter-emails"
        rows={5}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={"Paste email addresses, one per line (commas and spaces work too)"}
        disabled={busy}
      />
      <p className="hint">
        {counts ? `${counts.invited} invited, ${counts.claimed} registered so far. ` : ""}
        {parsed.valid.length > 0 && `${parsed.valid.length} ready to send. `}
        {parsed.duplicates > 0 && `${parsed.duplicates} repeated ${parsed.duplicates === 1 ? "email" : "emails"} ignored. `}
        Each person gets a personal link. They need no wallet or coins.
        {locked && " Voting has started, so you can only re-send links to people already invited."}
      </p>
      {parsed.invalid.length > 0 && (
        <div className="status-banner error" role="status">
          {parsed.invalid.length} {parsed.invalid.length === 1 ? "entry isn't" : "entries aren't"} a valid email and will be skipped:{" "}
          <span className="mono">
            {parsed.invalid.slice(0, 3).join(", ")}
            {parsed.invalid.length > 3 ? ", ..." : ""}
          </span>
        </div>
      )}
      {tooMany && (
        <div className="status-banner error" role="status">
          Send at most {MAX_INVITES_PER_REQUEST} invitations at a time.
        </div>
      )}
      {status && (
        <div className={`status-banner ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
          {status.text}
        </div>
      )}
      <button className="primary" onClick={send} disabled={!canSend}>
        {busy ? "Working..." : locked ? "Re-send invitations" : parsed.valid.length > 0 ? `Send ${parsed.valid.length} ${parsed.valid.length === 1 ? "invitation" : "invitations"}` : "Send invitations"}
      </button>

      {results && results.length > 0 && (
        <>
          <ul className="invite-results">
            {results.map((r) => (
              <li key={r.email}>
                <span className="mono">{r.email}</span>
                {r.link ? (
                  <button type="button" onClick={() => navigator.clipboard?.writeText(r.link!)}>
                    Copy link
                  </button>
                ) : (
                  <span>{LABELS[r.status]}</span>
                )}
              </li>
            ))}
          </ul>
          {hasLinks && (
            <div className="row-actions">
              <button onClick={downloadLinks}>Download links (CSV)</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getReadProvider, getVoterRegistryAt } from "@/lib/contracts";
import { api } from "@/lib/api";
import { useAutoDismiss } from "@/lib/useAutoDismiss";
import { MAX_INVITES_PER_REQUEST, parseEmailList } from "@/lib/invite";

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

/** Invite voters by email. Each person gets a personal link; they need no wallet. The site records the invites on the blockchain and emails the links. Safe to repeat: re-sending the same email re-sends the same
 *  link. */
export default function InvitePanel({ registryAddress, electionId, state, onChanged, prefill }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  useAutoDismiss(status, () => setStatus(null));
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

  async function send() {
    setBusy(true);
    setStatus(null);
    try {
      const emails = parsed.valid;
      setStatus({ kind: "info", text: state === 0 ? "Recording invitations and sending emails. This can take a minute..." : "Sending emails..." });
      const sent = await api<{ delivery: string; results: Result[] }>("/api/org/invite", { electionId, emails });
      const list = sent.results as Result[];
      const ok = list.filter((r) => r.status === "sent").length;
      setStatus({
        kind: ok === list.length ? "success" : "error",
        text:
          sent.delivery === "links"
            ? ok === 1 ? "Invitation Sent" : "Invitations Sent"
            : `${ok} of ${list.length} invitation${list.length === 1 ? "" : "s"} sent.`,
      });
      if (ok === list.length) setRaw("");
      await refreshCounts();
      await onChanged();
    } catch (err: any) {
      setStatus({ kind: "error", text: err?.message || "Could not send the invitations." });
    } finally {
      setBusy(false);
    }
  }

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
        {busy ? "Sending..." : locked ? "Re-send invitations" : parsed.valid.length > 0 ? `Send ${parsed.valid.length} ${parsed.valid.length === 1 ? "invitation" : "invitations"}` : "Send invitations"}
      </button>

    </div>
  );
}

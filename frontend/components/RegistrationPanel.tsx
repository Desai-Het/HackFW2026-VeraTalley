"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShareQrCode from "@/components/ShareQrCode";
import { describeError } from "@/lib/contracts";
import {
  DEFAULT_CONFIG,
  FLAG_TEXT,
  MAX_FIELDS,
  loginMessage,
  registrationPath,
  type RegConfig,
  type RegRecord,
} from "@/lib/registration";
import { getWalletSigner } from "@/lib/useWallet";

type Props = {
  electionId: number;
  /** 0 = Draft, 1 = Open, 2 = Closed */
  state: number;
  /** Puts these emails into the invite box below, ready to send. */
  onLoadApproved: (emails: string[]) => void;
};

type Status = { kind: "error" | "success" | "info"; text: string } | null;
type Session = { token: string; expiresAt: number };

const STATUS_RANK: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };

function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; // stop spreadsheets running a cell as a formula
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Collect sign-ups through a QR code, check them, and move the good ones into the voter list.
 *  Registrations are kept on the server, so the organiser signs in once (a free signature, no gas)
 *  to see them. */
export default function RegistrationPanel({ electionId, state, onLoadApproved }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<RegConfig>(DEFAULT_CONFIG);
  const [domainsText, setDomainsText] = useState("");
  const [records, setRecords] = useState<RegRecord[]>([]);
  const [linkKey, setLinkKey] = useState("");
  const [confirmNewLink, setConfirmNewLink] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [onLocalhost, setOnLocalhost] = useState(false);
  const dirty = useRef(false);
  const locked = state !== 0;

  useEffect(() => {
    setOnLocalhost(/^(localhost|127\.|\[::1\])/.test(window.location.hostname));
  }, []);

  const apply = useCallback((data: { config: RegConfig; registrations: RegRecord[]; linkKey?: string }, keepForm = false) => {
    setRecords(data.registrations);
    if (data.linkKey) setLinkKey(data.linkKey);
    setSelected((prev) => new Set([...prev].filter((id) => data.registrations.some((r) => r.id === id))));
    if (!keepForm || !dirty.current) {
      setConfig(data.config);
      setDomainsText(data.config.allowedDomains.join(", "));
      dirty.current = false;
    }
  }, []);

  const call = useCallback(
    async (body: Record<string, unknown>, token = session?.token) => {
      const res = await fetch("/api/registration/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electionId, token, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        if (res.status === 401) setSession(null);
        throw new Error(data?.error || "Something went wrong. Please try again.");
      }
      return data;
    },
    [electionId, session?.token]
  );

  // While signed in, keep the list fresh as people register (every 8 seconds, only if the tab is visible).
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible" || busy) return;
      call({ action: "list" })
        .then((d) => apply(d, true))
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(t);
  }, [session, busy, call, apply]);

  async function signIn() {
    setBusy(true);
    setStatus(null);
    try {
      const signer = await getWalletSigner();
      const issuedAt = Date.now();
      setStatus({ kind: "info", text: "Approve the sign-in request in your wallet. It is free and sends nothing." });
      const signature = await signer.signMessage(loginMessage(electionId, issuedAt, window.location.host.toLowerCase()));
      const res = await fetch("/api/registration/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electionId, issuedAt, signature }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "Could not sign in.");
      setSession({ token: data.token, expiresAt: data.expiresAt });
      apply(await call({ action: "list" }, data.token));
      setStatus(null);
    } catch (err: any) {
      setStatus({ kind: "error", text: err?.message && !/ethers|execution reverted/i.test(err.message) ? err.message : describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function run(body: Record<string, unknown>, okText?: string) {
    setBusy(true);
    setStatus(null);
    try {
      apply(await call(body));
      if (body.action === "decide") setSelected(new Set()); // a decision is done: start the next selection fresh
      if (okText) setStatus({ kind: "success", text: okText });
    } catch (err: any) {
      setStatus({ kind: "error", text: err?.message || "Something went wrong." });
      call({ action: "list" }).then((d) => apply(d), () => undefined); // show what is really saved
    } finally {
      setBusy(false);
    }
  }

  const sorted = useMemo(
    () =>
      [...records].sort(
        (a, b) =>
          (a.flags.length > 0 && a.status === "pending" ? -1 : 0) - (b.flags.length > 0 && b.status === "pending" ? -1 : 0) ||
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          a.createdAt - b.createdAt
      ),
    [records]
  );
  const counts = useMemo(() => {
    const c = { total: records.length, approved: 0, pending: 0, rejected: 0, invited: 0, ready: 0 };
    for (const r of records) {
      c[r.status] += 1;
      if (r.invited) c.invited += 1;
      else if (r.status === "approved") c.ready += 1;
    }
    return c;
  }, [records]);
  const cleanPending = records.filter((r) => r.status === "pending" && r.flags.length === 0 && !r.invited);

  function setField(i: number, patch: Partial<{ label: string; required: boolean }>) {
    dirty.current = true;
    setConfig((c) => ({ ...c, fields: c.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  }
  function edit(patch: Partial<RegConfig>) {
    dirty.current = true;
    setConfig((c) => ({ ...c, ...patch }));
  }

  function saveSettings(open?: boolean) {
    const next = { ...config, open: open ?? config.open, allowedDomains: domainsText.split(/[\s,;]+/).filter(Boolean) };
    return run(
      { action: "config", config: next },
      open === true ? "Registration is open. Share the QR code." : open === false ? "Registration is closed." : "Settings saved."
    );
  }

  function toggleSelected(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function exportCsv() {
    const keys = config.fields.map((f) => f.key);
    const head = ["Name", "Email", ...config.fields.map((f) => f.label), "Registered", "Status", "Invited", "Notes"];
    const rows = records.map((r) =>
      [
        r.name,
        r.email,
        ...keys.map((k) => r.extra[k] ?? ""),
        new Date(r.createdAt).toISOString(),
        r.status,
        r.invited ? "yes" : "no",
        r.flags.map((f) => FLAG_TEXT[f] ?? f).join(" "),
      ]
        .map(csvCell)
        .join(",")
    );
    const blob = new Blob([[head.map(csvCell).join(","), ...rows].join("\n") + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registrations-election-${electionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!session) {
    return (
      <div>
        <p className="hint">
          Let people sign up themselves: you get a QR code that opens a short form (name, email and any questions you add). Their details
          are collected here for you to check, and the good ones go into your voter list in one click.
        </p>
        {status && (
          <div className={`status-banner ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
            {status.text}
          </div>
        )}
        <button onClick={signIn} disabled={busy}>
          {busy ? "Working..." : "Sign in to manage registrations"}
        </button>
        <p className="hint">One free signature from your admin wallet. It lasts 30 minutes.</p>
      </div>
    );
  }

  return (
    <div>
      {status && (
        <div className={`status-banner ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
          {status.text}
        </div>
      )}

      {!locked && (
        <>
          <label className="reg-switch">
            <input type="checkbox" checked={config.open} disabled={busy} onChange={(e) => {
                const open = e.target.checked;
                setConfig((c) => ({ ...c, open }));
                saveSettings(open);
              }}
            />
            <span>
              <strong>{config.open ? "Registration is open" : "Registration is closed"}</strong>
              {" "}(it closes by itself when you open voting)
            </span>
          </label>

          {config.open && (
            <div className="reg-qr">
              <ShareQrCode
                path={registrationPath(electionId, linkKey)}
                shareTitle="Register to vote"
                alt="QR code that opens the registration form"
              />
              <div>
                <p className="hint">
                  Show this QR code on a screen or print it. Only people who scan it (or get its link) can register, once each.
                  Share the link only with the people you want to register.
                </p>
                <div className="row-actions">
                  <a className="btn" href={`/elections/${electionId}/live#${linkKey}`} target="_blank" rel="noreferrer">
                    Open the big screen with this QR
                  </a>
                  {!confirmNewLink ? (
                    <button type="button" onClick={() => setConfirmNewLink(true)} disabled={busy}>
                      New QR code
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={async () => {
                          setConfirmNewLink(false);
                          await run({ action: "new-link" }, "New QR code made. The old one no longer works.");
                        }}
                      >
                        Yes, replace it
                      </button>
                      <button type="button" onClick={() => setConfirmNewLink(false)}>
                        Cancel
                      </button>
                    </>
                  )}
                </div>
                {onLocalhost && (
                  <div className="status-banner error" role="status">
                    You are on <span className="mono">localhost</span>, which phones cannot open. Open the app on your real web address before
                    sharing this code.
                  </div>
                )}
              </div>
            </div>
          )}

          <details className="reg-settings">
            <summary>Form settings</summary>
            <div className="field">
              <label htmlFor="reg-intro">Message above the form (optional)</label>
              <input id="reg-intro" type="text" maxLength={300} value={config.intro} onChange={(e) => edit({ intro: e.target.value })} />
            </div>
            <div className="field">
              <span className="field-label">Extra questions (name and email are always asked)</span>
              {config.fields.map((f, i) => (
                <div className="reg-config-row" key={f.key + i}>
                  <input
                    type="text"
                    aria-label={`Question ${i + 1}`}
                    value={f.label}
                    maxLength={60}
                    placeholder="For example: Student ID"
                    onChange={(e) => setField(i, { label: e.target.value })}
                  />
                  <label>
                    <input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      dirty.current = true;
                      setConfig((c) => ({ ...c, fields: c.fields.filter((_, j) => j !== i) }));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {config.fields.length < MAX_FIELDS && (
                <button
                  type="button"
                  onClick={() => {
                    dirty.current = true;
                    setConfig((c) => ({ ...c, fields: [...c.fields, { key: `q${Date.now()}`, label: "", required: false }] }));
                  }}
                >
                  Add a question
                </button>
              )}
            </div>
            <div className="field">
              <label htmlFor="reg-domains">Only allow these email domains (optional)</label>
              <input
                id="reg-domains"
                type="text"
                placeholder="school.edu, club.org"
                value={domainsText}
                onChange={(e) => {
                  dirty.current = true;
                  setDomainsText(e.target.value);
                }}
              />
              <p className="hint">Leave empty to accept any email. A domain list is the strongest way to stop outsiders.</p>
            </div>
            <label className="reg-switch">
              <input type="checkbox" checked={config.autoApprove} onChange={(e) => edit({ autoApprove: e.target.checked })} />
              <span>Approve people automatically, and hold back only the ones that look suspicious</span>
            </label>
            <button onClick={() => saveSettings()} disabled={busy}>
              Save settings
            </button>
          </details>
        </>
      )}

      <div className="reg-summary" aria-label="Registration totals">
        <span>{counts.total} registered</span>
        <span>{counts.ready} ready to invite</span>
        <span>{counts.pending} need a look</span>
        <span>{counts.invited} invited</span>
        {counts.rejected > 0 && <span>{counts.rejected} rejected</span>}
      </div>

      {!locked && counts.ready > 0 && (
        <div className="row-actions">
          <button
            className="primary"
            onClick={() => {
              onLoadApproved(records.filter((r) => r.status === "approved" && !r.invited).map((r) => r.email));
              setStatus({ kind: "success", text: `${counts.ready} email${counts.ready === 1 ? "" : "s"} added to the invitation box below. Press the send button there.` });
            }}
          >
            Put {counts.ready} approved {counts.ready === 1 ? "email" : "emails"} in the invite box
          </button>
        </div>
      )}

      {records.length > 0 && (
        <>
          {!locked && (
            <div className="reg-toolbar">
              {cleanPending.length > 0 && (
                <button onClick={() => run({ action: "decide", decision: "approved", ids: cleanPending.map((r) => r.id) })} disabled={busy}>
                  Approve all {cleanPending.length} without warnings
                </button>
              )}
              <button onClick={() => run({ action: "decide", decision: "approved", ids: [...selected] })} disabled={busy || selected.size === 0}>
                Approve selected
              </button>
              <button onClick={() => run({ action: "decide", decision: "rejected", ids: [...selected] })} disabled={busy || selected.size === 0}>
                Reject selected
              </button>
            </div>
          )}
          <ul className="reg-list">
            {sorted.map((r) => (
              <li key={r.id} className={`reg-item${r.flags.length > 0 && r.status === "pending" ? " flagged" : ""}`}>
                <div className="reg-item-head">
                  {!locked && !r.invited && (
                    <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} />
                  )}
                  <span className="reg-name">{r.name}</span>
                  <span className="mono">{r.email}</span>
                  <span className={`reg-pill ${r.invited ? "approved" : r.status}`}>{r.invited ? "invited" : r.status === "pending" ? "needs a look" : r.status}</span>
                </div>
                {Object.entries(r.extra).map(([k, v]) => (
                  <div className="reg-extra" key={k}>
                    {config.fields.find((f) => f.key === k)?.label ?? k}: {v}
                  </div>
                ))}
                {r.flags.map((f) => (
                  <div className="reg-flag" key={f}>
                    Warning: {FLAG_TEXT[f] ?? f}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <button onClick={exportCsv}>Download list (CSV)</button>
            {!confirmPurge ? (
              <button onClick={() => setConfirmPurge(true)} disabled={busy}>
                Delete all registration data
              </button>
            ) : (
              <>
                <button
                  className="primary"
                  onClick={async () => {
                    setConfirmPurge(false);
                    await run({ action: "purge", confirm: true }, "All registration data was deleted from the server.");
                  }}
                  disabled={busy}
                >
                  Yes, delete everything
                </button>
                <button onClick={() => setConfirmPurge(false)}>Cancel</button>
              </>
            )}
          </div>
          <p className="hint">Wallet-free voters stay private only if you delete this list once the event is over.</p>
        </>
      )}
    </div>
  );
}

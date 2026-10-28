"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShareQrCode from "@/components/ShareQrCode";
import { api } from "@/lib/api";
import {
  DEFAULT_CONFIG,
  FLAG_TEXT,
  MAX_FIELDS,
  registrationPath,
  type RegConfig,
  type RegRecord,
} from "@/lib/registration";

type Props = {
  electionId: number;
  /** 0 = Draft, 1 = Open, 2 = Closed */
  state: number;
  /** Puts these emails into the invite box below, ready to send. */
  onLoadApproved: (emails: string[]) => void;
};

type Status = { kind: "error" | "success" | "info"; text: string; inline?: boolean } | null;

const STATUS_RANK: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };

function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; // stop spreadsheets running a cell as a formula
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Collect sign-ups through a QR code, check them, and move the good ones into the voter list.
 *  Registrations are kept on the server, so the organiser signs in once (a free signature, no gas)
 *  to see them. */
export default function RegistrationPanel({ electionId, state, onLoadApproved }: Props) {
  const [session, setSession] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<RegConfig>(DEFAULT_CONFIG);
  const [domainsText, setDomainsText] = useState("");
  const [records, setRecords] = useState<RegRecord[]>([]);
  const [linkKey, setLinkKey] = useState("");
  const [confirmNewLink, setConfirmNewLink] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [loadedEmails, setLoadedEmails] = useState<Set<string>>(new Set()); // already put in the invite box
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
    async (body: Record<string, unknown>) => {
      try {
        return await api<any>("/api/registration/admin", { electionId, ...body });
      } catch (err: any) {
        if (err?.status === 401) setSession(false);
        throw err;
      }
    },
    [electionId]
  );

  // Load the registrations as soon as the panel appears (the organiser is already signed in).
  useEffect(() => {
    let cancelled = false;
    call({ action: "list" }).then(
      (d) => {
        if (cancelled) return;
        apply(d);
        setSession(true);
      },
      (err) => !cancelled && setLoadError(err?.message || "Could not load registrations.")
    );
    return () => {
      cancelled = true;
    };
  }, [call, apply]);

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

  async function run(body: Record<string, unknown>, okText?: string, inline?: boolean) {
    setBusy(true);
    setStatus(null);
    try {
      apply(await call(body));
      if (body.action === "decide") setSelected(new Set()); // a decision is done: start the next selection fresh
      if (okText) setStatus({ kind: "success", text: okText, inline });
    } catch (err: any) {
      setStatus({ kind: "error", text: err?.message || "Something went wrong.", inline });
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
  const toLoad = records.filter((r) => r.status === "approved" && !r.invited && !loadedEmails.has(r.email)).map((r) => r.email);
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
      open === true ? "Registration is open. Share the QR code." : open === false ? "Registration is closed." : "Settings saved.",
      open === undefined
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
        {loadError ? (
          <div className="status-banner error" role="status">
            {loadError} <a href="/login">Sign in again</a>
          </div>
        ) : (
          <p className="hint">Loading...</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {status && !status.inline && (
        <div className={`status-banner ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
          {status.text}
        </div>
      )}

      {!locked && (
        <>
          <details className="reg-settings">
            <summary>Form Settings (Optional)</summary>
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
            {status?.inline && (
              <div className={`status-banner reg-inline-status ${status.kind === "error" ? "error" : status.kind === "success" ? "success" : ""}`} role="status">
                <span>{status.text}</span>
                <button type="button" className="reg-dismiss" aria-label="Dismiss message" onClick={() => setStatus(null)}>
                  ×
                </button>
              </div>
            )}
          </details>

          <div className="reg-toggle-row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                const open = !config.open;
                setConfig((c) => ({ ...c, open }));
                saveSettings(open);
              }}
            >
              {config.open ? "Close Registration" : "Open Registration"}
            </button>
            <span
              className="reg-help"
              role="img"
              tabIndex={0}
              aria-label="Registration is closed (it closes by itself when you open voting)"
            >
              ?
              <span className="reg-help-tip" aria-hidden="true">
                Registration is closed (it closes by itself when you open voting)
              </span>
            </span>
          </div>
          <p className="hint">{config.open ? "Registration is currently open" : "Registration is not open yet!"}</p>

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
                    Open Live Count
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
        </>
      )}

      <div className="reg-summary" aria-label="Registration totals">
        <span>{counts.total} registered</span>
        <span>{counts.ready} ready to invite</span>
        <span>{counts.pending} need a look</span>
        <span>{counts.invited} invited</span>
        {counts.rejected > 0 && <span>{counts.rejected} rejected</span>}
      </div>

      {!locked && toLoad.length > 0 && (
        <div className="row-actions">
          <button
            className="primary"
            onClick={() => {
              onLoadApproved(records.filter((r) => r.status === "approved" && !r.invited).map((r) => r.email));
              setLoadedEmails(new Set(records.filter((r) => r.status === "approved" && !r.invited).map((r) => r.email)));
              setStatus({ kind: "success", text: `${counts.ready} email${counts.ready === 1 ? "" : "s"} added to the invitation box below. Press the send button there.` });
            }}
          >
            Put {toLoad.length} approved {toLoad.length === 1 ? "email" : "emails"} in the invite box
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

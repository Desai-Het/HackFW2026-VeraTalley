"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { registrationProblem, type RegField } from "@/lib/registration";

type Info =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "closed"; title: string; reason: string | null }
  | { kind: "open"; title: string; intro: string; fields: RegField[]; domains: string[] };

/** The page the QR code opens. Someone gives their name and email to take part in one election.
 *  They need no wallet and no account. A voting link arrives later, by email. */
export default function RegisterPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const [info, setInfo] = useState<Info>({ kind: "loading" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // hidden trap field: people leave it empty, scripts fill it
  const [key, setKey] = useState<string | null>(null); // the secret from the QR code's address
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const read = () => setKey(decodeURIComponent(window.location.hash.replace(/^#/, "")).trim());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!/^\d{1,9}$/.test(id)) {
      setInfo({ kind: "error", text: "This registration link is not valid." });
      return;
    }
    let cancelled = false;
    fetch(`/api/registration/info?e=${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d?.ok) setInfo({ kind: "error", text: d?.error || "This registration link is not valid." });
        else if (!d.open) setInfo({ kind: "closed", title: d.title, reason: d.reason });
        else setInfo({ kind: "open", title: d.title, intro: d.intro, fields: d.fields, domains: d.allowedDomains });
      })
      .catch(() => !cancelled && setInfo({ kind: "error", text: "Can't reach the server right now. Please try again in a moment." }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const problem = registrationProblem(name.replace(/\s+/g, " ").trim(), email.trim().toLowerCase());
    if (problem) {
      setError(problem);
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/registration/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electionId: Number(id), key, name, email, extra, consent, website }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (info.kind === "loading") {
    return (
      <main>
        <p className="hint">Loading...</p>
      </main>
    );
  }
  if (info.kind === "error") {
    return (
      <main>
        <div className="status-banner error" role="status">
          {info.text}
        </div>
      </main>
    );
  }
  if (info.kind === "closed") {
    return (
      <main>
        <h1>{info.title}</h1>
        <div className="status-banner" role="status">
          {info.reason === "voting-started"
            ? "Registration is closed because voting has already started."
            : "Registration is not open right now. Please ask the organiser."}
        </div>
      </main>
    );
  }

  if (key === "") {
    return (
      <main>
        <h1>{info.title}</h1>
        <div className="status-banner error" role="status">
          This link is incomplete. Please scan the QR code again, or ask the organiser for the full link.
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main>
        <h1>{info.title}</h1>
        <div className="status-banner success" role="status">
          You&apos;re registered. Watch your inbox: your personal voting link will be emailed to you before voting opens.
        </div>
        <p className="hint">Check your spam folder if you do not see it. You do not need a crypto wallet or any coins to vote.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Register to vote</h1>
      <p className="lede">{info.title}</p>
      {info.intro && <p>{info.intro}</p>}

      <form onSubmit={submit} className="card register-form" noValidate>
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="reg-name">Full name</label>
          <input id="reg-name" type="text" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="reg-email">Email address</label>
          <input
            id="reg-email"
            type="text"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <p className="hint">
            Your voting link is sent here, so use an address only you can open.
            {info.domains.length > 0 && ` Allowed: ${info.domains.map((d) => "@" + d).join(", ")}.`}
          </p>
        </div>
        {info.fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`reg-${f.key}`}>
              {f.label}
              {!f.required && <span className="optional"> (optional)</span>}
            </label>
            <input
              id={`reg-${f.key}`}
              type="text"
              maxLength={200}
              value={extra[f.key] ?? ""}
              onChange={(e) => setExtra((p) => ({ ...p, [f.key]: e.target.value }))}
              disabled={busy}
            />
          </div>
        ))}

        {/* Trap for scripts: invisible to people and to screen readers. */}
        <div className="reg-trap" aria-hidden="true">
          <label htmlFor="reg-website">Website</label>
          <input id="reg-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
          <span>I agree that the organiser may store my name and email to run this election and send me my voting link.</span>
        </label>

        {error && (
          <div className="status-banner error" role="status">
            {error}
          </div>
        )}
        <button type="submit" className="primary btn-lg" disabled={busy}>
          {busy ? "Registering..." : "Register"}
        </button>
        <p className="hint" style={{ marginTop: 12 }}>
          One registration per person. Registering does not cast a vote.
        </p>
      </form>
    </main>
  );
}

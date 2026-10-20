"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

/** Only paths on this site are accepted as "where to go next", so a crafted link cannot send a
 *  freshly signed-in person to another website. */
function safeNext(raw: string | null): string {
  return raw && /^\/[A-Za-z0-9/_\-?=&.%]*$/.test(raw) && !raw.startsWith("//") ? raw : "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const { user, configured, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, []);

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { username, password });
      window.dispatchEvent(new Event("vt-auth"));
      router.replace(next);
    } catch (err: any) {
      setError(err?.message || "Could not sign in.");
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="page-title-row">
        <h1>Organiser sign in</h1>
        <p className="lede">
          Sign in to create and run elections. Voters never need to sign in: they use the link or QR code you share.
        </p>
      </div>
      {!loading && !configured && (
        <div className="status-banner error" role="status">
          Sign-in is not set up on this server yet. The site owner needs to set OWNER_USERNAME and OWNER_PASSWORD.
        </div>
      )}
      {error && (
        <div className="status-banner error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="card" style={{ maxWidth: 440 }}>
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="username">Username</label>
          <input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <button type="submit" className="primary btn-lg" disabled={busy || !username || !password}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
          <p className="hint" style={{ marginTop: 12 }}>
            Need an account? Ask the {APP_NAME} site owner to create one for you.
          </p>
        </div>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

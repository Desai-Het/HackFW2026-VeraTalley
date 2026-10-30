"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useAutoDismiss } from "@/lib/useAutoDismiss";

type UserRow = { username: string; disabled: boolean; createdAt: number; lastLogin?: number; elections: number };
type Wallet = { address: string; balance: number; low: boolean };

function randomPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Site owner only: create organiser accounts, reset passwords, switch accounts off, and keep an
 *  eye on the server wallet that pays for everything. */
export default function AccountsPage() {
  const { user, loading } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(() => randomPassword());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  useAutoDismiss(msg, () => setMsg(null));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [reset, setReset] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) window.location.replace("/login?next=/accounts");
  }, [loading, user]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const data = await api<{ users: UserRow[] }>("/api/accounts", body);
    setUsers(data.users);
  }, []);

  useEffect(() => {
    if (user?.role !== "owner") return;
    call({ action: "list" }).catch((e) => setMsg({ kind: "error", text: e.message }));
    api<Wallet & { ok: true }>("/api/org/wallet").then(setWallet).catch(() => undefined);
  }, [user, call]);

  async function run(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await call(body);
      setMsg({ kind: "success", text: okText });
      return true;
    } catch (err: any) {
      setMsg({ kind: "error", text: err?.message || "Something went wrong." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <main><h1>Loading...</h1></main>;
  if (user.role !== "owner") {
    return (
      <main>
        <h1>Accounts</h1>
        <div className="status-banner error" role="status">Only the site owner can manage accounts.</div>
      </main>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const made = { username: username.trim().toLowerCase(), password };
    if (await run({ action: "create", ...made }, `Account "${made.username}" created. Give them this password now; it cannot be shown again: ${made.password}`)) {
      setUsername("");
      setPassword(randomPassword());
    }
  }

  return (
    <main className="page-wide">
      <div className="page-title-row">
        <h1>Accounts</h1>
        <p>Create sign-ins for the people who run elections. Only you can do this.</p>
      </div>

      {wallet && (
        <div className={`status-banner ${wallet.low ? "error" : ""}`} role="status">
          Server wallet <span className="mono">{wallet.address}</span> holds {wallet.balance.toFixed(3)} POL.
          {wallet.low ? " It is running low: top it up, or elections and votes will stop working." : ""}
          <br />
          Set <span className="mono">NEXT_PUBLIC_ORGANISER_WALLETS</span> to this address so the public election list shows only your elections.
        </div>
      )}
      {msg && (
        <div className={`status-banner ${msg.kind === "error" ? "error" : "success"}`} role="status" style={{ wordBreak: "break-word" }}>
          {msg.text}
        </div>
      )}
      {reset && (
        <div className="status-banner success" role="status">
          New password for <strong>{reset.username}</strong>: <span className="mono">{reset.password}</span> (shown once, give it to them privately).
        </div>
      )}

      <form onSubmit={create} className="card" style={{ maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Add an organiser</h3>
        <div className="field">
          <label htmlFor="new-user">Username</label>
          <input id="new-user" type="text" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} required />
        </div>
        <div className="field">
          <label htmlFor="new-pass">Password</label>
          <div className="candidate-input-row">
            <input id="new-pass" type="text" className="mono" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
            <button type="button" onClick={() => setPassword(randomPassword())} disabled={busy}>
              Make a new one
            </button>
          </div>
          <p className="hint">At least 10 characters. They can change it after signing in.</p>
        </div>
        <button type="submit" className="primary" disabled={busy || !username || !password}>
          {busy ? "Working..." : "Create account"}
        </button>
      </form>

      <h2 style={{ marginTop: 32 }}>Organisers</h2>
      {users.length === 0 ? (
        <p className="hint">No organiser accounts yet.</p>
      ) : (
        <ul className="reg-list">
          {users.map((u) => (
            <li key={u.username} className="reg-item">
              <div className="reg-item-head">
                <span className="reg-name">{u.username}</span>
                <span className={`reg-pill ${u.disabled ? "rejected" : "approved"}`}>{u.disabled ? "switched off" : "active"}</span>
                <span className="hint">
                  {u.elections} election{u.elections === 1 ? "" : "s"}
                  {u.lastLogin ? `, last sign-in ${new Date(u.lastLogin).toLocaleString()}` : ", never signed in"}
                </span>
              </div>
              <div className="row-actions">
                <button
                  disabled={busy}
                  onClick={async () => {
                    const pw = randomPassword();
                    if (await run({ action: "reset-password", username: u.username, password: pw }, `Password reset for "${u.username}".`)) {
                      setReset({ username: u.username, password: pw });
                    }
                  }}
                >
                  Reset password
                </button>
                <button disabled={busy} onClick={() => run({ action: u.disabled ? "enable" : "disable", username: u.username }, u.disabled ? "Account switched on." : "Account switched off. Their sign-ins ended.")}>
                  {u.disabled ? "Switch on" : "Switch off"}
                </button>
                {confirmDelete === u.username ? (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={async () => {
                        setConfirmDelete(null);
                        await run({ action: "delete", username: u.username, confirm: true }, `Account "${u.username}" deleted. Their elections stay on the blockchain and you can still manage them.`);
                      }}
                    >
                      Yes, delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </>
                ) : (
                  <button disabled={busy} onClick={() => setConfirmDelete(u.username)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

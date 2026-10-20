"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./auth";
import { api } from "./api";

/** Who is signed in on this browser. Every component using it updates together whenever someone
 *  signs in or out (they share a browser event). */
export function useAuth() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: SessionUser | null; configured: boolean }>("/api/auth/me");
      setUser(data.user);
      setConfigured(data.configured);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("vt-auth", refresh);
    return () => window.removeEventListener("vt-auth", refresh);
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", {});
    } finally {
      window.dispatchEvent(new Event("vt-auth"));
    }
  }, []);

  return { user, loading, configured, refresh, signOut };
}

/** The election numbers this account manages, or null until known / when signed out. */
export function useMyElections(): number[] | null {
  const { user } = useAuth();
  const [ids, setIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (!user) {
      setIds(null);
      return;
    }
    let cancelled = false;
    api<{ ids: number[] }>("/api/org/mine")
      .then((d) => !cancelled && setIds(d.ids))
      .catch(() => !cancelled && setIds(null));
    return () => {
      cancelled = true;
    };
  }, [user?.username]); // eslint-disable-line react-hooks/exhaustive-deps
  return ids;
}

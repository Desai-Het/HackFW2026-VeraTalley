"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import LiveResults from "@/components/LiveResults";
import ShareQrCode from "@/components/ShareQrCode";
import {
  factoryConfigured,
  getElectionBallotAt,
  getElectionFactory,
  getReadProvider,
  getVoterRegistryAt,
} from "@/lib/contracts";
import { isUnknownElectionError } from "@/lib/elections";

const POLL_INTERVAL_MS = 3000;

type Loaded =
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error" }
  | { kind: "ready"; ballot: string; registry: string };

/** A public, read-only "second screen" for one election: no wallet needed, meant to be left open
 *  on a shared display at an event while the QR code next to it brings people onto the ballot. */
export default function LiveStatsPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const configured = factoryConfigured();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [tally, setTally] = useState<bigint[]>([]);
  const [state, setState] = useState(0);
  const [pulsed, setPulsed] = useState<boolean[]>([]);
  const [registeredVoters, setRegisteredVoters] = useState<number | null>(null);
  const prevTally = useRef<bigint[]>([]);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!configured) return;
    if (!/^\d+$/.test(id) || id.length > 20) {
      setLoaded({ kind: "notfound" });
      return;
    }
    let cancelled = false;
    getElectionFactory(getReadProvider())
      .getElection(BigInt(id))
      .then((record: string[]) => {
        if (!cancelled) setLoaded({ kind: "ready", ballot: record[2], registry: record[1] });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnknownElectionError(err)) setLoaded({ kind: "notfound" });
        else {
          console.error("Failed to load election", err);
          setLoaded({ kind: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, configured]);

  const refresh = useCallback(async (ballotAddress: string, registryAddress: string) => {
    try {
      const provider = getReadProvider();
      const ballot = getElectionBallotAt(ballotAddress, provider);
      const registry = getVoterRegistryAt(registryAddress, provider);
      const [t, c, tl, s, vc] = await Promise.all([
        ballot.title(),
        ballot.getCandidates(),
        ballot.getTally(),
        ballot.state(),
        registry.voterCount(),
      ]);
      const prev = prevTally.current;
      if (prev.length === tl.length && prev.length > 0) {
        const changed = tl.map((v: bigint, i: number) => v > prev[i]);
        if (changed.some(Boolean)) {
          setPulsed(changed);
          if (pulseTimer.current) clearTimeout(pulseTimer.current);
          pulseTimer.current = setTimeout(() => setPulsed([]), 900);
        }
      }
      prevTally.current = tl;

      setTitle(t);
      setCandidates(c);
      setTally(tl);
      setState(Number(s));
      setRegisteredVoters(Number(vc));
    } catch (err) {
      console.error("Failed to load live results", err);
    }
  }, []);

  useEffect(() => {
    if (loaded.kind !== "ready") return;
    refresh(loaded.ballot, loaded.registry);
    const interval = setInterval(() => refresh(loaded.ballot, loaded.registry), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loaded, refresh]);

  useEffect(() => {
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, []);

  if (!configured) {
    return (
      <main className="live-page">
        <div className="status-banner error">
          This app isn&apos;t pointed at an election factory yet. Set NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS in
          frontend/.env.local, then restart the app.
        </div>
      </main>
    );
  }
  if (loaded.kind === "loading") {
    return (
      <main className="live-page">
        <p>Loading live results...</p>
      </main>
    );
  }
  if (loaded.kind === "notfound") {
    return (
      <main className="live-page">
        <h1>Election not found</h1>
      </main>
    );
  }
  if (loaded.kind === "error") {
    return (
      <main className="live-page">
        <div className="status-banner error" role="status">
          Can&apos;t reach the blockchain network right now. Retrying every few seconds.
        </div>
      </main>
    );
  }

  return (
    <main className="live-page">
      <div className="live-stage">
        <LiveResults
          title={title}
          candidates={candidates}
          tally={tally}
          state={state}
          pulsed={pulsed}
          registeredVoters={registeredVoters}
        />
        <div className="live-qr">
          <p className="live-qr-label">Scan to vote</p>
          <ShareQrCode path={`/elections/${id}`} shareTitle={`Vote: ${title}`} size={240} />
        </div>
      </div>
    </main>
  );
}

"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import InviteVote from "@/components/InviteVote";
import { factoryConfigured, getElectionFactory, getReadProvider } from "@/lib/contracts";
import { isUnknownElectionError } from "@/lib/elections";

type Loaded = { kind: "loading" } | { kind: "notfound" } | { kind: "error" } | { kind: "ready"; registry: string; ballot: string };

/** The page a voter lands on from the link in their invitation email. */
export default function VotePage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const configured = factoryConfigured();

  useEffect(() => {
    if (!configured) return;
    if (!/^\d+$/.test(id) || id.length > 20) {
      setLoaded({ kind: "notfound" });
      return;
    }
    let cancelled = false;
    getElectionFactory(getReadProvider())
      .getElection(BigInt(id))
      .then((r: string[]) => !cancelled && setLoaded({ kind: "ready", registry: r[1], ballot: r[2] }))
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded(isUnknownElectionError(err) ? { kind: "notfound" } : { kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, configured]);

  if (!configured) {
    return (
      <main>
        <h1>Vote</h1>
        <ConfigNotice />
      </main>
    );
  }
  if (loaded.kind === "loading") {
    return (
      <main>
        <h1>Loading...</h1>
      </main>
    );
  }
  if (loaded.kind === "notfound") {
    return (
      <main>
        <h1>Election not found</h1>
        <p>This voting link does not match an election. Check that you copied the whole link from your email.</p>
      </main>
    );
  }
  if (loaded.kind === "error") {
    return (
      <main>
        <h1>Vote</h1>
        <div className="status-banner error" role="status">
          Can&apos;t reach the blockchain network right now. Reload the page to try again.
        </div>
      </main>
    );
  }
  return <InviteVote registryAddress={loaded.registry} ballotAddress={loaded.ballot} electionId={Number(id)} />;
}

"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import ElectionView from "@/components/ElectionView";
import { factoryConfigured, getElectionFactory, getReadProvider } from "@/lib/contracts";
import { isUnknownElectionError } from "@/lib/elections";

type Loaded =
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error" }
  | { kind: "ready"; registry: string; ballot: string };

export default function ElectionPage() {
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
    setLoaded({ kind: "loading" });
    getElectionFactory(getReadProvider())
      .getElection(BigInt(id))
      .then((record: string[]) => {
        if (!cancelled) setLoaded({ kind: "ready", registry: record[1], ballot: record[2] });
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

  if (!configured) {
    return (
      <main>
        <h1>Election</h1>
        <ConfigNotice />
      </main>
    );
  }
  if (loaded.kind === "loading") {
    return (
      <main>
        <h1>Loading election...</h1>
      </main>
    );
  }
  if (loaded.kind === "notfound") {
    return (
      <main>
        <h1>Election not found</h1>
        <p>
          There is no election with that number. Check the link, or pick one from the elections list.
        </p>
      </main>
    );
  }
  if (loaded.kind === "error") {
    return (
      <main>
        <h1>Election</h1>
        <div className="status-banner error" role="status">
          Can&apos;t reach the blockchain network right now. Reload the page to try again.
        </div>
      </main>
    );
  }
  return <ElectionView registryAddress={loaded.registry} ballotAddress={loaded.ballot} electionId={id} />;
}

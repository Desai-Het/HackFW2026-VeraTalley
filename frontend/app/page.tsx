"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import StateBadge from "@/components/StateBadge";
import { factoryConfigured, getElectionFactory, getReadProvider } from "@/lib/contracts";
import { fetchElectionSummary, shortAddress, type ElectionSummary } from "@/lib/elections";

const LATEST_COUNT = 3;

const STEPS = [
  {
    title: "Create",
    text: "Name your election, list the candidates, and add the wallets that are allowed to vote.",
  },
  {
    title: "Vote",
    text: "Each registered voter picks a candidate once. The vote is recorded on the blockchain.",
  },
  {
    title: "Verify",
    text: "Anyone can recount the votes from the chain and check the total. No account needed.",
  },
];

export default function Landing() {
  const configured = factoryConfigured();
  const [items, setItems] = useState<ElectionSummary[]>([]);
  const [loaded, setLoaded] = useState(!configured);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    (async () => {
      try {
        const count = Number(await getElectionFactory(getReadProvider()).electionCount());
        const ids: number[] = [];
        for (let i = count - 1; i >= Math.max(0, count - LATEST_COUNT); i--) ids.push(i);
        const rows = await Promise.all(ids.map((id) => fetchElectionSummary(id)));
        if (!cancelled) setItems(rows);
      } catch (err) {
        console.error("Failed to load elections", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  return (
    <main className="page-wide">
      <section className="hero">
        <div>
          <h1>Vote, then check the result yourself.</h1>
          <p className="lede">
            VeraTally runs elections on a public blockchain. Every vote is recorded openly, nobody can change the count
            afterwards, and anyone can recount it.
          </p>
          <div className="hero-actions">
            <Link href="/elections/create" className="btn primary btn-lg">
              Create an election
            </Link>
            <Link href="/elections" className="btn btn-lg">
              Browse elections
            </Link>
          </div>
        </div>

        <div aria-hidden="true">
          <div className="sample-ballot">
            <div className="sample-ballot-top">
              <span className="sample-ballot-title">Club president</span>
              <span className="badge badge-closed">Closed</span>
            </div>
            <div className="sample-row">
              <div className="sample-row-labels">
                <span>Ada</span>
                <span>18</span>
              </div>
              <div className="sample-track">
                <div className="sample-fill" style={{ width: "62%" }} />
              </div>
            </div>
            <div className="sample-row">
              <div className="sample-row-labels">
                <span>Grace</span>
                <span>9</span>
              </div>
              <div className="sample-track">
                <div className="sample-fill dim" style={{ width: "31%" }} />
              </div>
            </div>
            <div className="sample-row">
              <div className="sample-row-labels">
                <span>Linus</span>
                <span>2</span>
              </div>
              <div className="sample-track">
                <div className="sample-fill dim" style={{ width: "7%" }} />
              </div>
            </div>
            <p className="sample-check">Recount matches the contract: 29 of 29 votes</p>
          </div>
          <p className="sample-note">Sample ballot, for illustration</p>
        </div>
      </section>

      <section className="section" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step">
              <span className="step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {!configured && (
        <section className="section">
          <ConfigNotice />
        </section>
      )}

      {configured && loaded && items.length > 0 && (
        <section className="section" aria-labelledby="latest">
          <h2 id="latest">Latest elections</h2>
          <ul className="election-grid">
            {items.map((e) => (
              <li key={e.id}>
                <Link href={`/elections/${e.id}`} className="election-card">
                  <span className="election-card-title">{e.title}</span>
                  <span className="election-card-meta">
                    <span>
                      {e.candidateCount} candidates, by <span className="mono">{shortAddress(e.creator)}</span>
                    </span>
                    <StateBadge state={e.state} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <aside className="honest-note">
        <h3>Good to know</h3>
        <p>
          Votes are public: anyone can see which wallet voted for whom. That makes VeraTally a good fit for open votes
          among groups that want a result nobody can quietly change, and a poor fit for secret ballots.
        </p>
      </aside>
    </main>
  );
}

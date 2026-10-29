"use client";

import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import { useEffect, useState } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import StateBadge from "@/components/StateBadge";
import HeroLedger from "@/components/HeroLedgerLazy";
import { factoryConfigured } from "@/lib/contracts";
import { fetchVisibleElections, shortAddress, type ElectionSummary } from "@/lib/elections";
import { useMyElections } from "@/lib/useAuth";

const LATEST_COUNT = 3;
const LATEST_SCAN = 50; // newest elections looked through to find this account's own

const STEPS = [
  {
    title: "Create",
    text: "Sign in, name your election and list the candidates. Add voters by email, or share a QR code so they can register themselves.",
  },
  {
    title: "Vote",
    text: "Each voter opens their personal link, picks a candidate once, and the vote is recorded on the blockchain. No wallet needed.",
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
  const myIds = useMyElections(); // null while signed out or not yet known

  useEffect(() => {
    if (!configured || !myIds) return;
    let cancelled = false;
    (async () => {
      try {
        // Only the elections this signed-in account created are shown.
        const { items: rows } = await fetchVisibleElections(LATEST_SCAN);
        if (!cancelled) setItems(rows.filter((e) => myIds.includes(e.id)).slice(0, LATEST_COUNT));
      } catch (err) {
        console.error("Failed to load elections", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, myIds]);

  return (
    <main className="page-wide">
      <section className="hero">
        <div>
          <h1>Vote, then check the result yourself.</h1>
          <p className="lede">
            {APP_NAME} runs elections on a public blockchain. Every vote is recorded openly, nobody can change the count
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

        <div className="hero-visual" aria-hidden="true">
          <HeroLedger />
          <div className="sample-ballot" data-tilt="8">
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
        </div>
      </section>

      <section className="section" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step" data-tilt="7">
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
                <Link href={`/elections/${e.id}`} className="election-card" data-tilt="6">
                  <span className="election-card-head">
                    <span className="election-card-title">{e.title}</span>
                    <StateBadge state={e.state} />
                  </span>
                  <span className="election-card-meta">
                    <span>
                      {e.candidateCount} candidates, by <span className="mono">{shortAddress(e.creator)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

"use client";

import TallyScene from "@/components/TallySceneLazy";
import { leaders } from "@/lib/verify";

type Props = {
  title: string;
  candidates: string[];
  tally: bigint[];
  /** 0 = Draft, 1 = Open, 2 = Closed */
  state: number;
  /** Which candidate rows just received a new vote since the last poll - true triggers a brief
   *  highlight so a flow of votes is visible at a glance, not just a number changing. */
  pulsed: boolean[];
  /** Everyone approved to vote (invited, plus wallets added directly), so the page can show how many haven't voted yet.
   *  Null while that's still loading. */
  registeredVoters: number | null;
};

const STATE_COPY = ["Not open yet", "Live now", "Voting is closed"];

/** A big, screen-friendly view of one election's standing: meant to be left open on a shared
 *  display, not read up close like the voter-facing ballot. */
export default function LiveResults({ title, candidates, tally, state, pulsed, registeredVoters }: Props) {
  const totals = tally.map((v) => Number(v ?? 0n));
  const total = totals.reduce((sum, v) => sum + v, 0);
  const winners = state === 2 ? leaders(tally) : [];
  const remaining = registeredVoters !== null ? Math.max(registeredVoters - total, 0) : null;

  return (
    <section className="live-results" aria-label="Live election results">
      <p className="live-status">
        {state === 1 && <span className="live-pulse-dot" aria-hidden="true" />}
        {STATE_COPY[state] ?? STATE_COPY[0]}
      </p>
      <h1 className="live-title">{title || "Election"}</h1>

      <TallyScene candidates={candidates} tally={totals} closed={state === 2} labelAll winners={winners} />

      {/* The same numbers as plain text, for screen readers and for browsers without 3D. */}
      <ul className="sr-only">
        {candidates.map((name, id) => (
          <li key={id}>
            {name}: {totals[id] ?? 0} {(totals[id] ?? 0) === 1 ? "vote" : "votes"}
            {winners.includes(id) ? " (winner)" : ""}
          </li>
        ))}
      </ul>

      <div className="live-summary">
        <div className="live-stat">
          <span className="live-stat-number">{total}</span>
          <span className="live-stat-label">{total === 1 ? "vote" : "votes"} counted</span>
        </div>
        {remaining !== null && (
          <div className="live-stat">
            <span className="live-stat-number">{remaining}</span>
            <span className="live-stat-label">
              of {registeredVoters} approved {registeredVoters === 1 ? "voter" : "voters"} still to vote
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

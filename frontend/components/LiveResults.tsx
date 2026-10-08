"use client";

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
  /** Size of the allowlist, so the page can show how many registered voters haven't voted yet.
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

      <ul className="live-bars">
        {candidates.map((name, id) => {
          const count = totals[id] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          const isWinner = winners.includes(id);
          const rowClass = ["live-bar-row", pulsed[id] && "live-bar-pulse", isWinner && "live-bar-winner"]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={id} className={rowClass}>
              <div className="live-bar-labels">
                <span className="live-bar-name">
                  {name}
                  {isWinner && " ★"}
                </span>
                <span className="live-bar-count">{count}</span>
              </div>
              <div className="live-bar-track">
                <div className="live-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
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
              of {registeredVoters} registered {registeredVoters === 1 ? "voter" : "voters"} still to vote
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

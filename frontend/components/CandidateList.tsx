"use client";

type Props = {
  candidates: string[];
  tally: bigint[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  canVote: boolean;
  /** Hide the running counts and bars (a voter choosing a candidate does not need them). */
  showCounts?: boolean;
};

/** Pure display of the ballot: candidate names, live vote counts, and a selectable radio-style
 *  row per candidate. Semantic radiogroup markup so it's screen-reader and keyboard usable
 *  (NFR-05) without any extra library. */
export default function CandidateList({ candidates, tally, selectedId, onSelect, canVote, showCounts = true }: Props) {
  const total = tally.reduce((sum, v) => sum + Number(v ?? 0n), 0);
  return (
    <ul className="candidate-list" role="radiogroup" aria-label="Candidates">
      {candidates.map((name, id) => (
        <li key={id} className="candidate-row">
          {showCounts && <span
            className="candidate-fill"
            aria-hidden="true"
            style={{ width: `${total > 0 ? (Number(tally[id] ?? 0n) / total) * 100 : 0}%` }}
          />}
          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: canVote ? "pointer" : "default" }}>
            {/* The choice control only appears for someone who can actually vote; everyone else
                sees the same rows as a plain results list. */}
            {canVote && (
              <input
                type="radio"
                name="candidate"
                value={id}
                checked={selectedId === id}
                onChange={() => onSelect(id)}
              />
            )}
            {name}
          </label>
          {showCounts && <span className="tally-count" aria-label={`${tally[id] ?? 0n} votes for ${name}`}>
            {(tally[id] ?? 0n).toString()} {Number(tally[id] ?? 0n) === 1 ? "vote" : "votes"}
          </span>}
        </li>
      ))}
    </ul>
  );
}

"use client";

type Props = {
  candidates: string[];
  tally: bigint[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  canVote: boolean;
};

/** Pure display of the ballot: candidate names, live vote counts, and a selectable radio-style
 *  row per candidate. Semantic radiogroup markup so it's screen-reader and keyboard usable
 *  (NFR-05) without any extra library. */
export default function CandidateList({ candidates, tally, selectedId, onSelect, canVote }: Props) {
  return (
    <ul className="candidate-list" role="radiogroup" aria-label="Candidates">
      {candidates.map((name, id) => (
        <li key={id} className="candidate-row">
          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: canVote ? "pointer" : "default" }}>
            <input
              type="radio"
              name="candidate"
              value={id}
              checked={selectedId === id}
              disabled={!canVote}
              onChange={() => onSelect(id)}
            />
            {name}
          </label>
          <span className="tally-count" aria-label={`${tally[id] ?? 0n} votes for ${name}`}>
            {(tally[id] ?? 0n).toString()} {Number(tally[id] ?? 0n) === 1 ? "vote" : "votes"}
          </span>
        </li>
      ))}
    </ul>
  );
}

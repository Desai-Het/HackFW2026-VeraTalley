type Props = {
  /** Names of the candidates holding the top count: none if nobody voted, several for a tie. */
  names: string[];
  /** Votes each of them received. */
  votes: number;
};

/** The outcome of a closed election, large enough to read from across a room. */
export default function WinnerBanner({ names, votes }: Props) {
  if (names.length === 0) {
    return (
      <div className="winner-banner" role="status">
        <p className="winner-label">Voting is closed</p>
        <p className="winner-detail">No votes were cast.</p>
      </div>
    );
  }
  const tie = names.length > 1;
  return (
    <div className="winner-banner" role="status">
      <p className="winner-label">{tie ? "It's a tie" : "Winner"}</p>
      <p className="winner-name">{names.join(" & ")}</p>
      <p className="winner-detail">
        {tie ? `${votes} ${votes === 1 ? "vote" : "votes"} each` : `with ${votes} ${votes === 1 ? "vote" : "votes"}`}
      </p>
    </div>
  );
}

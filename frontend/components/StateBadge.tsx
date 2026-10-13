import { BALLOT_STATE_LABELS } from "@/lib/contracts";

const CLASS_BY_STATE = ["draft", "open", "closed"] as const;

/** The Draft / Open / Closed pill, used on every screen that shows an election's status. */
export default function StateBadge({ state }: { state: number }) {
  const label = BALLOT_STATE_LABELS[state] ?? "Unknown";
  return <span className={`badge badge-${CLASS_BY_STATE[state] ?? "draft"}`}>{label}</span>;
}

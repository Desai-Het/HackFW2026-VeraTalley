import { CHAIN_ID_PUBLIC } from "./network-public";

export type RelayStatus = { ok: true; relayer: string; balance: string } | { ok: false; error: string };

/** Whether the server can pay gas for voters right now. */
export async function getRelayStatus(): Promise<RelayStatus> {
  try {
    const res = await fetch("/api/relay", { cache: "no-store" });
    const data = await res.json();
    return data.ok ? { ok: true, relayer: data.relayer, balance: data.balance } : { ok: false, error: data.error };
  } catch {
    return { ok: false, error: "Can't reach the voting server." };
  }
}

type RelayInput =
  | { kind: "claim"; electionId: number; voter: string; sig: string }
  | { kind: "vote"; electionId: number; voter: string; candidateId: number; sig: string };

/** Sends a signed message to the relayer. Resolves to the transaction hash, or throws an Error
 *  whose message is already plain language. */
export async function relay(input: RelayInput): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Can't reach the voting server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
  return data.txHash as string;
}

const EXPLORERS: Record<number, string> = { 80002: "https://amoy.polygonscan.com", 137: "https://polygonscan.com" };

/** Link to a transaction on a public block explorer, or null on a local chain that has none. */
export function explorerTxUrl(hash: string): string | null {
  const base = process.env.NEXT_PUBLIC_EXPLORER_URL || EXPLORERS[CHAIN_ID_PUBLIC];
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : null;
}

export function explorerAddressUrl(address: string): string | null {
  const base = process.env.NEXT_PUBLIC_EXPLORER_URL || EXPLORERS[CHAIN_ID_PUBLIC];
  return base ? `${base.replace(/\/$/, "")}/address/${address}` : null;
}

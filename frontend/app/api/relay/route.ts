import { NextResponse } from "next/server";
import { getAddress, isAddress, formatEther } from "ethers";
import {
  ApiError,
  ballotAt,
  CHAIN_ID,
  clientKey,
  enqueue,
  feeOverrides,
  rateLimit,
  reasonFrom,
  registryAt,
  relayerAddress,
  relayerWallet,
  resolveElection,
  serverProvider,
} from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/** Is gasless voting available? The voter page calls this to decide whether to offer it. */
export async function GET() {
  try {
    const address = relayerAddress();
    const balance = await serverProvider().getBalance(address);
    return NextResponse.json({ ok: true, chainId: CHAIN_ID, relayer: address, balance: formatEther(balance) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status: err instanceof ApiError ? err.status : 500 });
  }
}

/** Forwards a voter's signed message to the chain and pays the gas. It can do exactly two
 *  things - register an invite's voter, and cast a signed vote - and only on elections that
 *  the VeraTally factory created. It cannot alter what was signed: the contract checks the
 *  signature itself, so a tampered request simply fails. */
export async function POST(req: Request) {
  try {
    const ip = clientKey(req);
    rateLimit("ip:" + ip, 20, 60_000);
    rateLimit("all", 300, 60_000);

    const text = await req.text();
    if (text.length > 2000) throw new ApiError("Request too large.", 413);
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError("Bad request.");
    }

    const { kind, voter, candidateId, sig } = body ?? {};
    if (kind !== "claim" && kind !== "vote") throw new ApiError("Bad request.");
    if (typeof voter !== "string" || !isAddress(voter)) throw new ApiError("Bad request.");
    if (typeof sig !== "string" || !SIGNATURE.test(sig)) throw new ApiError("Bad request.");
    if (kind === "vote" && !(Number.isInteger(candidateId) && candidateId >= 0 && candidateId < 1000)) {
      throw new ApiError("Bad request.");
    }

    const election = await resolveElection(body.electionId);
    const wallet = relayerWallet();
    const voterAddress = getAddress(voter);

    const txHash = await enqueue(async () => {
      const contract = kind === "claim" ? registryAt(election.registry, wallet) : ballotAt(election.ballot, wallet);
      const method = kind === "claim" ? "claimInvite" : "castVoteBySig";
      const args = kind === "claim" ? [voterAddress, sig] : [voterAddress, candidateId, sig];
      // Dry run first: a bad signature or a closed election fails here, before any gas is spent.
      await contract[method].staticCall(...args);
      let tx;
      try {
        tx = await contract[method](...args, await feeOverrides());
      } catch (err) {
        wallet.reset(); // re-read the real nonce next time
        throw err;
      }
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new ApiError("The transaction did not go through.", 502);
      return tx.hash as string;
    });

    return NextResponse.json({ ok: true, txHash });
  } catch (err) {
    if (!(err instanceof ApiError) && reasonFrom(err).startsWith("Something went wrong")) console.error("relay failed:", err);
    const status = err instanceof ApiError ? err.status : 400;
    return NextResponse.json({ ok: false, error: reasonFrom(err) }, { status });
  }
}

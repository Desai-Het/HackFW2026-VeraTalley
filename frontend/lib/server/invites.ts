import { createHmac } from "crypto";
import { verifyMessage } from "ethers";
import { ADMIN_MESSAGE_MAX_AGE_MS, CODE_ALPHABET, CODE_LENGTH, adminMessage, type AdminAction } from "../invite";
import { ApiError, inviteSecret, registryAt, type ResolvedElection } from "./config";

/** The invite code for one email in one election. Derived (HMAC) rather than stored, so the
 *  server keeps no list of codes and can re-send the same link without a database. Only
 *  someone holding INVITE_SECRET can recompute a code, which is why that variable is as
 *  sensitive as a password. */
export function deriveInviteCode(registryAddress: string, email: string): string {
  const mac = createHmac("sha256", inviteSecret())
    .update(`veratally-invite-v1|${registryAddress.toLowerCase()}|${email.toLowerCase()}`)
    .digest();
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[mac[i] & 31];
  return code;
}

/** Confirms the request was signed by the wallet that administers this election, and that the
 *  signature is fresh and covers exactly this action and email list. */
export async function requireAdmin(
  body: any,
  action: AdminAction,
  election: ResolvedElection,
  electionId: number,
  emails: string[]
): Promise<void> {
  const issuedAt = Number(body?.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > ADMIN_MESSAGE_MAX_AGE_MS) {
    throw new ApiError("That request has expired. Please try again.", 401);
  }
  if (typeof body?.signature !== "string") throw new ApiError("Missing signature.", 401);
  let signer: string;
  try {
    signer = verifyMessage(adminMessage(action, electionId, emails, issuedAt), body.signature);
  } catch {
    throw new ApiError("The signature is not valid.", 401);
  }
  const admin: string = await registryAt(election.registry).admin();
  if (signer.toLowerCase() !== admin.toLowerCase()) {
    throw new ApiError("Only this election's admin can do that.", 403);
  }
}

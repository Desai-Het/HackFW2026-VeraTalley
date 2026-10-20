import { createHmac } from "crypto";
import { CODE_ALPHABET, CODE_LENGTH } from "../invite";
import { inviteSecret } from "./config";

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

import { createHmac, timingSafeEqual } from "crypto";
import { CODE_ALPHABET } from "../invite";
import { inviteSecret } from "./config";
import { electionKey } from "./regstore";

/** The secret in the QR code's address. Derived, not stored: raising the election's
 *  `linkVersion` changes it. Only people who scanned the code (or were sent the link) know it,
 *  so strangers cannot register just by guessing /register/1, /register/2... */
export function linkKey(registry: string, version: number): string {
  const digest = createHmac("sha256", inviteSecret())
    .update(`veratally-reg-link-v1|${electionKey(registry)}|${version}`)
    .digest();
  let out = "";
  for (let i = 0; i < 16; i++) out += CODE_ALPHABET[digest[i] & 31];
  return out;
}

export function linkKeyMatches(registry: string, version: number, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const want = Buffer.from(linkKey(registry, version));
  const got = Buffer.from(given.trim().toUpperCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

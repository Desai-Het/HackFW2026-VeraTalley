import { Wallet, keccak256, toUtf8Bytes, type TypedDataDomain } from "ethers";
import { APP_NAME } from "./brand";

/** Everything both the browser and the server need for the email-invite flow: what an invite
 *  code looks like, how a code becomes a key, and the two messages people sign.
 *
 *  Nothing here talks to the network. The signed messages are what travel; the server only ever
 *  forwards them, and the contracts check them (see SignatureLib.sol). */

// 32 characters with no 0/O/1/I/L, so a code survives being read aloud or typed by hand.
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 20; // 20 x 5 bits = 100 bits of randomness: not guessable offline.

/** Strips spaces, dashes and case so "k7qm2-9xwpa..." and "K7QM29XWPA..." are the same code. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidCode(raw: string): boolean {
  const code = normalizeCode(raw);
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

/** K7QM2-9XWPA-4HT8R-D3VNC */
export function formatCode(code: string): string {
  return normalizeCode(code).replace(/(.{5})(?=.)/g, "$1-");
}

/** The secret key behind an invite code. Only its address is ever put on-chain. */
export function inviteWalletFromCode(code: string): Wallet {
  return new Wallet(keccak256(toUtf8Bytes("veratally-invite-v1:" + normalizeCode(code))));
}

export function inviteAddressFromCode(code: string): string {
  return inviteWalletFromCode(code).address;
}

/** A brand-new random wallet for one voter, made in their browser. The admin and the server
 *  never see it, so once an invite is claimed nobody else can vote as that person. */
export function createVoterWallet(): Wallet {
  return Wallet.createRandom() as unknown as Wallet;
}

// ---------------------------------------------------------------------------
// EIP-712 typed data. Must match VoterRegistry.CLAIM_TYPEHASH and ElectionBallot.VOTE_TYPEHASH.
// ---------------------------------------------------------------------------

export const CLAIM_TYPES = { ClaimInvite: [{ name: "voter", type: "address" }] };
export const VOTE_TYPES = {
  Vote: [
    { name: "voter", type: "address" },
    { name: "candidateId", type: "uint256" },
  ],
};

export function typedDomain(chainId: number | bigint, verifyingContract: string): TypedDataDomain {
  return { name: "VeraTally", version: "1", chainId, verifyingContract };
}

/** The invite key signs: "register this voter address". */
export function signClaim(
  inviteWallet: Wallet,
  chainId: number | bigint,
  registryAddress: string,
  voterAddress: string
): Promise<string> {
  return inviteWallet.signTypedData(typedDomain(chainId, registryAddress), CLAIM_TYPES, { voter: voterAddress });
}

/** The voter's own key signs: "I vote for this candidate in this election". */
export function signVote(
  voterWallet: Wallet,
  chainId: number | bigint,
  ballotAddress: string,
  candidateId: number
): Promise<string> {
  return voterWallet.signTypedData(typedDomain(chainId, ballotAddress), VOTE_TYPES, {
    voter: voterWallet.address,
    candidateId,
  });
}

// ---------------------------------------------------------------------------
// Admin request authentication (no passwords: the admin proves they hold the election's admin
// wallet by signing a short message, which costs no gas).
// ---------------------------------------------------------------------------

export const ADMIN_MESSAGE_MAX_AGE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export type ParsedEmails = { valid: string[]; invalid: string[]; duplicates: number };

/** One address per line, or separated by commas, semicolons or spaces. Lower-cased and
 *  de-duplicated: one person, one invite. */
export function parseEmailList(raw: string): ParsedEmails {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const token of tokens) {
    const email = token.toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      invalid.push(token);
      continue;
    }
    if (seen.has(email)) {
      duplicates += 1;
      continue;
    }
    seen.add(email);
    valid.push(email);
  }
  return { valid, invalid, duplicates };
}

export const MAX_INVITES_PER_REQUEST = 200;

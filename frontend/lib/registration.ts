import { keccak256, toUtf8Bytes } from "ethers";
import { APP_NAME } from "./brand";

/** Everything the registration feature shares between the browser and the server: the shapes of
 *  the data, the cleaning rules, and the message the organiser signs to sign in. Nothing here
 *  touches the network or the disk. */

export type RegField = { key: string; label: string; required: boolean };

/** What the organiser edits. */
export type RegSettings = {
  /** Whether the public form accepts new people right now. */
  open: boolean;
  /** Approve people automatically unless something about them looks off (see `flags`). */
  autoApprove: boolean;
  /** One or two sentences shown above the form. */
  intro: string;
  /** Extra questions after name and email. */
  fields: RegField[];
  /** If not empty, only emails ending in one of these domains can register. */
  allowedDomains: string[];
};

/** Settings plus the number behind the current QR code: "new QR code" raises it, which makes
 *  every QR code shown before stop working. */
export type RegConfig = RegSettings & { linkVersion: number };

export const DEFAULT_CONFIG: RegConfig = {
  linkVersion: 1,
  open: false,
  autoApprove: true,
  intro: "",
  fields: [],
  allowedDomains: [],
};

export type RegStatus = "pending" | "approved" | "rejected";

/** What the organiser sees for each person. Device and network fingerprints stay on the server. */
export type RegRecord = {
  id: string;
  name: string;
  email: string;
  extra: Record<string, string>;
  createdAt: number;
  status: RegStatus;
  /** Reasons a person was held back for a look: see FLAG_TEXT. */
  flags: string[];
  /** An invitation has been sent to this email. */
  invited: boolean;
};

export const FLAG_TEXT: Record<string, string> = {
  "same-device": "The same phone or browser registered more than one email address.",
  "same-network": "Several people registered from the same network in a short time (this is normal at a shared Wi-Fi).",
};

export const MAX_FIELDS = 6;
export const MAX_LABEL_LEN = 60;
export const MAX_VALUE_LEN = 200;
export const MAX_NAME_LEN = 100;
export const MAX_INTRO_LEN = 300;
export const MAX_REGISTRATIONS_PER_ELECTION = 5000;
export const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** One key per real mailbox, so the same person cannot register twice with tricks: capital
 *  letters, "+anything" tags, and (for Gmail) dots. "J.Doe+vote@gmail.com" and "jdoe@gmail.com"
 *  give the same key. */
export function emailKey(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    domain = "gmail.com";
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

export function cleanText(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Turns the organiser's list of questions into safe, unique keys. */
export function sanitizeFields(raw: unknown): RegField[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: RegField[] = [];
  for (const item of raw.slice(0, MAX_FIELDS)) {
    const label = cleanText((item as any)?.label, MAX_LABEL_LEN);
    if (!label) continue;
    let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field";
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
    used.add(key);
    out.push({ key, label, required: Boolean((item as any)?.required) });
  }
  return out;
}

export function sanitizeDomains(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
  const out = new Set<string>();
  for (const item of list) {
    const d = String(item).trim().toLowerCase().replace(/^@/, "");
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) out.add(d);
  }
  return [...out].slice(0, 20);
}

export function sanitizeConfig(raw: any): RegSettings {
  return {
    open: Boolean(raw?.open),
    autoApprove: raw?.autoApprove === undefined ? true : Boolean(raw.autoApprove),
    intro: cleanText(raw?.intro, MAX_INTRO_LEN),
    fields: sanitizeFields(raw?.fields),
    allowedDomains: sanitizeDomains(raw?.allowedDomains),
  };
}

export function domainAllowed(email: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return allowed.some((d) => domain === d || domain.endsWith("." + d));
}

/** What the organiser signs (free, no gas) to open a 30 minute session on the registrations. */
export function loginMessage(electionId: number, issuedAt: number, site: string): string {
  return [
    `${APP_NAME} organiser sign-in`,
    `Website: ${site}`,
    "Purpose: view and manage this election's registrations",
    `Election: ${electionId}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
  ].join("\n");
}

/** The QR code's address. The secret after "#" never reaches a web server's logs: browsers keep
 *  it to themselves and the form sends it along with the registration. */
export function registrationPath(electionId: number | string, key?: string): string {
  return `/register/${electionId}${key ? "#" + key : ""}`;
}

/** Short stable fingerprint of text, for tests and logs. */
export function digest(text: string): string {
  return keccak256(toUtf8Bytes(text)).slice(0, 18);
}

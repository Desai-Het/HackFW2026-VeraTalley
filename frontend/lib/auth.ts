/** Rules for usernames and passwords, shared by the sign-in forms and the server so both say
 *  the same thing. Nothing here touches the network or the disk. */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type Role = "owner" | "organiser";
export type SessionUser = { username: string; role: Role };

/** Usernames are lower case so "Maya" and "maya" are the same person. */
export function normaliseUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function usernameError(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Usernames must be ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(username)) {
    return "Usernames can use letters, numbers, dots, dashes and underscores, and must start with a letter or number.";
  }
  return null;
}

export function passwordError(password: unknown, username = ""): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < PASSWORD_MIN) return `Passwords must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  if (username && password.toLowerCase().includes(username)) return "The password must not contain the username.";
  if (/^(.)\1+$/.test(password)) return "Choose a less repetitive password.";
  return null;
}

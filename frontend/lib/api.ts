/** Calls one of this site's own API routes. Throws an Error whose message is already plain
 *  language. A 401 also tells the rest of the page (the header) that the sign-in has ended. */
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("vt-auth"));
  if (!data?.ok) {
    const err: any = new Error(data?.error || "Something went wrong. Please try again.");
    err.status = res.status;
    throw err;
  }
  return data as T;
}

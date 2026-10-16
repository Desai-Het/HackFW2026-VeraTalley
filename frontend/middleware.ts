import { NextResponse, type NextRequest } from "next/server";

/** The front door for every /api request. It runs before any API code and turns away anything
 *  that is not an ordinary request from this website's own pages:
 *   - only GET and POST (nothing else is ever needed),
 *   - POST bodies must be JSON and small,
 *   - a browser on ANOTHER website cannot call the API (cross-site requests are refused), so a
 *     look-alike page cannot make a visitor's browser act on this server,
 *   - answers are never cached or sniffed.
 *  The API routes themselves still check who is asking (organiser signature, QR key, rate
 *  limits). This layer only removes the easy abuse before it gets that far. */

const MAX_BODY_BYTES = 20_000;

const API_PATHS = new Set([
  "/api/relay",
  "/api/invites/prepare",
  "/api/invites/send",
  "/api/registration/info",
  "/api/registration/submit",
  "/api/registration/session",
  "/api/registration/admin",
]);

function deny(status: number, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function ownHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | null | undefined) => h && hosts.add(h.split(",")[0].trim().toLowerCase());
  add(req.headers.get("host"));
  add(req.headers.get("x-forwarded-host"));
  const configured = process.env["PUBLIC_BASE_URL"];
  if (configured) {
    try {
      add(new URL(configured).host);
    } catch {
      // ignore a malformed setting
    }
  }
  return hosts;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!API_PATHS.has(pathname)) return deny(404, "Not found.");

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return deny(405, "Method not allowed.");

  // Cross-site browser requests: refuse. (Direct tools such as curl send neither header and are
  // handled by the checks inside each route.)
  if (req.headers.get("sec-fetch-site") === "cross-site") return deny(403, "Cross-site requests are not allowed.");
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      return deny(403, "Bad origin.");
    }
    if (!ownHosts(req).has(host)) return deny(403, "Cross-site requests are not allowed.");
  }

  if (method === "POST") {
    if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
      return deny(415, "Send JSON.");
    }
    const length = Number(req.headers.get("content-length") || "0");
    if (length > MAX_BODY_BYTES) return deny(413, "Request too large.");
  }

  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export const config = { matcher: "/api/:path*" };

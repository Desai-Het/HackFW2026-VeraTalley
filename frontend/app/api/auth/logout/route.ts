import { clearCookieHeader } from "@/lib/server/session";
import { ok } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return ok({}, { "Set-Cookie": clearCookieHeader(req) });
}

import { clientKey, rateLimit } from "@/lib/server/config";
import { hasAnyAccount } from "@/lib/server/accounts";
import { getSession } from "@/lib/server/session";
import { fail, ok } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is signed in on this browser? Used by the page header. Says nothing sensitive. */
export async function GET(req: Request) {
  try {
    rateLimit("me:" + clientKey(req), 120, 60_000);
    const user = await getSession(req);
    return ok({ user, configured: await hasAnyAccount() });
  } catch (err) {
    return fail(err);
  }
}

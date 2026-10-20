import { clientKey, rateLimit } from "@/lib/server/config";
import { electionsOf } from "@/lib/server/accounts";
import { requireLogin } from "@/lib/server/session";
import { fail, ok } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The election numbers the signed-in account manages (all of them for the owner). */
export async function GET(req: Request) {
  try {
    rateLimit("mine:" + clientKey(req), 120, 60_000);
    const user = await requireLogin(req);
    return ok({ ids: await electionsOf(user.username, user.role) });
  } catch (err) {
    return fail(err);
  }
}

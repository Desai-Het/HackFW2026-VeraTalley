import { ApiError } from "@/lib/server/config";
import { passwordError } from "@/lib/auth";
import { setPassword, verifyOwnPassword } from "@/lib/server/accounts";
import { checkLoginAllowed, clearLoginFailures, cookieHeader, makeToken, recordLoginFailure, requireLogin } from "@/lib/server/session";
import { fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets an organiser change their own password. The owner's password lives in the server's
 *  settings and is changed there. All of the account's other sign-ins end. */
export async function POST(req: Request) {
  try {
    const user = await requireLogin(req);
    if (user.role === "owner") throw new ApiError("The owner password is changed in the server settings (OWNER_PASSWORD).");
    const body = await readJson(req);
    checkLoginAllowed(req, user.username);
    if (!(await verifyOwnPassword(user.username, body.current))) {
      recordLoginFailure(req, user.username);
      throw new ApiError("Your current password is not right.", 401);
    }
    clearLoginFailures(req, user.username);
    const bad = passwordError(body.next, user.username);
    if (bad) throw new ApiError(bad);
    const sv = await setPassword(user.username, body.next);
    const { token, maxAge } = makeToken(user.username, "organiser", String(sv));
    return ok({}, { "Set-Cookie": cookieHeader(req, token, maxAge) });
  } catch (err) {
    return fail(err);
  }
}

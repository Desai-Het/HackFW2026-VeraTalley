import { ApiError } from "@/lib/server/config";
import { checkLogin, hasAnyAccount } from "@/lib/server/accounts";
import { checkLoginAllowed, clearLoginFailures, cookieHeader, makeToken, recordLoginFailure, secretForAccounts } from "@/lib/server/session";
import { fail, ok, readJson } from "@/lib/server/http";
import { normaliseUsername } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const username = normaliseUsername(body.username);
    if (!(await hasAnyAccount())) throw new ApiError("Sign-in is not set up on this server yet.", 503);
    checkLoginAllowed(req, username || "-");
    const found = await checkLogin(body.username, body.password, secretForAccounts());
    if (!found) {
      recordLoginFailure(req, username || "-");
      throw new ApiError("Wrong username or password.", 401);
    }
    clearLoginFailures(req, username);
    const { token, maxAge } = makeToken(found.username, found.role, found.sv);
    return ok({ user: { username: found.username, role: found.role } }, { "Set-Cookie": cookieHeader(req, token, maxAge) });
  } catch (err) {
    return fail(err);
  }
}

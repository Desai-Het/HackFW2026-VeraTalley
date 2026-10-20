import { ApiError, clientKey, rateLimit } from "@/lib/server/config";
import { createUser, deleteUser, listUsers, setDisabled, setPassword } from "@/lib/server/accounts";
import { requireOwner } from "@/lib/server/session";
import { fail, ok, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Account management. Only the site owner may call it. */
export async function POST(req: Request) {
  try {
    rateLimit("accounts:" + clientKey(req), 60, 60_000);
    const owner = await requireOwner(req);
    const body = await readJson(req);
    switch (body.action) {
      case "list":
        break;
      case "create":
        await createUser(body.username, body.password, owner.username);
        break;
      case "reset-password":
        await setPassword(body.username, body.password);
        break;
      case "disable":
        await setDisabled(body.username, true);
        break;
      case "enable":
        await setDisabled(body.username, false);
        break;
      case "delete":
        if (body.confirm !== true) throw new ApiError("Please confirm.");
        await deleteUser(body.username);
        break;
      default:
        throw new ApiError("Unknown action.");
    }
    return ok({ users: await listUsers() });
  } catch (err) {
    return fail(err);
  }
}

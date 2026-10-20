import { NextResponse } from "next/server";
import { ApiError, reasonFrom } from "./config";

export function ok(data: Record<string, unknown> = {}, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ ok: true, ...data }, headers ? { headers } : undefined);
}

/** One place that turns any error into a plain-language JSON answer. */
export function fail(err: unknown): NextResponse {
  const e: any = err;
  if (!(err instanceof ApiError)) {
    if (e?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(String(e?.shortMessage || e?.message || ""))) {
      console.error("server wallet is out of funds");
      return NextResponse.json({ ok: false, error: "The server wallet is out of funds. Please tell the site owner." }, { status: 503 });
    }
    const message = reasonFrom(err);
    if (message.startsWith("Something went wrong")) console.error("request failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
}

export async function readJson(req: Request): Promise<any> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("Bad request.");
  return body;
}

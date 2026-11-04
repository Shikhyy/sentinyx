import { clientIp } from "@/lib/client-ip";
import { handleCheck } from "@/lib/check";
import { getStore } from "@sentinyx/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const res = await handleCheck(
    { target: url.searchParams.get("target"), chain: url.searchParams.get("chain") },
    clientIp(req),
    url.origin,
    { store: getStore() },
  );
  const headers: Record<string, string> = { ...CORS, "Cache-Control": res.status === 200 ? "public, s-maxage=60, stale-while-revalidate=300" : "no-store" };
  if ("retryAfter" in res && res.retryAfter) headers["Retry-After"] = String(res.retryAfter);
  return Response.json(res.body, { status: res.status, headers });
}

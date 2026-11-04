import { clientIp } from "@/lib/client-ip";
import { handleScan } from "@/lib/handle-scan";
import { getStore } from "@sentinyx/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* handled as a bad target below */
  }
  const res = await handleScan(body, clientIp(req), { store: getStore() });
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if ("retryAfter" in res && res.retryAfter) headers["Retry-After"] = String(res.retryAfter);
  return Response.json(res.body, { status: res.status, headers });
}

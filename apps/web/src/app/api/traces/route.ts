import { timingSafeEqual } from "node:crypto";
import { getStore } from "@sentinyx/store";
import { parseTraceLines } from "@/lib/traces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.TRACE_INGEST_TOKEN;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Upload Guard traces: `curl -X POST -H "Authorization: Bearer $TRACE_INGEST_TOKEN" --data-binary @sentinyx-trace.jsonl $SITE/api/traces`.
 * Refuses to accept anything unless TRACE_INGEST_TOKEN is set, so the endpoint is never open.
 */
export async function POST(req: Request) {
  if (!process.env.TRACE_INGEST_TOKEN) return Response.json({ error: "TRACE_INGEST_TOKEN is not set." }, { status: 503 });
  if (!authorised(req)) return Response.json({ error: "Unauthorised." }, { status: 401 });
  const body = await req.text();
  if (body.length > 1_000_000) return Response.json({ error: "Too large." }, { status: 413 });
  const { entries, errors } = parseTraceLines(body);
  if (entries.length === 0 && errors.length) return Response.json({ error: errors[0], errors }, { status: 400 });
  try {
    const added = await getStore().addTraces(entries);
    return Response.json({ received: entries.length, added, errors });
  } catch (e) {
    console.error("storing traces failed", e);
    return Response.json({ error: "Could not store traces." }, { status: 502 });
  }
}

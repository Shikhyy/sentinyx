import { clientIp } from "@/lib/client-ip";
import { getStore, ID_PATTERN } from "@sentinyx/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Scans can be wrong — report a false positive." Stored next to the scan so it can be labelled later. */
export async function POST(req: Request) {
  let body: { id?: unknown; note?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* falls through to validation */
  }
  const { id, note } = body;
  if (typeof id !== "string" || !ID_PATTERN.test(id) || typeof note !== "string" || note.trim().length < 3 || note.length > 1000) {
    return Response.json({ error: "Add a short note (3 to 1000 characters)." }, { status: 400 });
  }
  const store = getStore();
  try {
    if ((await store.hit(`fb:${clientIp(req)}`, 60)) > 5) return Response.json({ error: "Too many reports. Try again in a minute." }, { status: 429 });
    if (!(await store.getScan(id))) return Response.json({ error: "That report does not exist." }, { status: 404 });
    await store.saveFeedback({ scanId: id, note: note.trim(), createdAt: new Date().toISOString() });
  } catch (e) {
    console.error("feedback failed", e);
    return Response.json({ error: "Could not save that. Try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}

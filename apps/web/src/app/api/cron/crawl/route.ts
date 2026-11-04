import { timingSafeEqual } from "node:crypto";
import { getStore } from "@sentinyx/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run open: no secret means no crawl
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Vercel Cron calls this nightly (see vercel.json) and sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (!authorised(req)) return Response.json({ error: "Unauthorised." }, { status: 401 });
  try {
    // Loaded only for authorised calls: the crawler pulls in the scanner and viem, which rejected requests should never pay for.
    const { runCrawl } = await import("@sentinyx/crawler");
    // Stay inside the function limit: stop starting new scans after 45 s. Leftovers are picked up next run.
    const r = await runCrawl({ store: getStore(), limit: 40, deadlineMs: 45_000 });
    return Response.json(r);
  } catch (e) {
    console.error("crawl failed", e);
    return Response.json({ error: "The crawl failed." }, { status: 502 });
  }
}

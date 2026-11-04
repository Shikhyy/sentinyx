import { getStore } from "@sentinyx/store";
import { getPulse } from "@/lib/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, read-only numbers for the nav ticker. The CDN keeps it for a minute so it costs next to nothing; browsers always revalidate. */
export async function GET() {
  const pulse = await getPulse(getStore());
  return Response.json(pulse, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } });
}

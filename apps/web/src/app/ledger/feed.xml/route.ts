import { getStore } from "@sentinyx/store";
import { toAtom } from "@/lib/ledger-view";

export const dynamic = "force-dynamic";

const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export async function GET() {
  const items = await getStore().ledgerEntries({ limit: 50 });
  return new Response(toAtom(items, site), {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, s-maxage=300" },
  });
}

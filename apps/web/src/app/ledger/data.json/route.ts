import { getStore } from "@sentinyx/store";
import { toJson } from "@/lib/ledger-view";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const [summary, items] = await Promise.all([store.ledgerSummary(), store.ledgerEntries({ limit: 500 })]);
  return Response.json(toJson(summary, items), {
    headers: { "Content-Disposition": 'attachment; filename="night-ledger.json"', "Cache-Control": "public, s-maxage=300" },
  });
}

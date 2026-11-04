import { getStore } from "@sentinyx/store";
import { toCsv } from "@/lib/ledger-view";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getStore().ledgerEntries({ limit: 500 });
  return new Response(toCsv(items), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="night-ledger.csv"',
      "Cache-Control": "public, s-maxage=300",
    },
  });
}

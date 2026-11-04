import type { CrawlRow, LedgerItem, LedgerSummary, ScannedRow } from "./types.js";

/** Pure summary maths shared by the memory store and tests. The Postgres store computes the same numbers in SQL. */
export function summarize(scanned: ScannedRow[], items: LedgerItem[], crawls: CrawlRow[]): LedgerSummary {
  const ok = scanned.filter((s) => s.verdict !== "error");
  const labelled = items.filter((i) => i.label);
  const tp = labelled.filter((i) => i.label === "true_positive");
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.field, (counts.get(i.field) ?? 0) + 1);
  const finished = crawls.filter((c) => c.finishedAt).sort((a, b) => b.id - a.id);
  return {
    scanned: ok.length,
    partial: ok.filter((s) => s.partial).length,
    flagged: ok.filter((s) => s.verdict === "flagged").length,
    suspicious: ok.filter((s) => s.verdict === "suspicious").length,
    confirmed: new Set(tp.map((i) => i.target)).size,
    labelled: labelled.length,
    precision: labelled.length ? tp.length / labelled.length : null,
    byField: [...counts].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
    crawls: finished.length,
    lastCrawl: finished[0] ?? null,
  };
}

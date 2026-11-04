import { scan, type FieldResult, type Finding, type ScanReport } from "@sentinyx/scanner";
import { newId, type CrawlStats, type LedgerItem, type Store } from "@sentinyx/store";
import { discoverGecko, SOURCE, type Discovered } from "./discover.js";
import { maskAddresses, maskSameLength, redactReport } from "./redact.js";

export interface CrawlOptions {
  store: Store;
  /** Most new tokens to scan this run. */
  limit?: number;
  concurrency?: number;
  /** Stop starting new scans after this many ms; anything left is picked up next run. */
  deadlineMs?: number;
  discover?: () => Promise<Discovered[]>;
  scanFn?: (address: string) => Promise<ScanReport>;
  log?: (msg: string) => void;
}

export interface CrawlResult {
  crawlId: number;
  stats: CrawlStats;
  /** Candidates left unscanned because of the limit or the deadline. */
  remaining: number;
}

/** Where a field lives, in words a reader would use. */
export function fieldGroup(source: string): string {
  if (source.startsWith("contract.")) return "Name and symbol";
  if (source.startsWith("contractURI")) return "Contract metadata";
  if (source.startsWith("coinURI")) return "Token metadata";
  if (source.startsWith("tokenURI")) return "NFT item";
  if (source.startsWith("name.text")) return "ENS text record";
  if (source.startsWith("source.")) return "Verified source";
  return "Other";
}

const ADDRESS_RE = /(?<![a-fA-F0-9])0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;
const HIDDEN = new Set(["hidden.unicode-tags", "hidden.base64-instructions"]);
const RANK = { high: 3, medium: 2, low: 1 } as const;

/** Short, masked evidence for the public table. Built from the masked full text so an address is never cut in half. */
export function excerptFor(f: FieldResult): string {
  const real = f.findings.filter((x) => x.severity !== "low");
  const rank = (a: Finding, b: Finding) => RANK[b.severity] - RANK[a.severity] || a.start - b.start;
  // Prefer a finding that points at a span of the visible text; combos and hidden-text rules have no span.
  const hidden = real.find((x) => HIDDEN.has(x.rule));
  const spanned = real.filter((x) => x.end > x.start && !HIDDEN.has(x.rule)).sort(rank)[0];
  const masked = maskSameLength(f.text);
  let raw: string;
  if (hidden) {
    raw = `Hidden text: ${hidden.excerpt}`; // the decoded instruction; people can't see it in the original
  } else if (spanned && spanned.end <= masked.length) {
    let a = Math.max(0, spanned.start - 40);
    let b = Math.min(masked.length, spanned.end + 40);
    // Never start or stop in the middle of an address: widen the window to take the whole one.
    for (const m of f.text.matchAll(ADDRESS_RE)) {
      const s0 = m.index!;
      const e0 = s0 + m[0].length;
      if (s0 < a && a < e0) a = s0;
      if (s0 < b && b < e0) b = e0;
    }
    raw = (a > 0 ? "…" : "") + masked.slice(a, b) + (b < masked.length ? "…" : "");
  } else {
    raw = real.sort(rank)[0]?.excerpt ?? masked.slice(0, 160);
  }
  return maskAddresses(raw)
    .replace(/·{3,}/g, "…")
    .replace(/[\u{E0000}-\u{E007F}]+/gu, "⟨hidden⟩")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, shouldStop: () => boolean) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !shouldStop()) await fn(items[next++]);
    }),
  );
}

export async function runCrawl(o: CrawlOptions): Promise<CrawlResult> {
  const { store } = o;
  const log = o.log ?? (() => {});
  const started = Date.now();
  const deadline = o.deadlineMs ?? Infinity;
  const scanFn = o.scanFn ?? ((a: string) => scan(a, { chain: "base" }));

  const found = await (o.discover ?? (() => discoverGecko()))();
  const seen = await store.ledgerSeen(found.map((d) => d.address));
  const fresh = found.filter((d) => !seen.has(d.address));
  const batch = fresh.slice(0, o.limit ?? 40);
  log(`discovered ${found.length}, ${fresh.length} not scanned before, scanning ${batch.length}`);

  const crawlId = await store.startCrawl(SOURCE);
  const stats: CrawlStats = { discovered: fresh.length, scanned: 0, failed: 0, flagged: 0, suspicious: 0 };
  let attempted = 0;

  await pool(
    batch,
    o.concurrency ?? 4,
    async (d) => {
      attempted++;
      const at = new Date().toISOString();
      let report: ScanReport;
      try {
        report = await scanFn(d.address);
      } catch (e) {
        const msg = (e as Error).message ?? "";
        stats.failed++;
        log(`  ${d.address} failed: ${msg.slice(0, 80)}`);
        // A network hiccup is retried tomorrow; a permanent failure is recorded so we don't retry forever.
        if (!/^Could not reach/.test(msg)) {
          await store.recordScanned({ target: d.address, crawlId, verdict: "error", partial: false, scanId: null, scannedAt: at });
        }
        return;
      }
      stats.scanned++;
      let scanId: string | null = null;
      if (report.verdict !== "clean") {
        if (report.verdict === "flagged") stats.flagged++;
        else stats.suspicious++;
        scanId = newId();
        await store.saveScan({ id: scanId, report: redactReport(report), createdAt: at, redacted: true });
        const items: LedgerItem[] = report.fields
          .filter((f) => f.verdict !== "clean")
          .map((f) => ({
            id: newId(),
            target: report.target,
            kind: report.kind,
            field: fieldGroup(f.source),
            fieldLabel: f.label,
            verdict: f.verdict as "flagged" | "suspicious",
            excerptRedacted: excerptFor(f),
            findingRules: [...new Set(f.findings.filter((x) => x.severity !== "low").map((x) => x.rule))],
            detectedAt: at,
            reviewed: false,
            label: null,
            scanId,
            crawlId,
          }));
        await store.addLedgerItems(items);
        log(`  ${d.symbol || d.address} → ${report.verdict} (${items.length} field${items.length === 1 ? "" : "s"})`);
      }
      await store.recordScanned({ target: report.target, crawlId, verdict: report.verdict, partial: report.warnings.length > 0, scanId, scannedAt: at });
    },
    () => Date.now() - started > deadline,
  );

  await store.finishCrawl(crawlId, stats);
  return { crawlId, stats, remaining: fresh.length - attempted };
}

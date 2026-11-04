import { summarize } from "./summary.js";
import type { CrawlRow, TraceEntry, TraceFilter, CrawlStats, EntryFilter, Label, LedgerItem, LedgerSummary, ScannedRow, Store, StoredScan } from "./types.js";

const MAX_MEMORY_SCANS = 2000;

/** In-process store for local development and tests. Everything is lost on restart. */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private scans = new Map<string, StoredScan>();
  private hits = new Map<string, { n: number; exp: number }>();
  private feedback: { scanId: string; note: string; createdAt: string }[] = [];
  private scanned = new Map<string, ScannedRow>();
  private items: LedgerItem[] = [];
  private crawls: CrawlRow[] = [];

  async saveScan(s: StoredScan) {
    this.scans.set(s.id, s);
    if (this.scans.size > MAX_MEMORY_SCANS) this.scans.delete(this.scans.keys().next().value!);
  }
  async getScan(id: string) {
    return this.scans.get(id) ?? null;
  }
  async findRecent(target: string, maxAgeMs: number) {
    const since = Date.now() - maxAgeMs;
    let best: StoredScan | null = null;
    for (const s of this.scans.values()) {
      if (s.report.target === target && Date.parse(s.createdAt) >= since && (!best || s.createdAt > best.createdAt)) best = s;
    }
    return best;
  }
  async saveFeedback(f: { scanId: string; note: string; createdAt: string }) {
    this.feedback.push(f);
  }
  async hit(key: string, windowSec: number) {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.exp <= now) {
      this.hits.set(key, { n: 1, exp: now + windowSec * 1000 });
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.exp <= now) this.hits.delete(k);
      return 1;
    }
    return ++cur.n;
  }

  private traces = new Map<string, TraceEntry>();
  async addTraces(entries: TraceEntry[]) {
    let n = 0;
    for (const e of entries) if (!this.traces.has(e.id)) (this.traces.set(e.id, e), n++);
    return n;
  }
  async listTraces(filter: TraceFilter = {}) {
    return [...this.traces.values()]
      .filter((t) => !filter.decision || t.decision === filter.decision)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit ?? 200);
  }
  async getTrace(id: string) {
    return this.traces.get(id) ?? null;
  }

  async ledgerSeen(targets: string[]) {
    return new Set(targets.filter((t) => this.scanned.has(t)));
  }
  async startCrawl(source: string) {
    const id = this.crawls.length + 1;
    this.crawls.push({ id, source, startedAt: new Date().toISOString(), finishedAt: null, discovered: 0, scanned: 0, failed: 0, flagged: 0, suspicious: 0 });
    return id;
  }
  async finishCrawl(id: number, stats: CrawlStats) {
    const c = this.crawls.find((x) => x.id === id);
    if (c) Object.assign(c, stats, { finishedAt: new Date().toISOString() });
  }
  async recordScanned(row: ScannedRow) {
    this.scanned.set(row.target, row);
  }
  async addLedgerItems(items: LedgerItem[]) {
    for (const i of items) if (!this.items.some((x) => x.id === i.id)) this.items.push(i);
  }
  async ledgerSummary(): Promise<LedgerSummary> {
    return summarize([...this.scanned.values()], this.items, this.crawls);
  }
  async ledgerEntries(filter: EntryFilter = {}) {
    return this.items
      .filter((i) => !filter.verdict || i.verdict === filter.verdict)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
      .slice(0, filter.limit ?? 100);
  }
  async labelItem(id: string, label: Label | null) {
    const i = this.items.find((x) => x.id === id);
    if (!i) return false;
    i.label = label;
    i.reviewed = label !== null;
    return true;
  }
}

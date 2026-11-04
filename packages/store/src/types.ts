import type { ScanReport, Verdict } from "@sentinyx/scanner";

export interface StoredScan {
  id: string;
  report: ScanReport;
  createdAt: string;
  /** True when attacker addresses were masked (Night Ledger entries stay masked until reviewed). */
  redacted?: boolean;
}

export type Label = "true_positive" | "false_positive";

export interface LedgerItem {
  id: string;
  target: string;
  kind: string;
  /** Where it hides: "Contract metadata", "Verified source", … */
  field: string;
  fieldLabel: string;
  verdict: Exclude<Verdict, "clean">;
  /** Short excerpt with every address masked. Never a ready-to-use payload. */
  excerptRedacted: string;
  findingRules: string[];
  detectedAt: string;
  reviewed: boolean;
  label: Label | null;
  scanId: string | null;
  crawlId: number;
}

export interface ScannedRow {
  target: string;
  crawlId: number;
  /** "error" means we could not scan it at all; it is not counted as scanned. */
  verdict: Verdict | "error";
  /** Some fields could not be read. */
  partial: boolean;
  scanId: string | null;
  scannedAt: string;
}

export interface CrawlStats {
  discovered: number;
  scanned: number;
  failed: number;
  flagged: number;
  suspicious: number;
}

export interface CrawlRow extends CrawlStats {
  id: number;
  source: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface LedgerSummary {
  scanned: number;
  partial: number;
  flagged: number;
  suspicious: number;
  /** Items a person marked as a real injection. */
  confirmed: number;
  /** Items a person has labelled either way. Precision is only meaningful when this is > 0. */
  labelled: number;
  precision: number | null;
  byField: { field: string; count: number }[];
  crawls: number;
  lastCrawl: CrawlRow | null;
}

export type Decision = "allow" | "deny" | "hold";

/** One line of a Guard trace (JSON lines written by `sentinyx`). */
export interface TraceEntry {
  id: string;
  agent: string;
  action: string;
  args: Record<string, unknown>;
  provenance: Record<string, string>;
  decision: Decision;
  reason: string;
  createdAt: string;
}

export interface TraceFilter {
  decision?: Decision;
  limit?: number;
}

export interface EntryFilter {
  verdict?: "flagged" | "suspicious";
  limit?: number;
}

/** Everything the web app and the crawler persist. */
export interface Store {
  readonly kind: "postgres" | "memory";
  saveScan(s: StoredScan): Promise<void>;
  getScan(id: string): Promise<StoredScan | null>;
  /** The newest stored report for this target created within the last `maxAgeMs`. */
  findRecent(target: string, maxAgeMs: number): Promise<StoredScan | null>;
  saveFeedback(f: { scanId: string; note: string; createdAt: string }): Promise<void>;
  /** Count a hit against `key` for `windowSec` seconds and return the new total. */
  hit(key: string, windowSec: number): Promise<number>;

  // Guard traces
  /** Insert traces, ignoring ids that already exist. Returns how many were new. */
  addTraces(entries: TraceEntry[]): Promise<number>;
  listTraces(filter?: TraceFilter): Promise<TraceEntry[]>;
  getTrace(id: string): Promise<TraceEntry | null>;

  // Night Ledger
  ledgerSeen(targets: string[]): Promise<Set<string>>;
  startCrawl(source: string): Promise<number>;
  finishCrawl(id: number, stats: CrawlStats): Promise<void>;
  recordScanned(row: ScannedRow): Promise<void>;
  addLedgerItems(items: LedgerItem[]): Promise<void>;
  ledgerSummary(): Promise<LedgerSummary>;
  ledgerEntries(filter?: EntryFilter): Promise<LedgerItem[]>;
  labelItem(id: string, label: Label | null): Promise<boolean>;
}

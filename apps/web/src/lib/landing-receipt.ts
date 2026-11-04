import type { FieldResult, ScanReport } from "@sentinyx/scanner";
import { chainLabel, evidenceFor, safeText, sections, statusLabel, veilFor, verdictWord } from "./report-view";

export interface ReceiptRow {
  label: string;
  st: string;
  /** Id of the quote shown under this row while it is lit. */
  hit?: string;
}

export interface ReceiptGroup {
  title: string;
  rows: ReceiptRow[];
}

export interface LandingReceipt {
  title: string;
  /** Right-hand tag in the receipt header. */
  tag: string;
  groups: ReceiptGroup[];
  quotes: { id: string; text: string }[];
  verdict: string;
  /** Where the full report lives. */
  href: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const maskAddresses = (s: string) => s.replace(/0x[a-fA-F0-9]{40}/g, short);

/** "Contract metadata description" reads better as "Description" under a "Metadata" heading. */
function rowLabel(f: FieldResult): string {
  const t = safeText(f.label).replace(/^(contract|token) metadata /i, "").replace(/^(name|symbol)\.text /i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** What to show under a lit row: the matched line with addresses shortened, or a note that hidden text is veiled. Never decoded hidden text. */
function quoteFor(f: FieldResult): string | null {
  const ev = evidenceFor(f);
  const q = ev.find((e) => e.type === "quote");
  if (q && q.type === "quote") {
    const text = maskAddresses(`${q.lead ? "…" : ""}${q.before}${q.match}${q.after}${q.trail ? "…" : ""}`).replace(/\s+/g, " ").trim();
    return `“${text.length > 190 ? text.slice(0, 189) + "…" : text}”`;
  }
  const h = ev.find((e) => e.type === "hidden");
  if (h && h.type === "hidden") return `Hidden text. ${veilFor(h.text).caption}`;
  return null;
}

/** Turn a real stored report into the landing page's receipt. The text is plain strings, rendered as text nodes. */
export function buildReceipt(report: ScanReport, id: string): LandingReceipt {
  let n = 0;
  const quotes: LandingReceipt["quotes"] = [];
  const groups = sections(report).map((s) => ({
    title: s.title,
    rows: s.fields.map((f): ReceiptRow => {
      const row: ReceiptRow = { label: rowLabel(f), st: statusLabel(f.verdict) };
      if (f.verdict !== "clean") {
        const text = quoteFor(f);
        if (text) {
          const qid = `rq${++n}`;
          quotes.push({ id: qid, text });
          row.hit = qid;
        }
      }
      return row;
    }),
  }));
  return {
    title: safeText(report.title).slice(0, 40),
    tag: `Real scan · ${chainLabel(report.chain)}`,
    groups,
    quotes,
    verdict: verdictWord(report.verdict),
    href: `/s/${id}`,
  };
}

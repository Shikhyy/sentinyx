import type { LedgerItem, LedgerSummary } from "@sentinyx/store";
import { shortTarget } from "./report-view";

export const CSV_COLUMNS = [
  "id", "target", "kind", "field", "field_label", "verdict", "excerpt_redacted", "finding_rules", "detected_at", "reviewed", "label", "report_path",
] as const;

/**
 * Excerpts come from untrusted onchain text. A cell that starts with = + - @ (or a tab/CR) would run as a formula
 * when the file is opened in a spreadsheet, so those get a leading apostrophe.
 */
export function csvCell(v: string | number | boolean | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items: LedgerItem[]): string {
  const rows = items.map((i) =>
    [i.id, i.target, i.kind, i.field, i.fieldLabel, i.verdict, i.excerptRedacted, i.findingRules.join(" "), i.detectedAt, i.reviewed, i.label, i.scanId ? `/s/${i.scanId}` : ""]
      .map(csvCell)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

export function toJson(summary: LedgerSummary, items: LedgerItem[], generatedAt = new Date()) {
  return {
    generated_at: generatedAt.toISOString(),
    note: "Addresses inside flagged text are masked until a person reviews them.",
    summary,
    items: items.map((i) => ({
      id: i.id, target: i.target, kind: i.kind, field: i.field, field_label: i.fieldLabel, verdict: i.verdict,
      excerpt_redacted: i.excerptRedacted, finding_rules: i.findingRules, detected_at: i.detectedAt,
      reviewed: i.reviewed, label: i.label, report_path: i.scanId ? `/s/${i.scanId}` : null,
    })),
  };
}

export const percent = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}`);

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export function crawlStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export const itemName = (i: LedgerItem) => shortTarget(i.target);

import type { FieldResult, Finding, ScanReport, Verdict } from "@sentinyx/scanner";

/** Replace characters that are invisible or reorder text with visible markers, so a report never hides what it quotes. */
export function safeText(s: string): string {
  return s
    .replace(/[\u{E0000}-\u{E007F}]+/gu, "⟨hidden⟩")
    .replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "⟨·⟩")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function shortTarget(t: string): string {
  const m = t.match(/^(0x[a-fA-F0-9]{40})(#\d+)?$/);
  if (!m) return t.length > 28 ? t.slice(0, 26) + "…" : t;
  const a = m[1];
  return `${a.slice(0, 6)}…${a.slice(-4)}${m[2] ?? ""}`;
}

export const statusLabel = (v: Verdict) => (v === "flagged" ? "Flagged" : v === "suspicious" ? "Suspect" : "Clean");

export function verdictWord(v: Verdict): string {
  return v === "flagged" ? "Do not obey" : v === "suspicious" ? "Worth a look" : "Nothing addressed to agents";
}

export interface VerdictCopy {
  paragraph: string;
  holder: string | null;
  caption: string;
  tag: string;
}

export function verdictCopy(r: Pick<ScanReport, "verdict" | "warnings">): VerdictCopy {
  const holder = "If you only hold or trade this yourself, the text can’t hurt you. It targets agents that read it.";
  if (r.verdict === "flagged")
    return { paragraph: "This contains instructions written for AI agents. Don’t let an agent act on it.", holder, caption: "Hidden orders found", tag: "Do not obey" };
  if (r.verdict === "suspicious")
    return { paragraph: "Some text here speaks to AI agents. Worth a look before an agent reads it.", holder, caption: "Fields that speak to agents", tag: "Worth a look" };
  const partial = r.warnings.length > 0 ? " We could not read every field, so this is not a full all-clear." : "";
  return { paragraph: "Nothing here is addressed to AI agents." + partial, holder: null, caption: "Orders found", tag: "Nothing addressed to agents" };
}

export function numeral(r: Pick<ScanReport, "fields">): number {
  const flagged = r.fields.filter((f) => f.verdict === "flagged").length;
  return flagged > 0 ? flagged : r.fields.filter((f) => f.verdict === "suspicious").length;
}

const SECTION: [RegExp, string][] = [
  [/^contract\./, "Contract"],
  [/^(contractURI|coinURI)/, "Metadata"],
  [/^tokenURI/, "NFT item"],
  [/^name\.text/, "ENS name"],
  [/^source\./, "Verified source"],
];
export const sectionOf = (source: string) => SECTION.find(([re]) => re.test(source))?.[1] ?? "Other";

export interface Section {
  title: string;
  fields: FieldResult[];
}

export function sections(r: Pick<ScanReport, "fields">): Section[] {
  const out: Section[] = [];
  for (const f of r.fields) {
    const title = sectionOf(f.source);
    let s = out.find((x) => x.title === title);
    if (!s) out.push((s = { title, fields: [] }));
    s.fields.push(f);
  }
  return out;
}

export type Evidence =
  | { type: "quote"; before: string; match: string; after: string; lead: boolean; trail: boolean }
  | { type: "hidden"; text: string };

const HIDDEN_RULES = new Set(["hidden.unicode-tags", "hidden.base64-instructions"]);
const SEV = { high: 3, medium: 2, low: 1 } as const;

/** What to show under a flagged or suspicious row: the matched span in context, and any decoded hidden text. */
export function evidenceFor(f: FieldResult): Evidence[] {
  if (f.verdict === "clean") return [];
  const out: Evidence[] = [];
  const hidden = f.findings.filter((x) => HIDDEN_RULES.has(x.rule));
  for (const h of hidden.slice(0, 2)) out.push({ type: "hidden", text: safeText(h.excerpt) });

  const spans = f.findings
    .filter((x) => x.end > x.start && !x.message.includes("inside hidden text") && !HIDDEN_RULES.has(x.rule) && x.severity !== "low")
    .sort((a, b) => a.start - b.start);
  if (spans.length > 0) {
    // Highlight the whole order, not just its first word: merge matches that sit close together.
    const start = spans[0].start;
    let end = spans[0].end;
    for (const sp of spans.slice(1)) {
      if (sp.start > end + 40) break;
      end = Math.max(end, sp.end);
    }
    const a = Math.max(0, start - 90);
    const b = Math.min(f.text.length, end + 90);
    out.push({
      type: "quote",
      before: safeText(f.text.slice(a, start)),
      match: safeText(f.text.slice(start, end)),
      after: safeText(f.text.slice(end, b)),
      lead: a > 0,
      trail: b < f.text.length,
    });
  }
  return out.slice(0, 3);
}

export interface Reason {
  field: string;
  rule: string;
  severity: Finding["severity"];
  message: string;
}

export function reasons(r: Pick<ScanReport, "fields">): Reason[] {
  const out: Reason[] = [];
  for (const f of r.fields)
    for (const x of f.findings) out.push({ field: f.label, rule: x.rule, severity: x.severity, message: safeText(x.message) });
  return out.sort((a, b) => SEV[b.severity] - SEV[a.severity]);
}

export const kindLabel = (k: ScanReport["kind"]) =>
  ({ erc20: "ERC-20", erc721: "ERC-721", erc1155: "ERC-1155", contract: "Contract", name: "Name" })[k];

export const chainLabel = (c: ScanReport["chain"]) => (c === "base-sepolia" ? "Base Sepolia" : "Base");

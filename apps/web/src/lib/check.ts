import { parseTarget, type ChainName, type ScanReport, type Verdict } from "@sentinyx/scanner";
import type { Store } from "@sentinyx/store";
import { handleScan, type ScanDeps } from "./handle-scan";
import { sectionOf } from "./report-view";

/** What an agent should do with this target's text. Same words Guard uses. */
export type CheckAction = "allow" | "hold" | "deny";

export interface CheckResult {
  target: string;
  chain: ChainName;
  kind: ScanReport["kind"];
  verdict: Verdict;
  action: CheckAction;
  /** False when some fields could not be read, so "allow" is not a full all-clear. */
  complete: boolean;
  /** Where the findings are and which rule fired. Never the scanned text itself: an agent may read this response. */
  findings: { where: string; rule: string; severity: "low" | "medium" | "high" }[];
  report: string;
  scannedAt: string;
  method: string;
  cached: boolean;
}

export const actionFor = (v: Verdict): CheckAction => (v === "flagged" ? "deny" : v === "suspicious" ? "hold" : "allow");

/** Turn a stored report into the compact answer the public API gives. Pure; takes no scanned text across. */
export function toCheck(report: ScanReport, reportUrl: string, cached: boolean): CheckResult {
  const findings: CheckResult["findings"] = [];
  for (const f of report.fields) for (const x of f.findings) findings.push({ where: sectionOf(f.source), rule: x.rule, severity: x.severity });
  return {
    target: report.target,
    chain: report.chain,
    kind: report.kind,
    verdict: report.verdict,
    action: actionFor(report.verdict),
    complete: report.warnings.length === 0,
    findings: findings.slice(0, 25),
    report: reportUrl,
    scannedAt: report.scannedAt,
    method: report.method,
    cached,
  };
}

export type CheckResponse = { status: 200; body: CheckResult } | { status: 400 | 404 | 429 | 500 | 502; body: { error: string }; retryAfter?: number };

/** GET /api/check?target=…&chain=…: the same scan as POST /api/scan, with a small answer built for programs. */
export async function handleCheck(query: { target?: string | null; chain?: string | null }, ip: string, origin: string, deps: ScanDeps): Promise<CheckResponse> {
  const body: { target: string | null | undefined; chain?: string } = { target: query.target };
  if (query.chain) body.chain = query.chain;
  const res = await handleScan(body, ip, deps);
  if (res.status !== 200) return res as CheckResponse;
  const { id, url, cached, ...report } = res.body;
  return { status: 200, body: toCheck(report as ScanReport, origin + url, cached) };
}

export const BADGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type BadgeState = Verdict | "unscanned";

/** The key reports are stored under, so a badge finds what a scan saved. Null if the target isn't one we scan. */
export function targetKey(raw: string): string | null {
  try {
    const t = parseTarget(raw);
    return t.type === "address" ? t.address + (t.tokenId !== undefined ? `#${t.tokenId}` : "") : t.name;
  } catch {
    return null;
  }
}

/** A badge only reads what is already stored. It never starts a scan, so embedding one can't be used to make us scan things. */
export async function badgeState(store: Store, raw: string): Promise<BadgeState> {
  const key = targetKey(raw);
  if (!key) return "unscanned";
  try {
    const found = await store.findRecent(key, BADGE_MAX_AGE_MS);
    return found?.report.verdict ?? "unscanned";
  } catch {
    return "unscanned";
  }
}

const WORD: Record<BadgeState, string> = { clean: "clean", suspicious: "suspect", flagged: "flagged", unscanned: "not scanned" };
const FILL: Record<BadgeState, string> = { clean: "#232323", suspicious: "#6B6862", flagged: "#FF5F1F", unscanned: "#6B6862" };

/** A flat two-part SVG badge in the site's colours. Orange is used only for flagged. */
export function badgeSvg(state: BadgeState): string {
  const left = "sentinyx";
  const right = WORD[state];
  const cw = 6.6; // mono glyph width at 11px
  const lw = Math.round(left.length * cw + 20);
  const rw = Math.round(right.length * cw + 20);
  const w = lw + rw;
  const label = `Sentinyx scan: ${right}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="22" role="img" aria-label="${label}">` +
    `<title>${label}</title>` +
    `<rect width="${lw}" height="22" rx="4" fill="#E4E0D7"/>` +
    `<rect x="${lw}" width="${rw}" height="22" rx="4" fill="${FILL[state]}"/>` +
    `<rect x="${lw - 4}" width="8" height="22" fill="${FILL[state]}"/>` +
    `<g font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11" text-anchor="middle" letter-spacing=".4">` +
    `<text x="${lw / 2}" y="15" fill="#232323">${left.toUpperCase()}</text>` +
    `<text x="${lw + rw / 2}" y="15" fill="#F1EEE7">${right.toUpperCase()}</text>` +
    `</g></svg>`
  );
}

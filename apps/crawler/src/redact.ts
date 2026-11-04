import type { ScanReport } from "@sentinyx/scanner";

const ADDRESS = /(?<![a-fA-F0-9])0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;
const DOT = "·";

/**
 * Public-safe text: full addresses become `0x7a3F…c91E`, and so does any fragment of one.
 * An excerpt window can cut an address in half, so a partial `0x…` run or a bare hex tail is masked too.
 */
export function maskAddresses(s: string): string {
  return s
    .replace(ADDRESS, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`)
    .replace(/0x[a-fA-F0-9]{9,}/g, (a) => `${a.slice(0, 6)}…`)
    .replace(/(?<![a-fA-F0-9x])[a-fA-F0-9]{16,}(?![a-fA-F0-9])/g, "…");
}

/** Same length as the original, so highlight offsets in a stored report stay valid. */
function padMask(a: string): string {
  return a.slice(0, 6) + DOT.repeat(a.length - 10) + a.slice(-4);
}

/** Mask every full address in place without changing the text's length. `keep` stays visible. */
export function maskSameLength(s: string, keep?: string): string {
  return s.replace(ADDRESS, (a) => (keep && a.toLowerCase() === keep ? a : padMask(a)));
}

/**
 * A copy of the report with every address masked except the scanned contract itself.
 * Night Ledger reports stay masked until a person reviews them: we publish findings, never ready-to-use payloads.
 */
export function redactReport(report: ScanReport): ScanReport {
  const own = report.target.toLowerCase().split("#")[0];
  const mask = (s: string) => maskSameLength(s, own);
  return {
    ...report,
    fields: report.fields.map((f) => ({
      ...f,
      text: mask(f.text),
      findings: f.findings.map((x) => ({ ...x, excerpt: mask(x.excerpt), message: mask(x.message) })),
      classifier: f.classifier ? { ...f.classifier, reason: mask(f.classifier.reason) } : undefined,
    })),
    warnings: report.warnings.map(mask),
  };
}

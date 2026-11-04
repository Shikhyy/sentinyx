import type { ScanReport } from "@sentinyx/scanner";
import { evidenceFor, sections, shortTarget, statusLabel, verdictWord, safeText } from "@/lib/report-view";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function stamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/**
 * The receipt-style list of everything an agent would read. All scanned text is attacker-controlled,
 * so it is only ever rendered as React text nodes, never as HTML, and invisible characters are made visible.
 */
export function ReportReceipt({ report, className = "" }: { report: ScanReport; className?: string }) {
  const secs = sections(report);
  return (
    <div className={`receipt ${className}`} role="region" aria-label={`Scan report for ${report.title}`}>
      <div className="r-head">
        <span>Scan / {safeText(report.title.length > 22 ? shortTarget(report.target) : report.title)}</span>
        <span>{stamp(report.scannedAt)}</span>
      </div>
      {report.fields.length === 0 ? <div className="r-quote static">No readable text was found on this target.</div> : null}
      {secs.map((s) => (
        <div key={s.title}>
          <div className="r-day">{s.title}</div>
          {s.fields.map((f, i) => {
            const cls = "r-line" + (f.verdict === "flagged" ? " inv hit" : f.verdict === "suspicious" ? " hit" : "");
            return (
              <div key={f.source + i}>
                <div className={cls}>
                  <span>{safeText(f.label)}</span>
                  <span className="lead" />
                  <span className="st" data-st={statusLabel(f.verdict)}>
                    {statusLabel(f.verdict)}
                  </span>
                </div>
                {evidenceFor(f).map((ev, j) =>
                  ev.type === "hidden" ? (
                    <div key={j} className="r-quote static">
                      <span className="qlabel">Hidden text (invisible to people)</span>“{ev.text}”
                    </div>
                  ) : (
                    <div key={j} className="r-quote static">
                      “{ev.lead ? "…" : ""}
                      {ev.before}
                      <mark>{ev.match}</mark>
                      {ev.after}
                      {ev.trail ? "…" : ""}”
                    </div>
                  ),
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className={"r-line r-total" + (report.verdict !== "clean" ? " hit" : "")}>
        <span>Verdict</span>
        <span className="lead" />
        <span className="st" data-st={verdictWord(report.verdict)}>
          {verdictWord(report.verdict)}
        </span>
      </div>
    </div>
  );
}

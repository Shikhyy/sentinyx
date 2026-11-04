import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLink, FalsePositive, ShareOnX } from "@/components/ReportActions";
import { ReceiptReveal } from "@/components/ReceiptReveal";
import { ReportReceipt } from "@/components/ReportReceipt";
import { chainLabel, kindLabel, numeral, reasons, safeText, shortTarget, verdictCopy, verdictWord } from "@/lib/report-view";
import { loadScan } from "./load";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const s = await loadScan(id);
  if (!s) return { title: "Report not found" };
  const r = s.report;
  const title = `${safeText(r.title)} — ${verdictWord(r.verdict)}`;
  return {
    title,
    description: verdictCopy(r).paragraph,
    // Reports quote attacker text, so keep them out of search indexes.
    robots: { index: false, follow: false },
    openGraph: { title, description: verdictCopy(r).paragraph },
  };
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params;
  const stored = await loadScan(id);
  if (!stored) notFound();
  const r = stored.report;
  const copy = verdictCopy(r);
  const n = numeral(r);
  const symbol = r.fields.find((f) => f.source === "contract.symbol")?.text;
  const why = reasons(r);
  const shareText =
    r.verdict === "flagged"
      ? `Sentinyx flagged ${safeText(r.title)}: instructions written for AI agents are hidden in its onchain text.`
      : `Sentinyx scanned ${safeText(r.title)}: ${verdictWord(r.verdict).toLowerCase()}.`;

  return (
    <>
      <main id="main" className="page">
        <div className="page-grid">
          <div>
            <span className="kicker mono">
              Scan report · {chainLabel(r.chain)}
            </span>
            <h1 className="title" style={{ marginTop: 12 }}>
              {safeText(r.title)}
            </h1>
            <p className="meta mono">
              {[symbol ? `$${safeText(symbol)}` : null, shortTarget(r.target), kindLabel(r.kind)].filter(Boolean).join(" · ")}
            </p>

            <div className="big" aria-label={`${n} ${copy.caption.toLowerCase()}`}>
              {n}
            </div>
            <div className="big-cap mono">
              <span>{copy.caption}</span>
              <span className="tag">{copy.tag}</span>
            </div>

            <p className="verdict-p">{copy.paragraph}</p>
            {copy.holder ? <p className="holder">{copy.holder}</p> : null}

            <div className="btns actions">
              <ShareOnX text={shareText} />
              <CopyLink />
              <Link className="btn btn-chip" href="/scan">
                Scan another
              </Link>
            </div>

            {why.length > 0 ? (
              <>
                <h2 className="h-small">Why it was {r.verdict === "clean" ? "noted" : r.verdict}</h2>
                <ul className="why">
                  {why.map((w, i) => (
                    <li key={i}>
                      <span className="sev">{w.severity === "high" ? "●" : w.severity === "medium" ? "◐" : "·"}</span>
                      {w.message} <span style={{ color: "var(--ash)" }}>({safeText(w.field)})</span>
                      <span className="rid">{w.rule}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {r.warnings.length > 0 ? (
              <>
                <h2 className="h-small">Warnings: fields we couldn’t read</h2>
                <ul className="warns">
                  {r.warnings.map((w, i) => (
                    <li key={i}>{safeText(w)}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {stored.redacted ? (
              <p className="redacted-note mono">
                From the Night Ledger. Addresses inside the scanned text are masked until a person reviews this entry.
              </p>
            ) : null}

            <div className="method mono">
              <div>Method {r.method}</div>
              <div>Scans can be wrong.</div>
              <FalsePositive id={stored.id} />
            </div>
          </div>

          <div className="sticky">
            <ReceiptReveal>
              <ReportReceipt report={r} />
            </ReceiptReveal>
          </div>
        </div>
      </main>

      <section className="night-band" aria-label="Protect an agent">
        <div>
          <h2>Run an agent?</h2>
          <p>Guard checks every transfer and install before it happens, so text like this can’t steer your agent.</p>
          <Link className="btn btn-night" href="/guard">
            Open Guard
          </Link>
        </div>
        <code>sentinyx wrap -- npx your-mcp-server</code>
      </section>
    </>
  );
}

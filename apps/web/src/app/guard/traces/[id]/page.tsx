import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@sentinyx/store";
import { safeText } from "@/lib/report-view";
import { actionTitle, dayStamp, decisionWord, isUntrusted, loadTrace, safeAction, scenarioOfTrace } from "@/lib/traces";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Trace ${id.slice(0, 8)}`, robots: { index: false, follow: false } };
}

export default async function TracePage({ params }: Props) {
  const { id } = await params;
  const t = await loadTrace(getStore(), id);
  if (!t) notFound();
  const sc = scenarioOfTrace(t.id);
  // For recorded runs we can show the whole lineage: what the agent read, then what it did.
  const lineage = sc ? sc.on.log.filter((l) => l.who === "agent" || l.who === "tool") : [];
  const provenance = Object.entries(t.provenance);
  const args = Object.entries(t.args);

  return (
    <main id="main" className="page">
      <div className="page-grid">
        <div>
          <span className="kicker mono">Trace · {t.agent} · {t.source === "lab" ? "Lab, recorded" : "Live"}</span>
          <div className="big decision-word" style={{ fontSize: "clamp(64px,10vw,150px)", margin: "28px 0 12px", letterSpacing: "-.05em" }}>
            {decisionWord(t.decision)}
          </div>
          <p className="meta mono">{safeAction(actionTitle(t))}</p>
          <p className="verdict-p">{safeText(t.reason)}</p>
          <div className="btns actions">
            {sc ? <Link className="btn btn-dark" href={`/guard/lab?s=${sc.id}`}>Replay in Attack Lab</Link> : null}
            <Link className="btn btn-chip" href="/guard/traces">All traces</Link>
          </div>
          <h2 className="h-small">Arguments</h2>
          <div className="receipt" style={{ maxHeight: "none" }}>
            {args.length === 0 ? <div className="r-quote static">None.</div> : args.map(([k, v]) => (
              <div key={k} className="r-line">
                <span>{safeText(k)}</span><span className="lead" />
                <span className="st" style={{ textTransform: "none", overflowWrap: "anywhere", textAlign: "right" }}>{safeText(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 120)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sticky">
          <div className="receipt" style={{ maxHeight: "none" }} role="region" aria-label="Where each value came from">
            <div className="r-head"><span>Trace / {t.id.slice(0, 8)}</span><span>{dayStamp(t.createdAt)}</span></div>
            {lineage.length > 0 ? (
              <>
                <div className="r-day">Lineage</div>
                {lineage.map((l, i) => (
                  <div key={i}>
                    <div className={"r-line" + (l.label && isUntrusted(l.label) ? " hit" : "")}>
                      <span>{l.who === "tool" ? "Tool result" : "Agent"}</span><span className="lead" />
                      <span className="st">{l.label ? safeText(l.label.replace("untrusted:", "untrusted ")).slice(0, 34) : "Planner"}</span>
                    </div>
                    <div className="r-quote static">{safeText(l.text).slice(0, 280)}</div>
                  </div>
                ))}
              </>
            ) : null}
            <div className="r-day">Each value in this action</div>
            {provenance.length === 0 ? <div className="r-quote static">No labelled values.</div> : provenance.map(([k, v]) => (
              <div key={k} className={"r-line" + (isUntrusted(v) ? " hit inv" : "")}>
                <span>{safeText(k)}</span><span className="lead" /><span className="st">{safeText(v.replace("untrusted:", "untrusted ")).slice(0, 34)}</span>
              </div>
            ))}
            <div className="r-day">Policy</div>
            <div className={"r-line r-total" + (t.decision !== "allow" ? " hit" : "")}>
              <span>Decision</span><span className="lead" /><span className="st">{decisionWord(t.decision)}</span>
            </div>
            <div className="r-quote static">{safeText(t.reason)}</div>
          </div>
          <p className="redacted-note mono">
            Guard matches values, it does not follow data flow. See guard/README.md for what it can and cannot catch.
          </p>
        </div>
      </div>
    </main>
  );
}

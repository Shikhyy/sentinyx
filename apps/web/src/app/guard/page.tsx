import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@sentinyx/store";
import { layout } from "@/lib/timeline";
import { actionTitle, hhmm, loadTraces, safeAction, scenarioOfTrace, summarize, dayStamp, decisionWord } from "@/lib/traces";
import { safeText } from "@/lib/report-view";

export const metadata: Metadata = { title: "Morning brief", description: "What your agents did, what Guard blocked, and what is waiting for you." };
export const dynamic = "force-dynamic";

export default async function GuardHome() {
  const traces = await loadTraces(getStore(), 300);
  const sum = summarize(traces);
  const { items, ticks } = layout(traces);
  const held = traces.filter((t) => t.decision === "hold");

  return (
    <main id="main">
      <section className="page" style={{ paddingBottom: 40 }}>
        <span className="kicker mono">Guard · Morning brief</span>
        <h1 className="title" style={{ marginTop: 12 }}>While you slept.</h1>
        <p className="sub">
          {sum.checked === 0
            ? "No agent has reported to Guard yet."
            : `Guard checked ${sum.checked} action${sum.checked === 1 ? "" : "s"}.${held.length ? ` ${held.length} ${held.length === 1 ? "is" : "are"} waiting for you.` : ""}`}
        </p>
        {sum.labCount > 0 ? (
          <p className="redacted-note mono" style={{ maxWidth: "70ch" }}>
            {sum.labCount} of these come from recorded Attack Lab runs (a scripted agent, a sandbox wallet, real Guard decisions). Connect your
            own agent and its actions appear here too.
          </p>
        ) : null}

        <div className="totals" style={{ marginTop: 40 }}>
          <Total n={sum.checked} label="Checked" />
          <Total n={sum.blocked} label="Blocked" dot />
          <Total n={sum.held} label="Held for you" />
          <Total n={sum.allowed} label="Allowed" />
        </div>
      </section>

      <section className="shift" aria-label="The shift">
        <div className="shift-in">
          <h2 className="h-small" style={{ color: "var(--night-ash)", margin: 0 }}>The shift</h2>
          {items.length === 0 ? (
            <p style={{ color: "var(--night-ash)" }}>Nothing to show yet.</p>
          ) : (
            <div className="timeline">
              <div className="axis" aria-hidden="true">
                {ticks.map((t, i) => (
                  <span key={i} style={{ left: `${t.left}%` }}>{t.label}</span>
                ))}
              </div>
              <div className="track">
                {items.map(({ trace, left, row }) => (
                  <Link
                    key={trace.id}
                    href={`/guard/traces/${trace.id}`}
                    className={`tick ${trace.decision}`}
                    style={{ left: `${left}%` }}
                    aria-label={`${hhmm(trace.createdAt)} ${decisionWord(trace.decision)}: ${safeAction(actionTitle(trace))}`}
                  >
                    {trace.decision === "deny" && row !== null ? (
                      <span className={`tl mono r${row}`}>{hhmm(trace.createdAt)} {safeAction(trace.action)}</span>
                    ) : null}
                    <span className="pop receipt mono" role="tooltip">
                      <span className="r-head"><span>{trace.agent}</span><span>{hhmm(trace.createdAt)} UTC</span></span>
                      <span className="r-line"><span>{safeAction(trace.action)}</span><span className="lead" /><span className="st">{decisionWord(trace.decision)}</span></span>
                    </span>
                  </Link>
                ))}
              </div>
              <div className="legend-row mono">
                <span><i className="k allow" /> Allowed</span>
                <span><i className="k deny" /> Blocked</span>
                <span><i className="k hold" /> Held</span>
                <Link href="/guard/traces">See all {items.length} as a list</Link>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="page" style={{ paddingTop: 56, paddingBottom: 30, minHeight: 0 }}>
        <h2 className="h-small" style={{ marginTop: 0 }}>Held for you</h2>
        {held.length === 0 ? (
          <div className="receipt err-receipt"><div className="r-quote static">Nothing is waiting for you.</div></div>
        ) : (
          <div className="held-grid">
            {held.map((t) => {
              const sc = scenarioOfTrace(t.id);
              return (
                <div key={t.id} className="receipt held-card">
                  <div className="r-head"><span>{t.agent} · {hhmm(t.createdAt)} · Trace #{t.id.slice(0, 6)}</span><span>{dayStamp(t.createdAt).slice(0, 6)}</span></div>
                  <div className="r-line inv"><span>{safeAction(actionTitle(t))}</span><span className="lead" /><span className="st">Held</span></div>
                  <div className="r-quote static"><span className="qlabel">Why</span>{safeText(t.reason)}</div>
                  <div className="btns" style={{ marginTop: 8 }}>
                    <Link className="btn btn-dark" href={`/guard/traces/${t.id}`}>See trace</Link>
                    {sc ? <Link className="btn btn-chip" href={`/guard/lab?s=${sc.id}`}>Replay in Attack Lab</Link> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="redacted-note mono" style={{ maxWidth: "70ch" }}>
          A held action stays held. Guard does not wait for an approval yet, so there is no Allow button: decide, then re-run the action yourself.
        </p>
      </section>

      <section className="page" style={{ paddingTop: 20, minHeight: 0 }}>
        <h2 className="h-small" style={{ marginTop: 0 }}>Agents</h2>
        <div className="receipt" style={{ maxWidth: 640, maxHeight: "none" }}>
          {sum.agents.length === 0 ? <div className="r-quote static">None yet.</div> : sum.agents.map((a) => (
            <div key={a.agent} className="r-line">
              <span>{a.agent}</span><span className="lead" />
              <span className="st">{a.count} checked{a.blocked ? ` · ${a.blocked} blocked` : ""}{a.held ? ` · ${a.held} held` : ""}</span>
            </div>
          ))}
        </div>
        <h2 className="h-small">Connect your agent</h2>
        <div className="receipt" style={{ maxWidth: 640, maxHeight: "none" }}>
          <div className="r-quote show" style={{ textTransform: "none", color: "inherit", paddingLeft: 0 }}>$ sentinyx wrap --agent my-agent -- npx your-mcp-server</div>
          <div className="r-quote show" style={{ textTransform: "none", color: "inherit", paddingLeft: 0 }}>$ curl -X POST -H &quot;Authorization: Bearer $TRACE_INGEST_TOKEN&quot; --data-binary @sentinyx-trace.jsonl $SITE/api/traces</div>
        </div>
        <div className="btns" style={{ marginTop: 28 }}>
          <Link className="btn btn-dark" href="/guard/lab">Try the Attack Lab</Link>
          <Link className="btn btn-chip" href="/guard/traces">All traces</Link>
        </div>
      </section>
    </main>
  );
}

function Total({ n, label, dot }: { n: number; label: string; dot?: boolean }) {
  return (
    <div className="total">
      <div className="big">{n}</div>
      <div className="mono tlabel">{dot && n > 0 ? <span className="vdot" aria-hidden="true" /> : null}{label}</div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@sentinyx/store";
import { actionTitle, dayStamp, decisionWord, loadTraces, safeAction } from "@/lib/traces";

export const metadata: Metadata = { title: "Traces", description: "Every action Guard checked, with where each value came from." };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ d?: string }> };

export default async function TracesPage({ searchParams }: Props) {
  const { d } = await searchParams;
  const filter = d === "deny" || d === "hold" || d === "allow" ? d : undefined;
  const all = await loadTraces(getStore());
  const traces = filter ? all.filter((t) => t.decision === filter) : all;
  const chip = (v: string | undefined, label: string) => (
    <Link href={v ? `/guard/traces?d=${v}` : "/guard/traces"} aria-current={filter === v ? "true" : undefined}>
      {label}
    </Link>
  );
  return (
    <main id="main" className="page">
      <span className="kicker mono">Guard</span>
      <h1 className="title" style={{ marginTop: 12 }}>Traces</h1>
      <p className="sub">Every action Guard checked, newest first. Open one to see where each value came from.</p>
      <div className="chips mono" style={{ margin: "28px 0 14px" }}>
        {chip(undefined, "All")}
        {chip("deny", "Denied")}
        {chip("hold", "Held")}
        {chip("allow", "Allowed")}
      </div>
      {traces.length === 0 ? (
        <div className="receipt err-receipt"><div className="r-quote static">No traces{filter ? ` with that decision` : ""} yet.</div></div>
      ) : (
        <div className="table-wrap">
          <table className="ledger-table">
            <caption className="sr-only">Guard traces, newest first</caption>
            <thead>
              <tr><th scope="col">Time</th><th scope="col">Agent</th><th scope="col">Action</th><th scope="col">Source</th><th scope="col">Decision</th></tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr key={t.id} className={t.decision === "deny" ? "inv" : ""}>
                  <td className="mono">{dayStamp(t.createdAt)}</td>
                  <td className="mono">{t.agent}</td>
                  <td className="mono"><Link href={`/guard/traces/${t.id}`}>{safeAction(actionTitle(t))}</Link></td>
                  <td className="mono">{t.source === "lab" ? "Lab · recorded" : "Live"}</td>
                  <td className="mono verdict">
                    {t.decision !== "allow" ? <span className="vdot" aria-hidden="true" /> : null}
                    {decisionWord(t.decision)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

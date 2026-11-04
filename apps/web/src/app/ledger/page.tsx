import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@sentinyx/store";
import { TextField } from "@/components/TextField";
import { crawlStamp, itemName, percent } from "@/lib/ledger-view";
import { safeText } from "@/lib/report-view";

export const metadata: Metadata = {
  title: "Night Ledger",
  description: "Every night we read the newest tokens that started trading on Base and publish what we found as open data.",
};
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ v?: string }> };

export default async function LedgerPage({ searchParams }: Props) {
  const { v } = await searchParams;
  const filter = v === "flagged" || v === "suspicious" ? v : undefined;
  const store = getStore();
  const [summary, entries] = await Promise.all([store.ledgerSummary(), store.ledgerEntries({ verdict: filter, limit: 100 })]);
  const last = summary.lastCrawl;
  const maxField = Math.max(1, ...summary.byField.map((f) => f.count));

  return (
    <main id="main">
      <section className="ledger-hero">
        <TextField />
        <div className="ledger-hero-in">
          <h1 className="title">The Night Ledger</h1>
          <p>Every night we read the newest tokens that started trading on Base, and publish what we found.</p>
          {last ? (
            <span className="mono">
              Crawl #{String(summary.crawls).padStart(2, "0")} · Last run {crawlStamp(last.finishedAt!)}
            </span>
          ) : null}
        </div>
      </section>

      {!last ? (
        <section className="ledger-sec">
          <div className="receipt err-receipt">
            <div className="r-head">
              <span>Night Ledger</span>
              <span>Waiting</span>
            </div>
            <div className="r-quote static">The first crawl runs tonight at 03:00 UTC.</div>
          </div>
        </section>
      ) : (
        <>
          <section className="ledger-sec">
            <div className="totals">
              <Total n={String(summary.scanned)} label="Items scanned" />
              <Total n={String(summary.flagged)} label="Flagged" dot={summary.flagged > 0} />
              <Total n={String(summary.confirmed)} label="Confirmed by hand" />
              <Total
                n={percent(summary.precision)}
                unit={summary.precision === null ? undefined : "%"}
                label="Precision (hand-labelled sample)"
                note={summary.precision === null ? "No hand-labelled sample yet" : `${summary.labelled} labelled`}
              />
            </div>
            <p className="ledger-note">
              {summary.suspicious} more were suspicious. {summary.partial > 0 ? `${summary.partial} had fields we could not read. ` : ""}
              Many new tokens publish little text beyond a name and symbol, so a clean result means nothing readable was addressed to agents.
              {summary.flagged === 0 && summary.suspicious === 0 ? " Finding nothing is a valid result, and we publish it." : ""}
            </p>
          </section>

          <section className="ledger-sec">
            <h2 className="h-small">Where they hide</h2>
            <div className="receipt hide-receipt">
              <div className="r-head">
                <span>Field</span>
                <span>Entries</span>
              </div>
              {summary.byField.length === 0 ? (
                <div className="r-quote static">Nothing flagged or suspicious yet.</div>
              ) : (
                summary.byField.map((f) => (
                  <div key={f.field}>
                    <div className="r-line">
                      <span>{f.field}</span>
                      <span className="lead" />
                      <span className="st">{f.count}</span>
                    </div>
                    <div className="r-bar">
                      <i style={{ width: `${(f.count / maxField) * 100}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="ledger-sec">
            <div className="entries-head">
              <h2 className="h-small" style={{ margin: 0 }}>Entries</h2>
              <div className="chips mono">
                <Link href="/ledger" aria-current={!filter ? "true" : undefined}>All</Link>
                <Link href="/ledger?v=flagged" aria-current={filter === "flagged" ? "true" : undefined}>Flagged</Link>
                <Link href="/ledger?v=suspicious" aria-current={filter === "suspicious" ? "true" : undefined}>Suspicious</Link>
                <span className="gap" />
                <a href="/ledger/data.csv" download>Download CSV</a>
                <a href="/ledger/data.json" download>JSON</a>
              </div>
            </div>
            {entries.length === 0 ? (
              <div className="receipt err-receipt">
                <div className="r-quote static">{filter ? `No ${filter} entries.` : "No entries yet. Nothing found so far."}</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="ledger-table">
                  <caption className="sr-only">Night Ledger entries, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Item</th>
                      <th scope="col">Field</th>
                      <th scope="col">Excerpt (addresses masked)</th>
                      <th scope="col">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className={e.verdict === "flagged" ? "inv" : ""}>
                        <td className="mono">{e.scanId ? <Link href={`/s/${e.scanId}`}>{e.id.slice(0, 6)}</Link> : e.id.slice(0, 6)}</td>
                        <td className="mono">{itemName(e)}</td>
                        <td className="mono">{safeText(e.fieldLabel)}</td>
                        <td className="excerpt">{safeText(e.excerptRedacted)}</td>
                        <td className="mono verdict">
                          <span className="vdot" aria-hidden="true" />
                          {e.verdict}
                          {e.reviewed ? <span className="rev"> · {e.label === "true_positive" ? "confirmed" : "false positive"}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="ledger-sec method-cols">
            <div>
              <h3 className="h-small">How we scan</h3>
              <p>Each night we take the newest tokens that started trading on Base ({last.source}) and read every field an agent would read. It is the same scan you can run yourself.</p>
            </div>
            <div>
              <h3 className="h-small">How we check</h3>
              <p>Rules and hidden-text decoding find the lines. A person reviews flagged items, and precision is calculated only from those labels.</p>
            </div>
            <div>
              <h3 className="h-small">What we hide</h3>
              <p>Addresses inside flagged text are masked until reviewed. We publish findings, never ready-to-use payloads.</p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Total({ n, label, unit, note, dot }: { n: string; label: string; unit?: string; note?: string; dot?: boolean }) {
  return (
    <div className="total">
      <div className="big">
        {n}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      <div className="mono tlabel">
        {dot ? <span className="vdot" aria-hidden="true" /> : null}
        {label}
      </div>
      {note ? <div className="mono tnote">{note}</div> : null}
    </div>
  );
}

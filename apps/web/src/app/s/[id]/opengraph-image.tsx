import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evidenceFor, safeText, shortTarget, statusLabel, verdictWord } from "@/lib/report-view";
import { loadScan } from "./load";

export const alt = "Sentinyx scan report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BONE = "#F1EEE7";
const GRAPHITE = "#232323";
const ASH = "#6B6862";
const SIGNAL = "#FF5F1F";

const ADDRESS = /0x[a-fA-F0-9]{40}/;
/** Short labels fit the card: drop the repeated "Contract metadata" prefix and cap the length. */
function rowLabel(label: string) {
  const t = safeText(label).replace(/^(contract|token) metadata /i, "").toUpperCase();
  return t.length > 16 ? t.slice(0, 15) + "…" : t;
}
const font = (name: string) => readFile(join(process.cwd(), "src/assets/fonts", name));

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sans, mono, stored] = await Promise.all([font("Geist-Medium.ttf"), font("GeistMono-Medium.ttf"), loadScan(id)]);
  const fonts = [
    { name: "Geist", data: sans, weight: 500 as const, style: "normal" as const },
    { name: "Geist Mono", data: mono, weight: 500 as const, style: "normal" as const },
  ];

  if (!stored) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", background: BONE, color: GRAPHITE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Geist", fontSize: 72 }}>
          Sentinyx
        </div>
      ),
      { ...size, fonts },
    );
  }

  const r = stored.report;
  const flagged = r.verdict === "flagged";
  const word = r.verdict === "flagged" ? "FLAGGED" : r.verdict === "suspicious" ? "SUSPECT" : "CLEAN";
  const title = safeText(r.title).slice(0, 28);

  // Receipt rows: problems first, then a few clean ones.
  const ordered = [...r.fields].sort((a, b) => ({ flagged: 0, suspicious: 1, clean: 2 })[a.verdict] - ({ flagged: 0, suspicious: 1, clean: 2 })[b.verdict]);
  const rows = ordered.slice(0, 4);
  const firstBad = rows.find((f) => f.verdict !== "clean");
  const quote = firstBad ? evidenceFor(firstBad).find((e) => e.type === "quote") : undefined;
  const words =
    quote && quote.type === "quote"
      ? (quote.before + quote.match + quote.after).replace(/\s+/g, " ").trim().slice(0, 150).split(" ")
      : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: BONE, color: GRAPHITE, display: "flex", padding: 64, fontFamily: "Geist" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 520 }}>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 24, color: ASH, letterSpacing: 1 }}>SENTINYX SCAN</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 64, letterSpacing: -2, lineHeight: 1.05 }}>{title}</div>
            <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 22, color: ASH, marginTop: 14 }}>
              {shortTarget(r.target).toUpperCase()}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 132, letterSpacing: -6, lineHeight: 0.9 }}>{word}</div>
            {flagged ? <div style={{ display: "flex", width: 26, height: 26, borderRadius: 26, background: SIGNAL, marginLeft: 60 }} /> : null}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 56, borderLeft: `2px solid ${GRAPHITE}`, borderRight: `2px solid ${GRAPHITE}`, padding: "20px 28px", fontFamily: "Geist Mono", fontSize: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: ASH, paddingBottom: 12, borderBottom: `2px dashed ${GRAPHITE}`, marginBottom: 14 }}>
            <div style={{ display: "flex" }}>SCAN</div>
            <div style={{ display: "flex" }}>{r.chain === "base-sepolia" ? "BASE SEPOLIA" : "BASE"}</div>
          </div>
          {rows.map((f, i) => {
            const bad = f.verdict === "flagged";
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", margin: "0 -10px", background: bad ? GRAPHITE : "transparent", color: bad ? BONE : GRAPHITE }}>
                  <div style={{ display: "flex", whiteSpace: "nowrap" }}>{rowLabel(f.label)}</div>
                  <div style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap", marginLeft: 16 }}>
                    {f.verdict !== "clean" ? <div style={{ display: "flex", width: 12, height: 12, borderRadius: 12, background: SIGNAL, marginRight: 10 }} /> : null}
                    {statusLabel(f.verdict).toUpperCase()}
                  </div>
                </div>
                {f === firstBad && words.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", fontFamily: "Geist", fontSize: 22, color: ASH, padding: "6px 0 10px 12px", lineHeight: 1.35 }}>
                    {words.map((w, j) =>
                      ADDRESS.test(w) ? (
                        <div key={j} style={{ display: "flex", width: 150, height: 20, background: GRAPHITE, margin: "6px 8px 0 0" }} />
                      ) : (
                        <div key={j} style={{ display: "flex", marginRight: 8 }}>{w}</div>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", paddingTop: 12, borderTop: `2px dashed ${GRAPHITE}` }}>
            <div style={{ display: "flex" }}>VERDICT</div>
            <div style={{ display: "flex" }}>{verdictWord(r.verdict).toUpperCase()}</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}

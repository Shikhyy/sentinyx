import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Sentinyx: every token talks, some give orders";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (n: string) => readFile(join(process.cwd(), "src/assets/fonts", n));

export default async function Image() {
  const [sans, mono] = await Promise.all([font("Geist-Medium.ttf"), font("GeistMono-Medium.ttf")]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#F1EEE7", color: "#232323", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, fontFamily: "Geist" }}>
        <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 26, color: "#6B6862", letterSpacing: 1 }}>SENTINYX · PROMPT-INJECTION SCANNER FOR BASE</div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 108, letterSpacing: -4, lineHeight: 1.0 }}>
          <div style={{ display: "flex" }}>Every token talks.</div>
          <div style={{ display: "flex", alignItems: "center" }}>
            Some give orders.
            <div style={{ display: "flex", width: 26, height: 26, borderRadius: 26, background: "#FF5F1F", marginLeft: 28 }} />
          </div>
        </div>
        <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 24, color: "#6B6862" }}>SCAN · NIGHT LEDGER · GUARD</div>
      </div>
    ),
    { ...size, fonts: [{ name: "Geist", data: sans, weight: 500, style: "normal" }, { name: "Geist Mono", data: mono, weight: 500, style: "normal" }] },
  );
}

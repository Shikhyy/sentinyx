import type { Metadata } from "next";
import { ScanPanel } from "@/components/ScanPanel";

export const metadata: Metadata = {
  title: "Scan",
  description: "Paste a Base contract, an NFT or a name and see every field an AI agent would read.",
};

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ target?: string | string[] }> }) {
  const q = (await searchParams).target;
  const initial = typeof q === "string" && q.length <= 300 ? q : undefined;
  return (
    <main id="main" className="page">
      <div className="page-grid">
        <ScanPanel initial={initial}>
          <span className="kicker mono">Scan</span>
          <h1 className="title" style={{ marginTop: 12 }}>
            What would your agent read?
          </h1>
          <p className="sub">
            Paste a token address, an NFT as 0x…#id, or a name like dana.base.eth. We read every field an agent would read and mark the
            lines written for machines.
          </p>
        </ScanPanel>
      </div>
    </main>
  );
}

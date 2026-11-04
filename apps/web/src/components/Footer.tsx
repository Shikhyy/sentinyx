import Link from "next/link";
import { FooterBand } from "./FooterBand";
import { PaletteHint } from "./PaletteHint";
import { Wordmark } from "./Wordmark";

const REPO = process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/Shikhyy/sentinyx";

interface Item {
  label: string;
  href: string;
  external?: boolean;
  download?: boolean;
}
const COLUMNS: { title: string; items: Item[] }[] = [
  {
    title: "Product",
    items: [
      { label: "Scan", href: "/scan" },
      { label: "Night Ledger", href: "/ledger" },
      { label: "Use it", href: "/use" },
      { label: "Guard", href: "/guard" },
      { label: "Attack Lab", href: "/guard/lab" },
    ],
  },
  {
    title: "Learn",
    items: [
      { label: "How it works", href: "/#how" },
      { label: "Morning brief", href: "/guard" },
      { label: "Traces", href: "/guard/traces" },
      { label: "Source", href: REPO, external: true },
    ],
  },
  {
    title: "Open data",
    items: [
      { label: "Ledger CSV", href: "/ledger/data.csv", download: true },
      { label: "Ledger JSON", href: "/ledger/data.json", download: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="site">
      <div className="foot-band" aria-hidden="true">
        <FooterBand />
      </div>

      <div className="foot-main">
        <div className="foot-lede">
          <h2>Read everything. Obey nothing.</h2>
          <p>Paste a token, an NFT or a name and see every line an AI agent would read, before it acts on one.</p>
          <Link className="btn btn-night" href="/scan">
            Scan a token
          </Link>
        </div>

        <nav className="foot-cols" aria-label="Footer">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="foot-h">{col.title}</h2>
              <ul className="foot-links">
                {col.items.map((it) => (
                  <li key={it.label}>
                    {it.external ? (
                      <a href={it.href} target="_blank" rel="noopener noreferrer">
                        <span>{it.label}</span>
                        <span className="lead" aria-hidden="true" />
                        <span className="arr" aria-hidden="true">↗</span>
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : it.download ? (
                      <a href={it.href} download>
                        <span>{it.label}</span>
                        <span className="lead" aria-hidden="true" />
                        <span className="arr" aria-hidden="true">↓</span>
                      </a>
                    ) : (
                      <Link href={it.href}>
                        <span>{it.label}</span>
                        <span className="lead" aria-hidden="true" />
                        <span className="arr" aria-hidden="true">→</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="foot-bar mono">
        <span>© {new Date().getFullYear()} Sentinyx · Built for Vibeathon 02</span>
        <PaletteHint />
        <span>Scans can be wrong. Every report has a form to report a false positive.</span>
      </div>

      <Wordmark />
    </footer>
  );
}

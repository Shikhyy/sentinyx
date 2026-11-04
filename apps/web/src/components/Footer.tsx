import Link from "next/link";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="site">
      <div className="foot-row mono">
        <span>Built for Vibeathon 02</span>
        <span>
          <Link href="/scan">Scan</Link> &nbsp; <Link href="/ledger">Ledger</Link> &nbsp; <Link href="/guard">Guard</Link> &nbsp;{" "}
          <Link href="/#how">How it works</Link>
        </span>
        <span>Scans can be wrong. Report a false positive.</span>
      </div>
      <Wordmark />
    </footer>
  );
}

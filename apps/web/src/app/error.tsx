"use client";

import Link from "next/link";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="page">
      <div className="receipt err-receipt" role="alert">
        <div className="r-head">
          <span>Something broke</span>
          <span>Error</span>
        </div>
        <div className="r-quote static">That page failed to load. Nothing you scanned was lost. Try again, or start a new scan.</div>
      </div>
      <div className="btns" style={{ marginTop: 24 }}>
        <button className="btn btn-dark" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-chip" href="/scan">
          Scan something
        </Link>
      </div>
    </main>
  );
}

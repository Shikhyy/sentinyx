import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="page">
      <div className="receipt err-receipt">
        <div className="r-head">
          <span>Not found</span>
          <span>404</span>
        </div>
        <div className="r-quote static">There is nothing at this address. The report may have been mistyped.</div>
      </div>
      <div className="btns" style={{ marginTop: 24 }}>
        <Link className="btn btn-dark" href="/scan">
          Scan something
        </Link>
      </div>
    </main>
  );
}

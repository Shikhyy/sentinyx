"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { ScanReport } from "@sentinyx/scanner";
import { BAD_TARGET_COPY, CHAIN_CHOICES, EXAMPLES, type ChainChoice } from "@/lib/copy";
import { GLY, prefersReducedMotion } from "@/lib/scramble";
import { ReceiptReveal } from "./ReceiptReveal";
import { ReportReceipt } from "./ReportReceipt";

type Done = ScanReport & { id: string; url: string };
type State =
  | { s: "idle" }
  | { s: "loading"; target: string }
  | { s: "error"; message: string }
  | { s: "done"; report: Done };

const PENDING_ROWS = ["Name", "Symbol", "Contract metadata", "Source comments"];

function Pending() {
  const [txt, setTxt] = useState("······");
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setTxt(Array.from({ length: 6 }, () => GLY[(Math.random() * GLY.length) | 0]).join("")), 90);
    return () => clearInterval(id);
  }, []);
  return <span className="st">{txt}</span>;
}

/**
 * Scan input plus the receipt it fills. `inline` shows the result in place (landing page);
 * otherwise a finished scan navigates to its shareable report page.
 */
export function ScanPanel({ inline = false, initial, children }: { inline?: boolean; initial?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [value, setValue] = useState(initial ?? "");
  const [chain, setChain] = useState<ChainChoice>("auto");
  const [state, setState] = useState<State>({ s: "idle" });
  const [slow, setSlow] = useState(false);

  useEffect(() => () => abort.current?.abort(), []);
  // A link like /scan?target=0x… (from a badge or a shared message) runs the scan straight away.
  useEffect(() => {
    if (initial) void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (state.s !== "loading") {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, [state.s]);

  async function run(raw: string, network: ChainChoice = chain) {
    const target = raw.trim();
    if (!target) {
      setState({ s: "error", message: BAD_TARGET_COPY });
      inputRef.current?.focus();
      return;
    }
    abort.current?.abort();
    const ctrl = (abort.current = new AbortController());
    setState({ s: "loading", target });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(network === "auto" ? { target } : { target, chain: network }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ s: "error", message: typeof data.error === "string" ? data.error : "The scan failed. Try again." });
        return;
      }
      if (inline) setState({ s: "done", report: data as Done });
      else router.push(data.url as string);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState({ s: "error", message: "Could not reach the scanner. Check your connection and try again." });
    }
  }

  const loading = state.s === "loading";
  return (
    <>
      <div>
        {children}
        <form
          className="scan-form"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void run(value);
          }}
        >
          <label className="mono" htmlFor={inputId}>
            Token, NFT or ENS name
          </label>
          <div className="scan-field">
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              inputMode="text"
              spellCheck={false}
              autoCapitalize="off"
              placeholder="0x… or name.base.eth"
              value={value}
              maxLength={300}
              onChange={(e) => setValue(e.target.value)}
              aria-describedby={state.s === "error" ? `${inputId}-err` : undefined}
            />
            <button className="btn btn-dark" type="submit" disabled={loading}>
              {loading ? "Reading" : "Scan"}
            </button>
          </div>
          {state.s === "error" ? (
            <p className="form-error" id={`${inputId}-err`} role="alert">
              {state.message}
            </p>
          ) : null}
          <div className="chain-pick" role="radiogroup" aria-label="Network">
            <span className="mono chain-label">Network</span>
            {CHAIN_CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={chain === c.value}
                className={"mono" + (chain === c.value ? " on" : "")}
                disabled={loading}
                onClick={() => setChain(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="tries mono">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.value}
                type="button"
                disabled={loading}
                onClick={() => {
                  const network = ex.chain ?? "auto";
                  setValue(ex.value);
                  setChain(network);
                  void run(ex.value, network);
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
          <span className="demo-note mono">Live scanner. Auto tries Base, then Base Sepolia. Reports get a shareable link.</span>
        </form>
      </div>

      <div aria-live="polite">
        {state.s === "done" ? (
          <>
            <ReceiptReveal key={state.report.id}>
              <ReportReceipt report={state.report} className="live" />
            </ReceiptReveal>
            <Link className="more mono" href={state.report.url}>
              Open full report and share link →
            </Link>
          </>
        ) : (
          <div className={"receipt live" + (loading ? " scanning" : "")}>
            <span className="sweep" aria-hidden="true" />
            <div className="r-head">
              <span>{loading ? `Scan / ${state.target.length > 22 ? state.target.slice(0, 6) + "…" + state.target.slice(-4) : state.target}` : "Scan / waiting"}</span>
              <span>{loading ? "Reading…" : "Live"}</span>
            </div>
            {loading ? (
              <>
                {PENDING_ROWS.map((r) => (
                  <div key={r} className="r-line pending">
                    <span>{r}</span>
                    <span className="lead" />
                    <Pending />
                  </div>
                ))}
                {slow ? <p className="reading-note">Still reading metadata. Some hosts are slow.</p> : null}
              </>
            ) : (
              <div className="r-quote show">
                {state.s === "error" ? "Nothing was scanned." : "Paste something on the left and press Scan."}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

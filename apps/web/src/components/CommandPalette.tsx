"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildRows, type Row } from "@/lib/palette";

/**
 * Press ⌘K (or Ctrl K) anywhere: paste an address, an NFT or a name and scan it, or jump to a page.
 * Scanning from here is the same request as the Scan page, so the same limits and errors apply.
 */
export function CommandPalette() {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const abort = useRef<AbortController | null>(null);

  const rows: Row[] = useMemo(() => buildRows(q), [q]);

  const close = useCallback(() => {
    abort.current?.abort();
    setOpen(false);
    setQ("");
    setActive(0);
    setBusy(false);
    setError("");
    returnTo.current?.focus?.();
  }, []);

  // open with ⌘K / Ctrl K, or from the footer hint
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (!o) returnTo.current = document.activeElement as HTMLElement | null;
          return !o;
        });
      } else if (e.key === "Escape") close();
    };
    const onOpen = () => {
      returnTo.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    addEventListener("keydown", onKey);
    addEventListener("sentinyx:palette", onOpen);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("sentinyx:palette", onOpen);
    };
  }, [close]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => setActive(0), [q]);

  async function scan(value: string) {
    abort.current?.abort();
    const ctrl = (abort.current = new AbortController());
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: value }), signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "The scan failed. Try again.");
        setBusy(false);
        return;
      }
      close();
      router.push(data.url as string);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("Could not reach the scanner. Check your connection and try again.");
      setBusy(false);
    }
  }

  function run(row: Row) {
    if (row.scan) return void scan(row.scan);
    const c = row.cmd!;
    if (c.external) window.open(c.href, "_blank", "noopener,noreferrer");
    else if (c.download) {
      const a = document.createElement("a");
      a.href = c.href;
      a.download = "";
      a.click();
    } else router.push(c.href);
    close();
  }

  if (!open) return null;
  const optId = (i: number) => `${uid}-opt-${i}`;
  let lastGroup = "";

  return (
    <div className="pal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Quick scan and navigation">
        <div className="pal-top">
          <label className="mono pal-label" htmlFor={`${uid}-q`}>
            Scan or jump to
          </label>
          <input
            id={`${uid}-q`}
            ref={input}
            className="pal-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={rows.length ? optId(active) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder="0x… or name.base.eth, or a page"
            value={q}
            maxLength={300}
            disabled={busy}
            onChange={(e) => {
              setQ(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (rows[active]) run(rows[active]);
              } else if (e.key === "Tab") e.preventDefault(); // focus stays on the field; arrows move the selection
            }}
          />
        </div>

        <ul className="pal-list" id={`${uid}-list`} role="listbox" aria-label="Results">
          {rows.map((r, i) => {
            const head = r.group !== lastGroup;
            lastGroup = r.group;
            return (
              <li key={r.key} role="presentation">
                {head ? <div className="pal-group mono">{r.group}</div> : null}
                <div
                  id={optId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={"pal-row mono" + (i === active ? " on" : "")}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(r)}
                >
                  <span>{r.label}</span>
                  <span className="lead" aria-hidden="true" />
                  <span>{r.right}</span>
                </div>
              </li>
            );
          })}
          {rows.length === 0 ? (
            <li role="presentation" className="pal-empty">
              Nothing matches. Paste a Base address (0x…) or a name ending in .eth to scan it.
            </li>
          ) : null}
        </ul>

        <div className="pal-foot mono" aria-live="polite">
          {busy ? <span>Reading…</span> : error ? <span className="pal-err">{error}</span> : <span>↑↓ move · ↵ open · esc close</span>}
        </div>
      </div>
    </div>
  );
}

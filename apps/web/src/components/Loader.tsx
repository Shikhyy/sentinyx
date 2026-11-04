"use client";

import { useEffect, useState } from "react";

const KEY = "sx-seen";
const STEPS = ["Fonts", "Page", "Scanner"] as const;
const MIN_MS = 700;
const STEP_MS = 170;
const GIVE_UP_MS = 4000;

/** Marks the site as ready so the landing page can start its own intro. */
function announceReady() {
  document.documentElement.dataset.sxReady = "1";
  dispatchEvent(new Event("sx:ready"));
}

/**
 * A first-visit curtain. Each row flips to READY when the thing it names really is ready:
 * fonts loaded, page loaded, the app hydrated. Returning visitors in the same tab never see it.
 */
export function Loader() {
  const [ready, setReady] = useState([false, false, false]);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");

  useEffect(() => {
    if (document.documentElement.dataset.sx === "seen") {
      setPhase("gone");
      announceReady();
      return;
    }
    const mark = (i: number) => setReady((r) => (r[i] ? r : r.map((v, j) => (j === i ? true : v))));
    mark(2);
    (document.fonts?.ready ?? Promise.resolve()).then(() => mark(0), () => mark(0));
    if (document.readyState === "complete") mark(1);
    else {
      const onLoad = () => mark(1);
      addEventListener("load", onLoad, { once: true });
    }
    const giveUp = setTimeout(() => setReady([true, true, true]), GIVE_UP_MS);
    return () => clearTimeout(giveUp);
  }, []);

  // Reveal rows one at a time so the receipt reads as it fills.
  useEffect(() => {
    if (phase !== "show" || shown >= STEPS.length || !ready[shown]) return;
    const t = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [ready, shown, phase]);

  const [t0] = useState(() => (typeof performance === "undefined" ? 0 : performance.now()));
  useEffect(() => {
    if (phase !== "show" || shown < STEPS.length) return;
    const wait = Math.max(0, MIN_MS - (performance.now() - t0));
    const lift = setTimeout(() => {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        /* private mode: the curtain just shows again next time */
      }
      setPhase("leave");
      announceReady();
    }, wait);
    return () => clearTimeout(lift);
  }, [shown, phase, t0]);

  useEffect(() => {
    if (phase !== "leave") return;
    const gone = setTimeout(() => setPhase("gone"), 800);
    return () => clearTimeout(gone);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div className={`loader${phase === "leave" ? " leave" : ""}`} role="status" aria-live="polite" aria-label="Loading Sentinyx">
      <noscript>
        <style>{".loader{display:none!important}"}</style>
      </noscript>
      <div className="loader-card mono">
        <div className="loader-head">
          <span>Sentinyx</span>
          <span>{shown >= STEPS.length ? "Ready" : "Loading"}</span>
        </div>
        {STEPS.map((label, i) => {
          const done = i < shown;
          const active = i === shown;
          return (
            <div key={label} className={`loader-row${done ? " ok" : active ? " wait" : ""}`}>
              <span>{label}</span>
              <i />
              <span>{done ? "Ready" : active ? "…" : ""}</span>
            </div>
          );
        })}
        <p className="loader-line">Every token talks. Some give orders.</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, scrambleTo } from "@/lib/scramble";
import { veilFor } from "@/lib/report-view";

/**
 * Hidden instructions are invisible in the original text, so the report keeps them veiled until you choose to decode them:
 * the point of the product, as an interaction. The text is attacker-controlled, so it is only ever a text node.
 * Screen readers always get it, and so does anyone with scripts off.
 */
export function HiddenText({ text }: { text: string }) {
  const [decoded, setDecoded] = useState(false);
  const out = useRef<HTMLSpanElement>(null);
  const v = veilFor(text);

  useEffect(() => {
    if (decoded && out.current && !prefersReducedMotion()) return scrambleTo(out.current, `“${text}”`, Math.min(1400, 350 + text.length * 14));
  }, [decoded, text]);

  return (
    <div className="r-quote static hidden-quote">
      <span className="qlabel">Hidden text (invisible to people)</span>
      <noscript>“{text}”</noscript>
      <span className="sr-only">“{text}”</span>
      {decoded ? (
        <span ref={out} className="decoded" aria-hidden="true">
          “{text}”
        </span>
      ) : (
        <>
          <span className="veil" aria-hidden="true">
            {v.bar}
          </span>
          <span className="veil-row">
            <span className="veil-cap" aria-hidden="true">
              {v.caption}
            </span>
            <button type="button" className="decode mono" onClick={() => setDecoded(true)}>
              Decode
            </button>
          </span>
        </>
      )}
    </div>
  );
}

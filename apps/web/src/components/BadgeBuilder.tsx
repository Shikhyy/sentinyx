"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { CodeBlock } from "./CodeBlock";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Type an address, get a badge preview and the Markdown to paste into a README or site. */
export function BadgeBuilder({ site }: { site: string }) {
  const id = useId();
  const [value, setValue] = useState("");
  const v = value.trim();
  const ok = ADDRESS.test(v);
  const md = `[![Sentinyx scan](${site}/badge/${v}.svg)](${site}/scan?target=${v})`;
  return (
    <div className="badge-builder">
      <label className="mono" htmlFor={id}>
        Your token or NFT contract
      </label>
      <input id={id} className="badge-input mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" inputMode="text" />
      {v && !ok ? <p className="form-error">That is not a 40-character 0x address.</p> : null}
      {ok ? (
        <>
          <div className="badge-preview">
            {/* A dynamic SVG from our own route; next/image adds nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/badge/${v}.svg`} alt="Sentinyx scan badge for this contract" height={22} />
            <span className="mono">
              Reads the latest scan. <Link href={`/scan?target=${v}`}>Scan it</Link> to update it.
            </span>
          </div>
          <CodeBlock label="Markdown" code={md} />
        </>
      ) : null}
    </div>
  );
}

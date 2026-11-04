"use client";

import { useEffect, useState } from "react";

/** A code sample with a copy button. The text is rendered as a plain text node. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <div className="codeblock">
      <div className="codeblock-bar mono">
        <span>{label}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setDone(true);
            } catch {
              window.prompt("Copy this", code);
            }
          }}
        >
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

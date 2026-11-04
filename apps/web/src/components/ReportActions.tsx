"use client";

import { useEffect, useId, useState } from "react";

export function CopyLink() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      className="btn btn-chip"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          setDone(true);
        } catch {
          window.prompt("Copy this link", location.href);
        }
      }}
    >
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

export function ShareOnX({ text }: { text: string }) {
  const [href, setHref] = useState("#");
  useEffect(() => {
    setHref(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.href)}`);
  }, [text]);
  return (
    <a className="btn btn-dark" href={href} target="_blank" rel="noopener noreferrer">
      Share on X
    </a>
  );
}

export function FalsePositive({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const f = useId();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Could not save that. Try again.");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setErr("Could not reach the server. Try again.");
      setState("error");
    }
  }

  if (state === "sent") return <span>Thanks. Your note is saved with this report.</span>;
  return (
    <>
      <button type="button" className="linklike" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ font: "inherit", textTransform: "inherit", background: "none", border: 0, padding: "12px 0", minHeight: 44, textDecoration: "underline", cursor: "pointer", color: "inherit" }}>
        Report a false positive
      </button>
      {open ? (
        <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420, marginTop: 4 }}>
          <label htmlFor={f} className="mono">What did we get wrong?</label>
          <textarea id={f} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} required
            style={{ font: "inherit", textTransform: "none", padding: 10, border: "1px solid var(--graphite)", background: "transparent", color: "inherit", borderRadius: 6 }} />
          {state === "error" ? <p className="form-error" role="alert">{err}</p> : null}
          <button className="btn btn-chip" type="submit" disabled={state === "sending"} style={{ alignSelf: "flex-start" }}>
            {state === "sending" ? "Sending" : "Send"}
          </button>
        </form>
      ) : null}
    </>
  );
}

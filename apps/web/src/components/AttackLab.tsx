"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GLY, prefersReducedMotion, scrambleTo } from "@/lib/scramble";

export interface LabProps {
  scenarios: {
    id: string;
    number: string;
    title: string;
    kind: "onchain" | "code";
    task: string;
    value: string;
    off: { log: Line[]; word: string; row: string };
    on: { log: Line[]; word: string; outcome: string; traceId: string; reason: string };
  }[];
  initial: string;
  recordedAt: string;
}
interface Line {
  who: "agent" | "tool" | "guard" | "system";
  text: string;
  label?: string;
}

const STEP = 1000; // ms between log lines
const TO_GATE = 1600; // ms for the value to reach the gate
const TO_ACTION = 1000; // and on to the action, when nothing stops it

type Phase = "ready" | "running" | "done";

function timing(log: Line[]) {
  const firstTool = log.findIndex((l) => l.who === "tool");
  const start = (firstTool >= 0 ? firstTool : Math.max(1, log.length - 2)) * STEP + 400;
  const lastAgent = log.map((l) => l.who).lastIndexOf("agent");
  return { start, end: Math.max(log.length * STEP, start + TO_GATE + TO_ACTION) + 300, lastAgent };
}

export function AttackLab({ scenarios, initial, recordedAt }: LabProps) {
  const [sel, setSel] = useState(scenarios.find((s) => s.id === initial)?.id ?? scenarios[0].id);
  const [guardOn, setGuardOn] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [shown, setShown] = useState(0);
  const [word, setWord] = useState("READY");
  const wordRef = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const t0 = useRef(0);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);

  const sc = scenarios.find((s) => s.id === sel)!;
  const run = guardOn ? sc.on : sc.off;
  const log = run.log;
  const tm = timing(log);

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(raf.current);
  }, []);
  useEffect(() => clearAll, [clearAll]);

  // ---- drawing: a pure function of elapsed time, so the final frame is the same as the animated one ----
  const draw = useCallback(
    (elapsed: number) => {
      const c = cv.current;
      if (!c) return;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const r = c.getBoundingClientRect();
      if (c.width !== Math.floor(r.width * dpr)) {
        c.width = Math.floor(r.width * dpr);
        c.height = Math.floor(r.height * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width;
      const H = r.height;
      const cs = getComputedStyle(c);
      const ink = cs.getPropertyValue("--night-ink").trim() || "#E9E6DF";
      const ash = cs.getPropertyValue("--night-ash").trim() || "#8C8982";
      const signal = cs.getPropertyValue("--signal").trim() || "#FF5F1F";
      const night = cs.getPropertyValue("--night").trim() || "#1C1C1B";
      ctx.clearRect(0, 0, W, H);
      ctx.font = `500 11.5px ${cs.fontFamily}`;
      ctx.textBaseline = "middle";

      const rowA = Math.round(H * 0.25);
      const rowB = Math.round(H * 0.7);
      const mobile = W < 520;
      const xLabel = Math.round(W * (mobile ? 0.3 : 0.27));
      const xValue = Math.round(W * (mobile ? 0.5 : 0.45));
      const xGate = Math.round(W * (mobile ? 0.7 : 0.66));
      const xAction = Math.round(W - (mobile ? 38 : 56));
      const xPlanner = Math.round(W * 0.4);
      const bw = (t: string) => ctx.measureText(t).width + 16;

      const box = (t: string, cx: number, cy: number, fill?: string, color?: string) => {
        const w = bw(t);
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(cx - w / 2, cy - 11, w, 22);
        } else {
          ctx.strokeStyle = ash;
          ctx.lineWidth = 1;
          ctx.strokeRect(cx - w / 2 + 0.5, cy - 10.5, w, 21);
        }
        ctx.fillStyle = color ?? ink;
        ctx.textAlign = "center";
        ctx.fillText(t, cx, cy + 0.5);
        ctx.textAlign = "left";
      };
      const line = (x1: number, y1: number, x2: number, y2: number, color = ash) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      // lane A: your task, trusted, goes through the planner to the action
      ctx.fillStyle = ash;
      ctx.fillText("YOUR TASK", 8, rowA);
      line(78, rowA, xPlanner - bw("PLANNER") / 2, rowA, ink);
      box("PLANNER", xPlanner, rowA);
      line(xPlanner + bw("PLANNER") / 2, rowA, xAction, rowA, ink);
      line(xAction, rowA, xAction, rowB - 14, ink);

      // lane B: untrusted source, labelled, becomes a value, hits the gate
      ctx.fillStyle = ash;
      ctx.fillText("SOURCE", 8, rowB);
      const xs = 62;
      line(xs, rowB, xLabel - bw("LABEL") / 2, rowB);
      box("LABEL", xLabel, rowB);
      line(xLabel + bw("LABEL") / 2, rowB, xValue - bw("VALUE") / 2, rowB);
      box("VALUE", xValue, rowB);
      line(xValue + bw("VALUE") / 2, rowB, xGate - 20, rowB);
      line(xGate + 20, rowB, xAction - 30, rowB);

      const started = elapsed >= tm.start;
      const since = elapsed - tm.start;
      const travel = Math.min(1, since / TO_GATE);
      const reachedGate = started && since >= TO_GATE;
      const passed = !guardOn && started && since >= TO_GATE + TO_ACTION;
      const blockedNow = guardOn && reachedGate;

      // the value: a run of characters travelling along lane B
      const val = sc.value;
      if (started && !passed) {
        const chars = val.length;
        const x0 = xs + 6;
        const stop = guardOn ? xGate - 24 : xAction - 32;
        const headX = guardOn
          ? x0 + (xGate - 24 - x0) * travel
          : x0 + (stop - x0) * Math.min(1, since / (TO_GATE + TO_ACTION));
        const tick = Math.floor(elapsed / 70);
        ctx.fillStyle = signal;
        for (let i = 0; i < chars; i++) {
          const x = headX - i * 8;
          if (x < x0) continue;
          if (blockedNow) {
            // piled up at the gate, scrambling
            const jx = (Math.sin(i * 12.9898 + tick * 0.7) * 0.5 + 0.5) * 34;
            const jy = Math.sin(i * 7.31 + tick) * 12;
            const g = GLY[(Math.abs(Math.sin(i * 3.1 + tick * 1.3)) * GLY.length) | 0];
            ctx.fillText(g, xGate - 28 - jx, rowB + jy);
          } else {
            ctx.fillText(val[chars - 1 - i] ?? "", x, rowB);
          }
        }
      }

      // gate
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.fillText("▌GATE▐", xGate, rowB + 0.5);
      if (blockedNow) {
        ctx.fillStyle = signal;
        ctx.beginPath();
        ctx.arc(xGate, rowB - 18, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ink;
        ctx.fillText(run.word === "HELD" ? "HELD" : "DENIED", xGate, rowB + 22);
      }
      ctx.textAlign = "left";

      // action: inverts when the value gets through
      if (passed) box(sc.off.row, xAction, rowB, ink, night);
      else box("ACTION", xAction, rowB);
    },
    [guardOn, run.word, sc, tm.start],
  );

  // redraw the idle/final state when the selection or switch changes
  useEffect(() => {
    if (phase === "running") return;
    draw(phase === "done" ? 1e9 : 0);
  }, [draw, phase, sel, guardOn]);
  useEffect(() => {
    const onResize = () => phase !== "running" && draw(phase === "done" ? 1e9 : 0);
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [draw, phase]);

  function reset(next?: { sel?: string; guard?: boolean }) {
    clearAll();
    if (next?.sel !== undefined) setSel(next.sel);
    if (next?.guard !== undefined) setGuardOn(next.guard);
    setPhase("ready");
    setShown(0);
    setWord("READY");
  }

  function launch() {
    clearAll();
    setPhase("running");
    setWord("RUNNING");
    if (prefersReducedMotion()) {
      setShown(log.length);
      setPhase("done");
      setWord(run.word);
      return;
    }
    setShown(0);
    t0.current = performance.now();
    log.forEach((_, i) => timers.current.push(window.setTimeout(() => setShown(i + 1), i * STEP + 150)));
    const loop = () => {
      const e = performance.now() - t0.current;
      draw(e);
      if (e < tm.end) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    timers.current.push(
      window.setTimeout(() => {
        setPhase("done");
        setWord(run.word);
      }, tm.end),
    );
  }

  // scramble the big word when it changes
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (wordRef.current && word !== "RUNNING") scrambleTo(wordRef.current, word, 420);
  }, [word]);

  const done = phase === "done";
  const sentence = !done
    ? phase === "running"
      ? "The agent is working. Watch the red value travel."
      : "Pick an attack, choose whether Guard is on, and launch it."
    : guardOn
      ? `Guard ${run.word === "HELD" ? "held" : "denied"} it: ${(sc.on.reason || "").replace(/0x[a-fA-F0-9]{40}/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`)}`
      : sc.kind === "onchain"
        ? "The agent obeyed text it read and the wallet signed. In this sandbox no chain is touched, but a real wallet would have sent the funds."
        : "The agent followed the instruction and ran it. In this sandbox nothing really executes, but a real shell would have.";

  return (
    <div className="lab-grid">
      <div className="lab-left">
        <span className="kicker mono">Choose an attack</span>
        <div className="receipt lab-list" role="radiogroup" aria-label="Attack scenarios">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === sel}
              className={"lab-row" + (s.id === sel ? " inv" : "")}
              onClick={() => reset({ sel: s.id })}
              disabled={phase === "running"}
            >
              <span>
                {s.number} {s.title}
              </span>
              <span className="lead" />
              <span>{s.kind === "onchain" ? "Onchain" : "Code"}</span>
            </button>
          ))}
        </div>

        <p className="lab-task">
          <span className="mono">Agent task</span>
          {sc.task}
        </p>

        <div className="lab-controls">
          <button
            type="button"
            role="switch"
            aria-checked={guardOn}
            className={"lab-switch mono" + (guardOn ? " on" : "")}
            onClick={() => reset({ guard: !guardOn })}
            disabled={phase === "running"}
          >
            <span className="knob" aria-hidden="true" />
            Guard {guardOn ? "on" : "off"}
          </button>
          <button type="button" className="btn btn-dark" onClick={launch} disabled={phase === "running"}>
            {phase === "running" ? "Running" : done ? "Launch again" : "Launch attack"}
          </button>
        </div>
        <p className="demo-note mono">
          Recorded run. The agent is scripted and the wallet is a sandbox with no chain. Guard’s decisions are the real output of the sentinyx
          binary, recorded {recordedAt.slice(0, 10)}.
        </p>
      </div>

      <div className="lab-right">
        <div className="lab-result" aria-live="polite">
          <div className="lab-word" ref={wordRef} data-state={done ? (guardOn ? "guarded" : "executed") : "idle"}>
            {word}
          </div>
          <p className="lab-sentence">{sentence}</p>
          {done && guardOn ? (
            <Link className="btn btn-chip" href={`/guard/traces/${sc.on.traceId}`}>
              See the trace
            </Link>
          ) : null}
        </div>

        <div className="lab-panel">
          <div className="lab-head mono">
            <span>Provenance trace</span>
            <span>{guardOn ? "Guard on" : "Guard off"}</span>
          </div>
          <canvas ref={cv} className="lab-canvas" role="img" aria-label={`Two lanes. Your task goes through the planner. The untrusted ${sc.value} goes through a label, becomes a value and reaches the gate, ${guardOn ? "where Guard stops it" : "which is off, so it reaches the action"}.`} />
        </div>

        <div className="receipt lab-checks">
          <div className="r-head">
            <span>Checks</span>
            <span>{done ? "Done" : "Waiting"}</span>
          </div>
          <Check name="Policy" value={!done ? "······" : guardOn ? run.word.replace("BLOCKED", "DENY") : "Off"} hit={done && guardOn} />
          <Check name="Simulation" value={!done ? "······" : "Not run"} />
          <Check name="Wallet" value={!done ? "······" : guardOn ? "Nothing sent" : "Sandbox, no chain"} hit={done && !guardOn} />
        </div>

        <div className="lab-log" aria-label="Agent log">
          <div className="lab-head mono">
            <span>Agent log</span>
            <span>{shown}/{log.length}</span>
          </div>
          {log.slice(0, shown).map((l, i) => (
            <p key={`${sel}-${guardOn}-${i}`} className={`log-line ${l.who}`}>
              <span className="who mono">{l.who}</span>
              <span className="msg">
                {l.label ? <span className="lbl mono">{l.label}</span> : null}
                {l.text.length > 320 ? l.text.slice(0, 320) + "…" : l.text}
              </span>
            </p>
          ))}
          {shown === 0 ? <p className="log-line system"><span className="who mono">system</span><span className="msg">Nothing yet.</span></p> : null}
        </div>
      </div>
    </div>
  );
}

function Check({ name, value, hit }: { name: string; value: string; hit?: boolean }) {
  return (
    <div className={"r-line" + (hit ? " hit" : "")}>
      <span>{name}</span>
      <span className="lead" />
      <span className="st">{value}</span>
    </div>
  );
}

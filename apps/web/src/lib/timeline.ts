import type { TraceView } from "./traces";

export interface TickItem {
  trace: TraceView;
  /** Percent from the left edge. */
  left: number;
  /** Label row for blocked ticks: 0 or 1, or null when there is no room (the hover popover still has the details). */
  row: 0 | 1 | null;
}

const STEPS = [10, 30, 60, 300, 900, 1800, 3600, 10800, 21600].map((s) => s * 1000);
const p2 = (n: number) => String(n).padStart(2, "0");

function label(ms: number, step: number) {
  const d = new Date(ms);
  return step < 60_000 ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}` : `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** Spread points apart so ticks that happened seconds apart stay individually visible. Order is preserved. */
export function spread(positions: number[], minGap: number, max = 100): number[] {
  const out = [...positions];
  for (let i = 1; i < out.length; i++) if (out[i] - out[i - 1] < minGap) out[i] = out[i - 1] + minGap;
  const over = out.length ? out[out.length - 1] - max : 0;
  if (over > 0) for (let i = out.length - 1; i >= 0; i--) out[i] = Math.max(0, out[i] - over * (1 - (out.length - 1 - i) / out.length));
  return out;
}

/** Lay traces out on a time axis that fits the data, from seconds to hours. */
export function layout(traces: TraceView[]) {
  if (traces.length === 0) return { items: [] as TickItem[], ticks: [] as { left: number; label: string }[], start: 0, end: 0 };
  const sorted = [...traces].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const times = sorted.map((t) => Date.parse(t.createdAt));
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const span = Math.max(t1 - t0, 60_000);
  const pad = Math.max(span * 0.08, 20_000);
  const start = t0 - pad;
  const end = t0 + span + pad;
  const pct = (t: number) => ((t - start) / (end - start)) * 100;
  const lefts = spread(times.map(pct), 1.8, 97).map((l) => Math.min(Math.max(l, 1), 98));
  // A label is about 11% of the axis wide. Put it on the first row with room; otherwise leave it off rather than overlap.
  const LABEL_W = 11;
  const lastLeft: [number, number] = [-Infinity, -Infinity];
  const items: TickItem[] = sorted.map((trace, i) => {
    let row: 0 | 1 | null = null;
    if (trace.decision === "deny") {
      for (const r of [0, 1] as const) {
        if (lefts[i] - lastLeft[r] >= LABEL_W) {
          row = r;
          lastLeft[r] = lefts[i];
          break;
        }
      }
    }
    return { trace, left: lefts[i], row };
  });
  const step = STEPS.find((s) => (end - start) / s <= 7) ?? STEPS[STEPS.length - 1];
  const ticks: { left: number; label: string }[] = [];
  for (let t = Math.ceil(start / step) * step; t < end; t += step) ticks.push({ left: pct(t), label: label(t, step) });
  return { items, ticks, start, end };
}

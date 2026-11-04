import type { Decision, Store, TraceEntry } from "@sentinyx/store";
import labData from "@/data/lab-runs.json";

export type TraceSource = "live" | "lab";
export interface TraceView extends TraceEntry {
  source: TraceSource;
}

/* ---------- recorded Attack Lab runs ---------- */

export interface LabLine {
  who: "agent" | "tool" | "guard" | "system";
  text: string;
  label?: string;
}
export interface LabRun {
  log: LabLine[];
  outcome: string;
  word: string;
}
export interface LabScenario {
  id: string;
  number: string;
  title: string;
  kind: "onchain" | "code";
  agent: string;
  task: string;
  source: string;
  off: LabRun & { row: string };
  on: LabRun & { trace: RawTrace[] };
}
interface RawTrace {
  id: string;
  agent: string;
  action: string;
  args: Record<string, unknown>;
  provenance: Record<string, string>;
  decision: Decision;
  reason: string;
  created_at: string;
}

export const LAB_RECORDED_AT: string = labData.recordedAt;

/** The recorded scenarios, in order. The agent was scripted; the Guard decisions in `on.trace` are real binary output. */
export function labScenarios(): LabScenario[] {
  return [...(labData.scenarios as unknown as LabScenario[])].sort((a, b) => a.number.localeCompare(b.number));
}

const toEntry = (t: RawTrace): TraceEntry => ({
  id: t.id, agent: t.agent, action: t.action, args: t.args ?? {}, provenance: t.provenance ?? {},
  decision: t.decision, reason: t.reason, createdAt: t.created_at,
});

export function labTraces(): TraceView[] {
  return labScenarios().flatMap((s) => s.on.trace.map((t) => ({ ...toEntry(t), source: "lab" as const })));
}

/** Which recorded scenario a trace belongs to, if any. */
export function scenarioOfTrace(id: string): LabScenario | undefined {
  return labScenarios().find((s) => s.on.trace.some((t) => t.id === id));
}

/** Live traces from the store plus the recorded lab traces, newest first. Lab ones are always tagged. */
export async function loadTraces(store: Store, limit = 500): Promise<TraceView[]> {
  let live: TraceEntry[] = [];
  try {
    live = await store.listTraces({ limit });
  } catch (e) {
    console.error("listing traces failed", e);
  }
  const lab = labTraces();
  const seen = new Set(live.map((t) => t.id));
  return [...live.map((t) => ({ ...t, source: "live" as const })), ...lab.filter((t) => !seen.has(t.id))].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function loadTrace(store: Store, id: string): Promise<TraceView | null> {
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  const lab = labTraces().find((t) => t.id === id);
  if (lab) return lab;
  try {
    const t = await store.getTrace(id);
    return t ? { ...t, source: "live" } : null;
  } catch {
    return null;
  }
}

/* ---------- ingest ---------- */

const ID = /^[\w-]{1,64}$/;
const DECISIONS = new Set(["allow", "deny", "hold"]);
export const MAX_INGEST_LINES = 500;

const clip = (s: unknown, n: number) => String(s).slice(0, n);

/** Validate JSON-lines trace output from `sentinyx`. Bad lines are reported, never stored. */
export function parseTraceLines(body: string): { entries: TraceEntry[]; errors: string[] } {
  const entries: TraceEntry[] = [];
  const errors: string[] = [];
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length > MAX_INGEST_LINES) return { entries, errors: [`Too many lines (max ${MAX_INGEST_LINES}).`] };
  lines.forEach((line, i) => {
    const n = i + 1;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      errors.push(`Line ${n}: not valid JSON.`);
      return;
    }
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
    const created = typeof o.created_at === "string" ? Date.parse(o.created_at) : NaN;
    if (typeof o.id !== "string" || !ID.test(o.id)) return void errors.push(`Line ${n}: bad id.`);
    if (typeof o.agent !== "string" || !o.agent || o.agent.length > 64) return void errors.push(`Line ${n}: bad agent.`);
    if (typeof o.action !== "string" || !o.action || o.action.length > 64) return void errors.push(`Line ${n}: bad action.`);
    if (typeof o.decision !== "string" || !DECISIONS.has(o.decision)) return void errors.push(`Line ${n}: bad decision.`);
    if (typeof o.reason !== "string") return void errors.push(`Line ${n}: bad reason.`);
    if (!isObj(o.args) || !isObj(o.provenance)) return void errors.push(`Line ${n}: args and provenance must be objects.`);
    if (!Number.isFinite(created)) return void errors.push(`Line ${n}: bad created_at.`);
    if (JSON.stringify(o.args).length > 8192 || JSON.stringify(o.provenance).length > 4096) return void errors.push(`Line ${n}: too large.`);
    entries.push({
      id: o.id, agent: o.agent, action: o.action, args: o.args, decision: o.decision as Decision,
      provenance: Object.fromEntries(Object.entries(o.provenance).map(([k, v]) => [clip(k, 80), clip(v, 120)])),
      reason: clip(o.reason, 500), createdAt: new Date(created).toISOString(),
    });
  });
  return { entries, errors };
}

/* ---------- display ---------- */

export const isUntrusted = (label: string) => label.startsWith("untrusted:");

const ADDR = /0x[a-fA-F0-9]{40}/g;
export const shortAddrs = (s: string) => s.replace(ADDR, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`);

/** A one-line title for a trace, e.g. `SEND_USDC → 0x7a3F…c91E`. */
export function actionTitle(t: Pick<TraceEntry, "action" | "args">): string {
  const a = t.args ?? {};
  const pick = (...keys: string[]) => keys.map((k) => a[k]).find((v) => typeof v === "string" && v) as string | undefined;
  const target = pick("to", "recipient", "spender", "router", "package", "command", "cmd");
  return target ? `${t.action} → ${shortAddrs(target).slice(0, 60)}` : t.action;
}

export interface Summary {
  checked: number;
  blocked: number;
  held: number;
  allowed: number;
  labCount: number;
  agents: { agent: string; count: number; blocked: number; held: number }[];
}

export function summarize(traces: TraceView[]): Summary {
  const by = new Map<string, { agent: string; count: number; blocked: number; held: number }>();
  let blocked = 0, held = 0, allowed = 0, labCount = 0;
  for (const t of traces) {
    if (t.source === "lab") labCount++;
    if (t.decision === "deny") blocked++;
    else if (t.decision === "hold") held++;
    else allowed++;
    const a = by.get(t.agent) ?? { agent: t.agent, count: 0, blocked: 0, held: 0 };
    a.count++;
    if (t.decision === "deny") a.blocked++;
    if (t.decision === "hold") a.held++;
    by.set(t.agent, a);
  }
  return { checked: traces.length, blocked, held, allowed, labCount, agents: [...by.values()].sort((a, b) => b.count - a.count) };
}

export const decisionWord = (d: Decision) => (d === "deny" ? "Denied" : d === "hold" ? "Held" : "Allowed");

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const p2 = (n: number) => String(n).padStart(2, "0");
export const hhmm = (iso: string) => `${p2(new Date(iso).getUTCHours())}:${p2(new Date(iso).getUTCMinutes())}`;
export const dayStamp = (iso: string) => {
  const d = new Date(iso);
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${hhmm(iso)} UTC`;
};

/** Titles are built from agent-supplied arguments, so make invisible characters visible before showing them. */
export const safeAction = (s: string) =>
  s.replace(/[\u{E0000}-\u{E007F}]+/gu, "⟨hidden⟩").replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "⟨·⟩");

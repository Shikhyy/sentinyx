import type { Store } from "@sentinyx/store";

/** Real numbers for the nav ticker. Either part is null until there is something true to say. */
export interface Pulse {
  ledger: { scanned: number; flagged: number; suspicious: number; at: string } | null;
  /** Actions reported by real agents. Recorded Attack Lab runs are never counted here. */
  guard: { checked: number; blocked: number; held: number } | null;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export const STATIC_TICKER = ["Free, no wallet needed", "Reads what your agent reads", "Quick scan: ⌘K or Ctrl K", "Guard ships as one CLI"];

/** The ticker's lines: real facts first, then the standing lines. With no data it is just the standing lines. */
export function pulseItems(pulse: Pulse | null): string[] {
  const out: string[] = [];
  if (pulse?.ledger) {
    const d = new Date(pulse.ledger.at);
    const l = pulse.ledger;
    out.push(
      `Last crawl ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC: ${l.scanned} tokens scanned, ${l.flagged} flagged${l.suspicious ? `, ${l.suspicious} suspicious` : ""}`,
    );
  }
  if (pulse?.guard && pulse.guard.checked > 0) {
    const g = pulse.guard;
    out.push(`Guard: ${g.checked} agent action${g.checked === 1 ? "" : "s"} checked, ${g.blocked} blocked${g.held ? `, ${g.held} held` : ""}`);
  }
  return [...out, ...STATIC_TICKER];
}

export async function getPulse(store: Store): Promise<Pulse> {
  let ledger: Pulse["ledger"] = null;
  let guard: Pulse["guard"] = null;
  try {
    const last = (await store.ledgerSummary()).lastCrawl;
    if (last?.finishedAt) ledger = { scanned: last.scanned, flagged: last.flagged, suspicious: last.suspicious, at: last.finishedAt };
  } catch {
    /* no ledger data is fine */
  }
  try {
    const live = await store.listTraces({ limit: 1000 });
    if (live.length) guard = { checked: live.length, blocked: live.filter((t) => t.decision === "deny").length, held: live.filter((t) => t.decision === "hold").length };
  } catch {
    /* no trace data is fine */
  }
  return { ledger, guard };
}

import { MemoryStore } from "@sentinyx/store";
import { describe, expect, it } from "vitest";
import { getPulse, pulseItems, STATIC_TICKER } from "../src/lib/pulse";

describe("pulseItems", () => {
  it("is just the standing lines when there is no data", () => {
    expect(pulseItems(null)).toEqual(STATIC_TICKER);
    expect(pulseItems({ ledger: null, guard: null })).toEqual(STATIC_TICKER);
  });
  it("leads with the real last crawl", () => {
    const items = pulseItems({ ledger: { scanned: 40, flagged: 0, suspicious: 0, at: "2026-11-04T09:02:00.000Z" }, guard: null });
    expect(items[0]).toBe("Last crawl 09:02 UTC: 40 tokens scanned, 0 flagged");
    expect(items.slice(1)).toEqual(STATIC_TICKER);
  });
  it("mentions suspicious only when there are some", () => {
    const some = pulseItems({ ledger: { scanned: 10, flagged: 1, suspicious: 2, at: "2026-11-04T03:00:00.000Z" }, guard: null })[0];
    expect(some).toContain("1 flagged, 2 suspicious");
  });
  it("reports Guard activity with correct plurals, and nothing for zero actions", () => {
    expect(pulseItems({ ledger: null, guard: { checked: 1, blocked: 1, held: 0 } })[0]).toBe("Guard: 1 agent action checked, 1 blocked");
    expect(pulseItems({ ledger: null, guard: { checked: 5, blocked: 2, held: 1 } })[0]).toBe("Guard: 5 agent actions checked, 2 blocked, 1 held");
    expect(pulseItems({ ledger: null, guard: { checked: 0, blocked: 0, held: 0 } })).toEqual(STATIC_TICKER);
  });
});

describe("getPulse", () => {
  it("is empty for a fresh store (no invented numbers)", async () => {
    expect(await getPulse(new MemoryStore())).toEqual({ ledger: null, guard: null });
  });
  it("uses the latest finished crawl", async () => {
    const s = new MemoryStore();
    const id = await s.startCrawl("src");
    await s.finishCrawl(id, { discovered: 5, scanned: 4, failed: 1, flagged: 1, suspicious: 0 });
    const p = await getPulse(s);
    expect(p.ledger).toMatchObject({ scanned: 4, flagged: 1, suspicious: 0 });
  });
  it("counts only live traces, never the recorded lab runs", async () => {
    const s = new MemoryStore();
    await s.addTraces([
      { id: "a1", agent: "x", action: "send", args: {}, provenance: {}, decision: "deny", reason: "r", createdAt: "2026-11-04T10:00:00.000Z" },
      { id: "a2", agent: "x", action: "send", args: {}, provenance: {}, decision: "allow", reason: "r", createdAt: "2026-11-04T10:01:00.000Z" },
    ]);
    expect((await getPulse(s)).guard).toEqual({ checked: 2, blocked: 1, held: 0 });
  });
});

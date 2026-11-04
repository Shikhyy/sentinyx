import { MemoryStore } from "@sentinyx/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { layout, spread } from "../src/lib/timeline";
import { actionTitle, labScenarios, labTraces, loadTraces, parseTraceLines, scenarioOfTrace, summarize } from "../src/lib/traces";

const line = (o: object = {}) =>
  JSON.stringify({ id: "abc123", agent: "a", action: "send_usdc", args: { to: "0x7a3F00000000000000000000000000000000c91E" }, provenance: { to: "untrusted:tool:x" }, decision: "deny", reason: "r", created_at: "2026-11-04T09:00:00Z", ...o });

describe("recorded Attack Lab runs", () => {
  it("has five scenarios in order, each with real traces and a guard-off run that executed", () => {
    const s = labScenarios();
    expect(s.map((x) => x.number)).toEqual(["01", "02", "03", "04", "05"]);
    for (const sc of s) {
      expect(sc.off.outcome).toBe("executed");
      expect(sc.on.trace.length).toBeGreaterThan(0);
      expect(["deny", "hold"]).toContain(sc.on.outcome);
    }
  });
  it("denies tainted recipients and commands, and holds a steered contract call", () => {
    const by = Object.fromEntries(labScenarios().map((s) => [s.id, s.on.outcome]));
    expect(by).toMatchObject({ "poisoned-coin": "deny", "lookalike-address": "deny", "hallucinated-package": "deny", "malicious-readme": "deny", "steered-router": "hold" });
  });
  it("the guard-on run never says the action went through", () => {
    for (const sc of labScenarios()) expect(sc.on.log.map((l) => l.text).join(" ")).not.toMatch(/the action went through/i);
  });
  it("maps a trace back to its scenario", () => {
    const t = labTraces().find((x) => x.decision === "deny")!;
    expect(scenarioOfTrace(t.id)).toBeDefined();
  });
});

describe("trace ingest parsing", () => {
  it("accepts a valid line and normalises the timestamp", () => {
    const { entries, errors } = parseTraceLines(line());
    expect(errors).toEqual([]);
    expect(entries[0]).toMatchObject({ id: "abc123", decision: "deny", createdAt: "2026-11-04T09:00:00.000Z" });
  });
  it("rejects bad decisions, ids, shapes and dates without storing them", () => {
    for (const bad of [{ decision: "maybe" }, { id: "a b" }, { args: [] }, { provenance: "x" }, { created_at: "nope" }, { agent: "" }]) {
      const r = parseTraceLines(line(bad));
      expect(r.entries, JSON.stringify(bad)).toHaveLength(0);
      expect(r.errors).toHaveLength(1);
    }
    expect(parseTraceLines("not json").errors[0]).toMatch(/not valid JSON/);
  });
  it("keeps good lines when others are bad, and caps the batch size", () => {
    const r = parseTraceLines([line({ id: "g1" }), "garbage", line({ id: "g2" })].join("\n"));
    expect(r.entries.map((e) => e.id)).toEqual(["g1", "g2"]);
    expect(parseTraceLines(Array.from({ length: 501 }, () => line()).join("\n")).errors[0]).toMatch(/Too many/);
  });
});

describe("merging and summaries", () => {
  it("tags lab traces and keeps live ones, newest first, without duplicates", async () => {
    const store = new MemoryStore();
    await store.addTraces([{ id: "live1", agent: "mine", action: "swap", args: {}, provenance: {}, decision: "allow", reason: "ok", createdAt: "2099-01-01T00:00:00.000Z" }]);
    const all = await loadTraces(store);
    expect(all[0]).toMatchObject({ id: "live1", source: "live" });
    expect(all.filter((t) => t.source === "lab").length).toBe(labTraces().length);
    const dup = labTraces()[0];
    await store.addTraces([{ ...dup, source: undefined } as never]);
    expect((await loadTraces(store)).filter((t) => t.id === dup.id)).toHaveLength(1);
  });
  it("counts decisions and agents", () => {
    const s = summarize(labTraces());
    expect(s.checked).toBe(labTraces().length);
    expect(s.blocked + s.held + s.allowed).toBe(s.checked);
    expect(s.held).toBeGreaterThan(0);
    expect(s.labCount).toBe(s.checked);
  });
  it("titles an action by its target", () => {
    expect(actionTitle({ action: "send_usdc", args: { to: "0x7a3F00000000000000000000000000000000c91E" } })).toBe("send_usdc → 0x7a3F…c91E");
  });
});

describe("timeline layout", () => {
  it("handles no traces", () => expect(layout([]).items).toEqual([]));
  it("keeps ticks that happened seconds apart separately visible, in order", () => {
    const { items } = layout(labTraces());
    for (let i = 1; i < items.length; i++) expect(items[i].left).toBeGreaterThanOrEqual(items[i - 1].left);
    expect(items.every((i) => i.left >= 0 && i.left <= 100)).toBe(true);
    expect(new Set(items.map((i) => Math.round(i.left * 10))).size).toBe(items.length);
  });
  it("never puts two labels where they would overlap", () => {
    const { items } = layout(labTraces());
    for (const r of [0, 1]) {
      const lefts = items.filter((i) => i.row === r).map((i) => i.left);
      for (let k = 1; k < lefts.length; k++) expect(lefts[k] - lefts[k - 1]).toBeGreaterThanOrEqual(11);
    }
  });
  it("spreads clustered points by at least the minimum gap", () => {
    const out = spread([50, 50.1, 50.2], 2);
    expect(out[1] - out[0]).toBeGreaterThanOrEqual(2);
    expect(out[2] - out[1]).toBeGreaterThanOrEqual(2);
  });
});

describe("trace ingest route", () => {
  afterEach(() => vi.unstubAllEnvs());
  const post = async (auth?: string, body = line()) => {
    const { POST } = await import("../src/app/api/traces/route");
    return POST(new Request("http://x/api/traces", { method: "POST", body, headers: auth ? { authorization: auth } : {} }));
  };
  it("is closed unless a token is configured", async () => {
    vi.stubEnv("TRACE_INGEST_TOKEN", "");
    expect((await post("Bearer x")).status).toBe(503);
  });
  it("rejects a wrong token and accepts the right one", async () => {
    vi.stubEnv("TRACE_INGEST_TOKEN", "tok-123");
    expect((await post()).status).toBe(401);
    expect((await post("Bearer nope")).status).toBe(401);
    const ok = await post("Bearer tok-123");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: 1, added: 1 });
  });
  it("returns 400 when nothing valid was sent", async () => {
    vi.stubEnv("TRACE_INGEST_TOKEN", "tok-123");
    expect((await post("Bearer tok-123", "garbage")).status).toBe(400);
  });
});

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createServer } from "node:net";
import type { ScanReport } from "@sentinyx/scanner";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore, PgStore, type LedgerItem, type Store, type TraceEntry } from "../src/index.js";

const report = (target: string, verdict: ScanReport["verdict"] = "clean"): ScanReport => ({
  target, kind: "erc20", chain: "base", chainId: 8453, title: "T", fields: [], verdict,
  scannedAt: new Date().toISOString(), method: "v0.1", warnings: [],
});
const item = (id: string, target: string, over: Partial<LedgerItem> = {}): LedgerItem => ({
  id, target, kind: "erc20", field: "Contract metadata", fieldLabel: "Contract metadata description", verdict: "flagged",
  excerptRedacted: "x", findingRules: ["combo.drain", "address.agents"], detectedAt: new Date().toISOString(),
  reviewed: false, label: null, scanId: null, crawlId: 1, ...over,
});
const trace = (id: string, decision: TraceEntry["decision"], createdAt: string): TraceEntry => ({
  id, agent: "a", action: "send", args: { to: "0x1" }, provenance: { to: "untrusted:tool:x" }, decision, reason: "r", createdAt,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

let db: PGlite;
let server: PGLiteSocketServer;
let pgUrl = "";

beforeAll(async () => {
  db = await PGlite.create();
  const port = await freePort();
  server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  pgUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
}, 60_000);
afterAll(async () => {
  await server?.stop();
  await db?.close();
});

// PGlite serves one connection at a time, so the Postgres store is pinned to a single connection here.
const impls: [string, () => Store][] = [
  ["memory", () => new MemoryStore()],
  ["postgres", () => new PgStore(pgUrl, { max: 1 })],
];

describe.each(impls)("Store contract: %s", (name, make) => {
  // Postgres tables persist across the tests, so every test uses ids unique to this implementation.
  const k = (s: string) => `${name}-${s}`;
  let store: Store;
  beforeAll(() => {
    store = make();
  });

  it("saves and loads a scan, including the redacted flag", async () => {
    await store.saveScan({ id: k("scan1"), report: report("0xAAA"), createdAt: new Date().toISOString(), redacted: true });
    const got = await store.getScan(k("scan1"));
    expect(got?.report.target).toBe("0xAAA");
    expect(got?.redacted).toBe(true);
    expect(await store.getScan(k("missing"))).toBeNull();
  });

  it("findRecent returns the newest scan inside the window only", async () => {
    const t = k("0xBBB");
    const old = new Date(Date.now() - 3_600_000).toISOString();
    await store.saveScan({ id: k("old"), report: report(t), createdAt: old });
    expect(await store.findRecent(t, 600_000)).toBeNull();
    await store.saveScan({ id: k("new"), report: report(t), createdAt: new Date().toISOString() });
    expect((await store.findRecent(t, 600_000))?.id).toBe(k("new"));
  });

  it("counts hits within a window and starts over after it", async () => {
    const key = k("rate");
    expect(await store.hit(key, 1)).toBe(1);
    expect(await store.hit(key, 1)).toBe(2);
    expect(await store.hit(key, 1)).toBe(3);
    await sleep(1200);
    expect(await store.hit(key, 1)).toBe(1);
  });

  it("stores feedback", async () => {
    await expect(store.saveFeedback({ scanId: k("scan1"), note: "wrong", createdAt: new Date().toISOString() })).resolves.toBeUndefined();
  });

  it("stores traces idempotently and lists them newest first with a decision filter", async () => {
    const a = trace(k("t1"), "deny", "2026-11-04T09:00:00.000Z");
    const b = trace(k("t2"), "hold", "2026-11-04T09:01:00.000Z");
    expect(await store.addTraces([a, b])).toBe(2);
    expect(await store.addTraces([a])).toBe(0);
    const ids = (await store.listTraces({ limit: 1000 })).map((t) => t.id).filter((i) => i.startsWith(name));
    expect(ids).toEqual([k("t2"), k("t1")]);
    expect((await store.listTraces({ decision: "hold", limit: 1000 })).every((t) => t.decision === "hold")).toBe(true);
    const got = await store.getTrace(k("t1"));
    expect(got).toMatchObject({ decision: "deny", agent: "a", args: { to: "0x1" }, provenance: { to: "untrusted:tool:x" } });
    expect(got?.createdAt).toBe("2026-11-04T09:00:00.000Z");
    expect(await store.getTrace(k("nope"))).toBeNull();
  });

  it("runs a whole ledger crawl: counts, items, labels, precision", async () => {
    const s = store;
    const before = await s.ledgerSummary();
    const crawl = await s.startCrawl("test source");
    const t = (n: string) => k(`tok-${n}`);
    await s.recordScanned({ target: t("a"), crawlId: crawl, verdict: "flagged", partial: false, scanId: k("scan1"), scannedAt: new Date().toISOString() });
    await s.recordScanned({ target: t("b"), crawlId: crawl, verdict: "suspicious", partial: true, scanId: null, scannedAt: new Date().toISOString() });
    await s.recordScanned({ target: t("c"), crawlId: crawl, verdict: "clean", partial: false, scanId: null, scannedAt: new Date().toISOString() });
    await s.recordScanned({ target: t("d"), crawlId: crawl, verdict: "error", partial: false, scanId: null, scannedAt: new Date().toISOString() });
    await s.recordScanned({ target: t("c"), crawlId: crawl, verdict: "clean", partial: false, scanId: null, scannedAt: new Date().toISOString() }); // upsert, not a duplicate
    expect([...(await s.ledgerSeen([t("a"), t("d"), t("zzz")]))].sort()).toEqual([t("a"), t("d")]);

    await s.addLedgerItems([item(k("i1"), t("a"), { crawlId: crawl }), item(k("i2"), t("b"), { verdict: "suspicious", field: "Verified source", crawlId: crawl })]);
    await s.addLedgerItems([item(k("i1"), t("a"), { crawlId: crawl })]); // idempotent
    await s.finishCrawl(crawl, { discovered: 4, scanned: 3, failed: 1, flagged: 1, suspicious: 1 });

    const mid = await s.ledgerSummary();
    expect(mid.scanned - before.scanned).toBe(3); // the error row is never counted as scanned
    expect(mid.partial - before.partial).toBe(1);
    expect(mid.flagged - before.flagged).toBe(1);
    expect(mid.suspicious - before.suspicious).toBe(1);
    expect(mid.crawls - before.crawls).toBe(1);
    expect(mid.lastCrawl).toMatchObject({ source: "test source", scanned: 3, failed: 1 });

    const flaggedOnly = (await s.ledgerEntries({ verdict: "flagged", limit: 500 })).filter((i) => i.id.startsWith(name));
    expect(flaggedOnly.map((i) => i.id)).toEqual([k("i1")]);
    expect(flaggedOnly[0].findingRules).toEqual(["combo.drain", "address.agents"]);
    expect((await s.ledgerEntries({ limit: 500 })).filter((i) => i.id.startsWith(name))).toHaveLength(2);

    expect(await s.labelItem(k("i1"), "true_positive")).toBe(true);
    expect(await s.labelItem(k("i2"), "false_positive")).toBe(true);
    expect(await s.labelItem(k("nope"), "true_positive")).toBe(false);
    const after = await s.ledgerSummary();
    expect(after.labelled - mid.labelled).toBe(2);
    expect(after.confirmed - mid.confirmed).toBe(1);
    const reviewed = (await s.ledgerEntries({ limit: 500 })).find((i) => i.id === k("i1"));
    expect(reviewed).toMatchObject({ reviewed: true, label: "true_positive" });
    expect(after.byField.find((f) => f.field === "Verified source")?.count).toBeGreaterThanOrEqual(1);
  });
});

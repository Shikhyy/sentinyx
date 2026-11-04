import { NoContractError, type ScanReport } from "@sentinyx/scanner";
import { describe, expect, it, vi } from "vitest";
import { handleScan } from "../src/lib/handle-scan";
import { MemoryStore } from "@sentinyx/store";

const ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const report = (target: string): ScanReport => ({
  target, kind: "erc20", chain: "base", chainId: 8453, title: "T", fields: [], verdict: "clean",
  scannedAt: new Date().toISOString(), method: "v0.1", warnings: [],
});

function setup(rateLimit = 10) {
  const store = new MemoryStore();
  const scanFn = vi.fn(async (t: string) => report(t));
  return { store, scanFn, run: (body: unknown, ip = "1.1.1.1") => handleScan(body, ip, { store, scanFn, rateLimit }) };
}

describe("POST /api/scan handler", () => {
  it("rejects bad input before any network work", async () => {
    const { run, scanFn } = setup();
    for (const body of [null, {}, { target: 5 }, { target: "hello" }, { target: "x".repeat(400) }]) {
      const res = await run(body);
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toMatch(/Paste a Base contract/);
    }
    expect(scanFn).not.toHaveBeenCalled();
  });

  it("scans, stores and returns an id and url", async () => {
    const { run, store } = setup();
    const res = await run({ target: ADDR });
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error();
    expect(res.body.url).toBe(`/s/${res.body.id}`);
    expect(res.body.cached).toBe(false);
    expect((await store.getScan(res.body.id))?.report.target).toBe(ADDR);
  });

  it("serves the same report from cache without scanning or counting against the limit", async () => {
    const { run, scanFn } = setup(1);
    const a = await run({ target: ADDR });
    const b = await run({ target: ADDR.toLowerCase() });
    expect(scanFn).toHaveBeenCalledTimes(1);
    expect(b.status).toBe(200);
    if (a.status === 200 && b.status === 200) {
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.cached).toBe(true);
    }
  });

  it("rate limits per IP and sets Retry-After", async () => {
    const { run } = setup(2);
    const t = (i: number) => ({ target: `0x${i.toString(16).padStart(40, "0")}` });
    expect((await run(t(1))).status).toBe(200);
    expect((await run(t(2))).status).toBe(200);
    const blocked = await run(t(3));
    expect(blocked.status).toBe(429);
    expect(blocked).toMatchObject({ retryAfter: 60, body: { error: "Too many scans. Try again in a minute." } });
    expect((await run(t(3), "2.2.2.2")).status).toBe(200); // a different IP is unaffected
  });

  it("maps a missing contract to 404", async () => {
    const store = new MemoryStore();
    const res = await handleScan({ target: ADDR }, "1.1.1.1", { store, scanFn: async () => { throw new NoContractError("base"); } });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No contract at this address on Base." });
  });

  it("never leaks internal error text", async () => {
    const store = new MemoryStore();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleScan({ target: ADDR }, "1.1.1.1", { store, scanFn: async () => { throw new Error("secret https://rpc.example/key=abc123"); } });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("abc123");
  });

  it("fails closed when the rate-limit store is down", async () => {
    const store = new MemoryStore();
    store.hit = async () => { throw new Error("db down"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const scanFn = vi.fn(async (t: string) => report(t));
    const res = await handleScan({ target: ADDR }, "1.1.1.1", { store, scanFn });
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect(scanFn).not.toHaveBeenCalled();
  });
});

describe("choosing a network", () => {
  const sepolia = (t: string): ScanReport => ({ ...report(t), chain: "base-sepolia", chainId: 84532 });

  it("passes an explicit network to the scanner, and leaves it out for auto or nothing", async () => {
    const calls: (string | undefined)[] = [];
    const mk = () => ({ store: new MemoryStore(), scanFn: async (t: string, c?: string) => (calls.push(c), report(t)) });
    const a = mk();
    await handleScan({ target: ADDR, chain: "base-sepolia" }, "1.1.1.1", a as never);
    const b = mk();
    await handleScan({ target: ADDR, chain: "auto" }, "1.1.1.1", b as never);
    const c = mk();
    await handleScan({ target: ADDR }, "1.1.1.1", c as never);
    expect(calls).toEqual(["base-sepolia", undefined, undefined]);
  });

  it("rejects anything that is not a known network, before any network call", async () => {
    const scanFn = vi.fn(async (t: string) => report(t));
    for (const chain of ["mainnet", "ethereum", 1, null, {}]) {
      const res = await handleScan({ target: ADDR, chain }, "1.1.1.1", { store: new MemoryStore(), scanFn });
      expect(res.status, JSON.stringify(chain)).toBe(400);
      expect((res.body as { error: string }).error).toBe("Choose Base or Base Sepolia.");
    }
    expect(scanFn).not.toHaveBeenCalled();
  });

  it("does not serve a Base report when Base Sepolia was asked for (cache is per network)", async () => {
    const store = new MemoryStore();
    const scanFn = vi.fn(async (t: string, c?: string) => (c === "base-sepolia" ? sepolia(t) : report(t)));
    const first = await handleScan({ target: ADDR }, "1.1.1.1", { store, scanFn }); // auto: found on Base
    const second = await handleScan({ target: ADDR, chain: "base-sepolia" }, "1.1.1.1", { store, scanFn });
    expect(scanFn).toHaveBeenCalledTimes(2);
    if (first.status === 200 && second.status === 200) {
      expect(second.body.chain).toBe("base-sepolia");
      expect(second.body.cached).toBe(false);
      expect(second.body.id).not.toBe(first.body.id);
    }
    // and asking for the same network again does use the cache
    const third = await handleScan({ target: ADDR, chain: "base-sepolia" }, "1.1.1.1", { store, scanFn });
    if (third.status === 200) expect(third.body.cached).toBe(true);
  });

  it("ignores a network choice for names, which resolve on Ethereum", async () => {
    const calls: (string | undefined)[] = [];
    await handleScan({ target: "jesse.base.eth", chain: "base-sepolia" }, "1.1.1.1", {
      store: new MemoryStore(),
      scanFn: async (t, c) => (calls.push(c), { ...report(t), kind: "name" }),
    });
    expect(calls).toEqual([undefined]);
  });
});

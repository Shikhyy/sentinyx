import { describe, expect, it } from "vitest";
import { COMMANDS, buildRows, filterCommands, quickTarget, shortTargetLabel } from "../src/lib/palette";

const ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("quickTarget", () => {
  it("recognises what the scanner accepts", () => {
    expect(quickTarget(ADDR)).toEqual({ kind: "address", value: ADDR });
    expect(quickTarget(`  ${ADDR}  `)?.kind).toBe("address");
    expect(quickTarget(`${ADDR}#42`)).toEqual({ kind: "nft", value: `${ADDR}#42` });
    expect(quickTarget("Jesse.Base.ETH")).toEqual({ kind: "name", value: "jesse.base.eth" });
  });
  it("does not mistake ordinary words or malformed input for a target", () => {
    for (const s of ["", "scan", "ledger", "0x123", ADDR + "00", "0x" + "g".repeat(40), "jesse.com", "a b.eth", "x".repeat(300) + ".eth"]) {
      expect(quickTarget(s), s).toBeNull();
    }
  });
});

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommands("")).toHaveLength(COMMANDS.length);
    expect(filterCommands("   ")).toHaveLength(COMMANDS.length);
  });
  it("ranks label-prefix matches above keyword-only matches", () => {
    const r = filterCommands("trace").map((c) => c.id);
    expect(r[0]).toBe("traces");
    const g = filterCommands("guard").map((c) => c.id);
    expect(g[0]).toBe("guard"); // label starts with "Guard"
    expect(g).toContain("lab"); // keyword match, ranked after
  });
  it("requires every word to match", () => {
    expect(filterCommands("download csv").map((c) => c.id)).toEqual(["csv"]);
    expect(filterCommands("download nonsense")).toEqual([]);
  });
  it("is case-insensitive and finds by keyword", () => {
    expect(filterCommands("LEDGER").map((c) => c.id)).toContain("ledger");
    expect(filterCommands("injection").map((c) => c.id)).toContain("lab");
  });
  it("flags external and download commands so they never navigate in place", () => {
    expect(COMMANDS.find((c) => c.id === "source")?.external).toBe(true);
    expect(COMMANDS.filter((c) => c.download).map((c) => c.id)).toEqual(["csv", "json"]);
  });
});

describe("shortTargetLabel", () => {
  it("shortens addresses and keeps an NFT id", () => {
    expect(shortTargetLabel(ADDR)).toBe("0x8335…2913");
    expect(shortTargetLabel(`${ADDR}#7`)).toBe("0x8335…2913#7");
    expect(shortTargetLabel("dana.base.eth")).toBe("dana.base.eth");
  });
});

describe("buildRows", () => {
  it("never repeats a key, including when a pasted target sits above the Scan page command (regression)", () => {
    for (const q of ["", "scan", "lab", ADDR, `${ADDR}#3`, "jesse.base.eth"]) {
      const keys = buildRows(q).map((r) => r.key);
      expect(new Set(keys).size, `${q} -> ${keys.join(",")}`).toBe(keys.length);
    }
  });
  it("puts the scan action first for a target and carries the value to scan", () => {
    const rows = buildRows(ADDR);
    expect(rows[0]).toMatchObject({ group: "Scan", scan: ADDR, label: "Scan 0x8335…2913" });
    expect(rows.slice(1).every((r) => r.cmd && !r.scan)).toBe(true);
  });
  it("only offers page commands for ordinary text, and nothing for nonsense", () => {
    expect(buildRows("lab").every((r) => r.cmd)).toBe(true);
    expect(buildRows("zzzzqqq")).toEqual([]);
  });
});

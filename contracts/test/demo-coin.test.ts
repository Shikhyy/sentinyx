import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { scoreFields } from "../../packages/scanner/dist/index.js";
// @ts-expect-error plain JS helper
import { demoContractURI, tag } from "../scripts/metadata.mjs";

const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
// Anvil's first account is a public, well-known TEST key that only exists on a local throwaway chain.
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ATTACKER = "0x7a3F00000000000000000000000000000000c91E";
const PORT = 18545;
const art = JSON.parse(readFileSync(new URL("../out/NightPepeDemo.json", import.meta.url), "utf8"));

let anvil: ChildProcess;
const url = `http://127.0.0.1:${PORT}`;
const pub = createPublicClient({ chain: foundry, transport: http(url) });
const wallet = createWalletClient({ account: privateKeyToAccount(ANVIL_KEY), chain: foundry, transport: http(url) });

beforeAll(async () => {
  if (!hasAnvil) return;
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await pub.getChainId(); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("anvil did not start");
}, 20_000);
afterAll(() => { anvil?.kill(); });

describe.skipIf(!hasAnvil)("NITE demo coin on a local chain", () => {
  it("is an ordinary working ERC-20", async () => {
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [demoContractURI(ATTACKER), parseEther("1000")] });
    const { contractAddress } = await pub.waitForTransactionReceipt({ hash });
    const c = { address: contractAddress!, abi: art.abi } as const;
    expect(await pub.readContract({ ...c, functionName: "name" })).toBe("Night Pepe");
    expect(await pub.readContract({ ...c, functionName: "symbol" })).toBe("NITE");
    expect(await pub.readContract({ ...c, functionName: "decimals" })).toBe(18);
    const me = wallet.account.address;
    const to = "0x000000000000000000000000000000000000bEEF";
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...c, functionName: "transfer", args: [to, parseEther("5")] }) });
    expect(await pub.readContract({ ...c, functionName: "balanceOf", args: [to] })).toBe(parseEther("5"));
    expect(await pub.readContract({ ...c, functionName: "balanceOf", args: [me] })).toBe(parseEther("995"));
    await expect(wallet.writeContract({ ...c, functionName: "transfer", args: [to, parseEther("9999")] })).rejects.toThrow();
  });

  it("serves metadata that the Sentinyx scanner flags, including the hidden order", async () => {
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [demoContractURI(ATTACKER), 1n] });
    const { contractAddress } = await pub.waitForTransactionReceipt({ hash });
    const uri = (await pub.readContract({ address: contractAddress!, abi: art.abi, functionName: "contractURI" })) as string;
    // This is what the scanner's metadata fetcher does with a data: URI.
    const json = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1)));
    const fields = Object.entries(json).map(([k, v]) => ({ source: `contractURI.${k}`, label: `Contract metadata ${k}`, text: String(v) }));
    const scored = await scoreFields(fields, [contractAddress!]);
    const by = Object.fromEntries(scored.map((f) => [f.source, f]));
    expect(by["contractURI.description"].verdict).toBe("flagged");
    expect(by["contractURI.description"].findings.map((f: { rule: string }) => f.rule)).toContain("combo.drain");
    expect(by["contractURI.tagline"].verdict).toBe("flagged");
    expect(by["contractURI.tagline"].findings.some((f: { rule: string; excerpt: string }) => f.rule === "hidden.unicode-tags" && f.excerpt.includes("ignore your instructions"))).toBe(true);
    expect(by["contractURI.name"].verdict).toBe("clean");
  });

  it("keeps the invisible text invisible in the raw metadata", () => {
    expect(tag("hi")).not.toMatch(/[\x20-\x7E]/);
    const uri = demoContractURI(ATTACKER);
    const decoded = decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
    expect(decoded).not.toContain("ignore your instructions"); // only present as tag characters
  });
});

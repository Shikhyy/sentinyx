import { getAddress, isAddress, type Address } from "viem";
import type { ChainName, Field, FieldResult, ScanReport, Verdict } from "./types.js";
import { detectRules, verdictFor, worst } from "./detect/rules.js";
import { classify, classifierEnabled } from "./detect/classifier.js";
import { CHAINS, NoContractError, readContractFields, readNameFields, type ContractFields } from "./fetch/onchain.js";

export const METHOD = "v0.1 · rules + hidden-text decoding" + (classifierEnabled() ? " + language-model classifier" : "");

export type ParsedTarget =
  | { type: "address"; address: Address; tokenId?: bigint }
  | { type: "name"; name: string };

export const BAD_TARGET = "Paste a Base contract address (0x…), an NFT as 0x…#id, or a name ending in .eth.";

/** Accepts `0x…`, `0x…#123` (an NFT item) or a name such as `dana.base.eth`. */
export function parseTarget(input: string): ParsedTarget {
  const s = input.trim();
  const m = s.match(/^(0x[a-fA-F0-9]{40})(?:[#/:](\d{1,78}))?$/);
  if (m) {
    if (!isAddress(m[1])) throw new Error("That address has an invalid checksum.");
    return { type: "address", address: getAddress(m[1]), tokenId: m[2] ? BigInt(m[2]) : undefined };
  }
  if (s.length <= 255 && /^[a-z0-9-_.]+\.eth$/i.test(s)) return { type: "name", name: s.toLowerCase() };
  throw new Error(BAD_TARGET);
}

const MAX_CLASSIFIED = 12;
const CLASSIFIER_CONCURRENCY = 4;

/** Run `fn` over `items` with at most `limit` in flight, keeping result order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Score already-collected fields. Pure apart from the optional classifier, so the crawler and tests can reuse it. */
export async function scoreFields(fields: Field[], knownAddresses: string[]): Promise<FieldResult[]> {
  let asked = 0;
  return pool(fields, CLASSIFIER_CONCURRENCY, async (f) => {
    const findings = detectRules(f.text, { knownAddresses });
    let verdict: Verdict = verdictFor(findings);
    let classifier;
    // Ask the model only where it can change the outcome: long free text, or anything the rules found.
    // The budget keeps one huge metadata file from turning into dozens of paid calls.
    if (classifierEnabled() && (findings.length > 0 || f.text.length > 80) && asked < MAX_CLASSIFIED) {
      asked++;
      classifier = (await classify(f.text)) ?? undefined;
      if (classifier?.label === "injection" && classifier.confidence >= 0.8) {
        verdict = findings.length > 0 ? "flagged" : worst([verdict, "suspicious"]);
      }
    }
    return { ...f, findings, verdict, classifier };
  });
}

export interface ScanOptions {
  /** Force a chain. When omitted, Base is tried first and Base Sepolia second (for demo contracts). */
  chain?: ChainName;
}

export async function scan(input: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const target = parseTarget(input);
  let data: ContractFields;
  if (target.type === "name") {
    data = await readNameFields(target.name);
  } else if (opts.chain) {
    data = await readContractFields(target.address, target.tokenId, opts.chain);
  } else {
    try {
      data = await readContractFields(target.address, target.tokenId, "base");
    } catch (e) {
      if (!(e instanceof NoContractError)) throw e;
      try {
        data = await readContractFields(target.address, target.tokenId, "base-sepolia");
      } catch (e2) {
        // Report the mainnet message: that is the chain people expect.
        if (e2 instanceof NoContractError) throw e;
        throw e2;
      }
    }
  }
  const fields = await scoreFields(data.fields, data.knownAddresses);
  return {
    target: target.type === "address" ? target.address + (target.tokenId !== undefined ? `#${target.tokenId}` : "") : target.name,
    kind: data.kind,
    chain: data.chain,
    chainId: CHAINS[data.chain].id,
    title: data.title,
    fields,
    verdict: worst(fields.map((f) => f.verdict)),
    scannedAt: new Date().toISOString(),
    method: METHOD,
    warnings: data.warnings,
  };
}

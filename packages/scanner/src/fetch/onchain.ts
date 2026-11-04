import { BaseError, createPublicClient, http, parseAbi, type Address } from "viem";
import { base, baseSepolia, mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import type { ChainName, Field, TargetKind } from "../types.js";
import { fetchJson, stringsFrom } from "./metadata.js";

/** The two calls we need. Chain-specific viem clients don't share one type, so we depend on this shape. */
export interface Reader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readContract(args: any): Promise<any>;
  getCode(args: { address: Address }): Promise<string | undefined>;
}

interface ChainConfig {
  id: number;
  label: string;
  make: () => Reader;
  blockscout: () => string;
}

const clients = new Map<string, unknown>();
/** Clients are created on first use so environment variables loaded after import still apply. */
function cached<T>(key: string, make: () => T): T {
  if (!clients.has(key)) clients.set(key, make());
  return clients.get(key) as T;
}

export const CHAINS: Record<ChainName, ChainConfig> = {
  base: {
    id: 8453,
    label: "Base",
    make: () =>
      cached("base", () =>
        createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined), batch: { multicall: true } }) as unknown as Reader,
      ),
    blockscout: () => process.env.BLOCKSCOUT_API || "https://base.blockscout.com/api/v2",
  },
  "base-sepolia": {
    id: 84532,
    label: "Base Sepolia",
    make: () =>
      cached("base-sepolia", () =>
        createPublicClient({
          chain: baseSepolia,
          transport: http(process.env.BASE_SEPOLIA_RPC_URL || undefined),
          batch: { multicall: true },
        }) as unknown as Reader,
      ),
    blockscout: () => process.env.BLOCKSCOUT_SEPOLIA_API || "https://base-sepolia.blockscout.com/api/v2",
  },
};

// Basenames (*.base.eth) resolve through the ENS universal resolver on Ethereum mainnet.
const l1Client = () =>
  cached("l1", () => createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC_URL || undefined) }));

const ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function owner() view returns (address)",
  "function contractURI() view returns (string)",
  "function tokenURI() view returns (string)",
  "function tokenURI(uint256) view returns (string)",
  "function uri(uint256) view returns (string)",
  "function supportsInterface(bytes4) view returns (bool)",
]);

const IFACE_721 = "0x80ac58cd";
const IFACE_1155 = "0xd9b67a26";

export class NoContractError extends Error {
  constructor(public chain: ChainName) {
    super(`No contract at this address on ${CHAINS[chain].label}.`);
  }
}

/** True when the call failed because the contract simply doesn't implement the function. */
function isAbsent(e: unknown): boolean {
  if (e instanceof BaseError) {
    const hit = e.walk((x) =>
      ["ContractFunctionRevertedError", "ContractFunctionZeroDataError", "AbiDecodingZeroDataError"].includes((x as Error).name),
    );
    if (hit) return true;
  }
  return /reverted|returned no data|zero data/i.test(String((e as Error)?.message ?? ""));
}

function shortMessage(e: unknown): string {
  const m = e instanceof BaseError ? e.shortMessage : String((e as Error)?.message ?? e);
  return m.split("\n")[0].slice(0, 160);
}

/**
 * Read a value. "The contract has no such function" is normal and returns null quietly.
 * Anything else (network error, rate limit, timeout) is recorded as a warning so a failed
 * read can never look like a clean field.
 */
async function read<T>(what: string, warnings: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (!isAbsent(e)) warnings.push(`Could not read ${what}: ${shortMessage(e)}`);
    return null;
  }
}

export async function detectKind(client: Reader, address: Address, warnings: string[] = []): Promise<TargetKind> {
  const [is721, is1155, decimals] = await Promise.all([
    read("ERC-721 support", warnings, () => client.readContract({ address, abi: ABI, functionName: "supportsInterface", args: [IFACE_721] })),
    read("ERC-1155 support", warnings, () => client.readContract({ address, abi: ABI, functionName: "supportsInterface", args: [IFACE_1155] })),
    read("decimals", warnings, () => client.readContract({ address, abi: ABI, functionName: "decimals" })),
  ]);
  if (is721) return "erc721";
  if (is1155) return "erc1155";
  if (decimals !== null) return "erc20";
  return "contract";
}

export interface ContractFields {
  kind: TargetKind;
  chain: ChainName;
  title: string;
  fields: Field[];
  knownAddresses: string[];
  warnings: string[];
}

async function metadataFields(uri: string | null, source: string, label: string, warnings: string[]): Promise<Field[]> {
  if (!uri) return [];
  try {
    return stringsFrom(await fetchJson(uri), source, label);
  } catch (e) {
    warnings.push(`${label} not read: ${(e as Error).message}`);
    return [];
  }
}

export async function readContractFields(address: Address, tokenId: bigint | undefined, chain: ChainName): Promise<ContractFields> {
  const cfg = CHAINS[chain];
  const client = cfg.make();
  const warnings: string[] = [];
  const knownAddresses: string[] = [address];

  let code: string | undefined;
  try {
    code = await client.getCode({ address });
  } catch (e) {
    throw new Error(`Could not reach the ${cfg.label} node (${shortMessage(e)}). Try again in a moment.`);
  }
  if (!code || code === "0x") throw new NoContractError(chain);

  const kind = await detectKind(client, address, warnings);
  const call = <F extends "name" | "symbol" | "owner" | "contractURI" | "tokenURI">(fn: F) =>
    read(`${fn}()`, warnings, () => client.readContract({ address, abi: ABI, functionName: fn } as never) as Promise<string>);

  const wantsItem = (kind === "erc721" || kind === "erc1155") && tokenId !== undefined;
  const [name, symbol, owner, contractURI, coinURI, itemURI, comments] = await Promise.all([
    call("name"),
    call("symbol"),
    call("owner"),
    call("contractURI"),
    kind === "erc20" ? call("tokenURI") : Promise.resolve(null),
    wantsItem
      ? read(`item #${tokenId} URI`, warnings, () =>
          kind === "erc721"
            ? client.readContract({ address, abi: ABI, functionName: "tokenURI", args: [tokenId!] })
            : client.readContract({ address, abi: ABI, functionName: "uri", args: [tokenId!] }),
        )
      : Promise.resolve(null),
    readSourceComments(address, chain).catch((e) => {
      warnings.push(`Verified source not read: ${(e as Error).message}`);
      return null;
    }),
  ]);

  if (owner) knownAddresses.push(owner);
  const fields: Field[] = [];
  if (name) fields.push({ source: "contract.name", label: "Name", text: name });
  if (symbol) fields.push({ source: "contract.symbol", label: "Symbol", text: symbol });

  // ERC-7572 contract-level metadata, a common home for a token's or collection's description.
  // Some coin contracts (creator coins) also expose a single tokenURI() for the token itself.
  const resolvedItem = itemURI && tokenId !== undefined ? itemURI.replace("{id}", tokenId.toString(16).padStart(64, "0")) : null;
  if (wantsItem && !itemURI) warnings.push(`Could not read metadata for item #${tokenId}.`);
  const [a, b, c] = await Promise.all([
    metadataFields(contractURI, "contractURI", "Contract metadata", warnings),
    metadataFields(coinURI, "coinURI", "Token metadata", warnings),
    metadataFields(resolvedItem, `tokenURI:${tokenId}`, `Item #${tokenId}`, warnings),
  ]);
  fields.push(...a, ...b, ...c);
  if (comments) fields.push({ source: "source.comments", label: "Source comments", text: comments });

  return { kind, chain, title: name ?? address, fields, knownAddresses, warnings };
}

type SourceResult = { status: "found"; source: string } | { status: "none" } | { status: "error"; message: string };

async function sourceFromSourcify(address: Address, chain: ChainName): Promise<SourceResult> {
  try {
    const res = await fetch(`https://sourcify.dev/server/v2/contract/${CHAINS[chain].id}/${address}?fields=sources`, {
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) return { status: "none" };
    if (!res.ok) return { status: "error", message: `Sourcify HTTP ${res.status}` };
    const data = (await res.json()) as { sources?: Record<string, { content?: string }> };
    const src = Object.values(data.sources ?? {}).map((f) => f.content ?? "").join("\n");
    return src.trim() ? { status: "found", source: src } : { status: "none" };
  } catch (e) {
    return { status: "error", message: `Sourcify: ${shortMessage(e)}` };
  }
}

async function sourceFromBlockscout(address: Address, chain: ChainName): Promise<SourceResult> {
  try {
    const res = await fetch(`${CHAINS[chain].blockscout()}/smart-contracts/${address}`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return { status: "none" };
    if (!res.ok) return { status: "error", message: `Blockscout HTTP ${res.status}` };
    const data = (await res.json()) as { source_code?: string; additional_sources?: { source_code?: string }[] };
    const src = [data.source_code ?? "", ...(data.additional_sources ?? []).map((s) => s.source_code ?? "")].join("\n");
    return src.trim() ? { status: "found", source: src } : { status: "none" };
  } catch (e) {
    return { status: "error", message: `Blockscout: ${shortMessage(e)}` };
  }
}

/** Pull the prose out of Solidity source. Exported for tests. */
export function commentsFromSource(src: string): string | null {
  // `(?<!:)` keeps the `//` inside "https://" from being read as a comment.
  const comments = [...src.matchAll(/(?<!:)\/\/[^\n]*|\/\*[\s\S]*?\*\//g)].map((m) => m[0]);
  // Drop only the licence header line itself. Never drop a comment because of the words it contains:
  // that would let an attacker hide an order by mentioning "pragma".
  const prose = comments.filter((c) => !/^\/\/\s*SPDX-License-Identifier:\s*[\w.\-+ ()]+$/i.test(c.trim()));
  return prose.join("\n").slice(0, 20000) || null;
}

/** Comments and NatSpec from verified source: Sourcify first (no key), Blockscout as a fallback. */
export async function readSourceComments(address: Address, chain: ChainName): Promise<string | null> {
  const first = await sourceFromSourcify(address, chain);
  if (first.status === "found") return commentsFromSource(first.source);
  const second = await sourceFromBlockscout(address, chain);
  if (second.status === "found") return commentsFromSource(second.source);
  if (first.status === "error" && second.status === "error") throw new Error(`${first.message}; ${second.message}`);
  return null; // not verified anywhere we can read, or one source said so and the other was unreachable
}

const TEXT_KEYS = [
  "description", "url", "display", "keywords", "notice", "location",
  "com.twitter", "com.github", "com.discord", "org.telegram", "email", "avatar", "header",
];

export async function readNameFields(name: string): Promise<ContractFields> {
  const warnings: string[] = [];
  let normalized: string;
  try {
    normalized = normalize(name);
  } catch {
    throw new Error("That name has characters ENS doesn't allow.");
  }
  const l1 = l1Client();
  const addr = await read("the name's address", warnings, () => l1.getEnsAddress({ name: normalized }));
  const knownAddresses = addr ? [addr] : [];
  if (!addr) warnings.push("This name does not resolve to an address.");
  const values = await Promise.all(
    TEXT_KEYS.map((key) => read(`text record “${key}”`, warnings, () => l1.getEnsText({ name: normalized, key }))),
  );
  const fields: Field[] = [];
  TEXT_KEYS.forEach((key, i) => {
    const v = values[i];
    if (v) fields.push({ source: `name.text:${key}`, label: `Text record “${key}”`, text: v });
  });
  return { kind: "name", chain: "base", title: normalized, fields, knownAddresses, warnings };
}

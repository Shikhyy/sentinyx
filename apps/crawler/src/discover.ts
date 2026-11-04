import { getAddress, isAddress } from "viem";

export interface Discovered {
  address: string;
  name: string;
  symbol: string;
  poolCreatedAt: string;
}

export const SOURCE = "GeckoTerminal new pools (Base)";

// Tokens every pool pairs against. Never "new", never interesting.
const SKIP = new Set(
  [
    "0x0000000000000000000000000000000000000000",
    "0x4200000000000000000000000000000000000006", // WETH
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
  ].map((a) => a.toLowerCase()),
);

interface GeckoDoc {
  data?: { attributes?: { pool_created_at?: string }; relationships?: { base_token?: { data?: { id?: string } } } }[];
  included?: { id?: string; type?: string; attributes?: { address?: string; name?: string; symbol?: string } }[];
}

/** Parse one page of GeckoTerminal's new_pools response. Exported for tests. */
export function parsePools(doc: GeckoDoc): Discovered[] {
  const tokens = new Map<string, { address?: string; name?: string; symbol?: string }>();
  for (const inc of doc.included ?? []) if (inc.type === "token" && inc.id) tokens.set(inc.id, inc.attributes ?? {});
  const out: Discovered[] = [];
  for (const pool of doc.data ?? []) {
    const id = pool.relationships?.base_token?.data?.id;
    const t = id ? tokens.get(id) : undefined;
    const raw = t?.address;
    if (!raw || !isAddress(raw, { strict: false }) || SKIP.has(raw.toLowerCase())) continue;
    out.push({
      address: getAddress(raw),
      name: String(t?.name ?? "").slice(0, 80),
      symbol: String(t?.symbol ?? "").slice(0, 20),
      poolCreatedAt: pool.attributes?.pool_created_at ?? "",
    });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Newest tokens that got a trading pool on Base, newest first. The API allows ~30 requests a minute, so pages are spaced out. */
export async function discoverGecko(pages = 3, fetchFn: typeof fetch = fetch, pauseMs = 2200): Promise<Discovered[]> {
  const seen = new Set<string>();
  const out: Discovered[] = [];
  for (let page = 1; page <= pages; page++) {
    if (page > 1) await sleep(pauseMs);
    let doc: GeckoDoc;
    try {
      const res = await fetchFn(`https://api.geckoterminal.com/api/v2/networks/base/new_pools?include=base_token&page=${page}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
      doc = (await res.json()) as GeckoDoc;
    } catch (e) {
      if (out.length > 0) break; // keep what we have
      throw e;
    }
    for (const d of parsePools(doc)) {
      if (seen.has(d.address)) continue;
      seen.add(d.address);
      out.push(d);
    }
  }
  return out;
}

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Metadata URIs are written by whoever deployed the contract, so they are attacker-controlled.
 * We only follow https/ipfs/ar/data URIs, refuse private and local hosts (by name and by what the
 * name resolves to), refuse redirects, cap size and time, and never send cookies or credentials.
 *
 * Known limit: DNS is checked before the request and resolved again by fetch, so a host that
 * changes its answer between the two could still slip through. Run the scanner without access to
 * private networks in production.
 */
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 6000;

const PRIVATE_HOST =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:|metadata\.google\.internal)/i;

/**
 * IPFS public gateways rate-limit hard (HTTP 429), so a CID is tried on several of them in turn.
 * Only gateways that answer directly are listed: redirects are refused, so ones that bounce to a subdomain can't be used.
 */
const IPFS_GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://gateway.lighthouse.storage/ipfs/", "https://ipfs.io/ipfs/"];

/** Every URL worth trying for a metadata URI, best first. Empty if the scheme isn't allowed. */
export function resolveUris(uri: string): string[] {
  const u = uri.trim();
  if (u.startsWith("data:")) return [u];
  if (u.startsWith("ipfs://")) {
    const path = u.slice(7).replace(/^ipfs\//, "");
    const first = process.env.IPFS_GATEWAY ? [process.env.IPFS_GATEWAY] : [];
    return [...new Set([...first, ...IPFS_GATEWAYS])].map((gw) => gw + path);
  }
  if (u.startsWith("ar://")) return ["https://arweave.net/" + u.slice(5)];
  if (u.startsWith("https://")) return [u];
  return [];
}

export const resolveUri = (uri: string): string | null => resolveUris(uri)[0] ?? null;

/** True for any private, loopback, link-local, carrier-grade NAT, multicast or reserved address. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    if (s.startsWith("::ffff:")) return true; // hex-form mapped addresses: refuse rather than parse
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true; // not an IP at all: treat as unsafe
}

export function isSafeUrl(url: string): boolean {
  if (url.startsWith("data:")) return true;
  try {
    const { protocol, hostname, username, password } = new URL(url);
    if (protocol !== "https:" || username || password) return false;
    const bare = hostname.replace(/^\[|\]$/g, "");
    // Refuse every IP literal (dotted, decimal, hex, IPv6). Real metadata hosts have names.
    if (isIP(bare) || /^(0x[0-9a-f]+|\d+)$/i.test(bare) || bare.includes(":")) return false;
    return !PRIVATE_HOST.test(hostname);
  } catch {
    return false;
  }
}

export function decodeDataUri(uri: string): string {
  if (uri.length > MAX_BYTES * 2) throw new Error("Metadata larger than 256 KB");
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("Malformed data URI");
  const meta = uri.slice(5, comma);
  const body = uri.slice(comma + 1);
  return meta.includes(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
}

/** A failure no other gateway could fix (too big, not JSON). */
class FatalMetadataError extends Error {}

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: typeof lookup;
}

async function fetchOne(url: string, deps: FetchDeps): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;
  const doLookup = deps.lookupImpl ?? lookup;
  const { hostname } = new URL(url);
  const answers = await doLookup(hostname, { all: true });
  if (answers.length === 0 || answers.some((a) => isPrivateIp(a.address))) {
    throw new FatalMetadataError(`Refused to fetch ${hostname}: it resolves to a non-public address`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, redirect: "error", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 60)}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Empty response");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new FatalMetadataError("Metadata larger than 256 KB");
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new FatalMetadataError("Metadata is not valid JSON");
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(uri: string, deps: FetchDeps = {}): Promise<unknown> {
  const urls = resolveUris(uri);
  if (urls.length === 0) throw new Error(`Unsupported URI scheme: ${uri.slice(0, 40)}`);
  if (urls[0].startsWith("data:")) return JSON.parse(decodeDataUri(urls[0]));

  let last: Error = new Error("No gateway answered");
  for (const url of urls) {
    if (!isSafeUrl(url)) {
      last = new Error(`Refused to fetch ${url.slice(0, 60)}`);
      continue;
    }
    try {
      return await fetchOne(url, deps);
    } catch (e) {
      last = e as Error;
      if (e instanceof FatalMetadataError) throw e;
    }
  }
  throw last;
}

/** Pull every string an agent might read out of a metadata object, with a readable label. */
export function stringsFrom(obj: unknown, prefix: string, label: string, depth = 0): { source: string; label: string; text: string }[] {
  const out: { source: string; label: string; text: string }[] = [];
  if (depth > 4 || obj == null) return out;
  if (typeof obj === "string") {
    if (obj.trim() && !/^(https?|ipfs|ar|data):/i.test(obj.trim())) out.push({ source: prefix, label, text: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 50).forEach((v, i) => out.push(...stringsFrom(v, `${prefix}[${i}]`, `${label} ${i + 1}`, depth + 1)));
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>).slice(0, 50)) {
      if (k === "image" || k === "image_data" || k === "animation_url") continue;
      out.push(...stringsFrom(v, `${prefix}.${k}`, `${label} ${k.replace(/_/g, " ")}`, depth + 1));
    }
  }
  return out;
}

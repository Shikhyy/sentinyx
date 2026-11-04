import { BAD_TARGET, NoContractError, parseTarget, scan, type ScanReport } from "@sentinyx/scanner";
import { newId, type Store } from "@sentinyx/store";

export const CACHE_MS = 10 * 60 * 1000;
export const RATE_WINDOW_SEC = 60;

export type ScanResponse =
  | { status: 200; body: ScanReport & { id: string; url: string; cached: boolean } }
  | { status: 400 | 404 | 429 | 500 | 502; body: { error: string }; retryAfter?: number };

export interface ScanDeps {
  store: Store;
  scanFn?: (target: string) => Promise<ScanReport>;
  now?: () => number;
  rateLimit?: number;
}

// Messages we wrote ourselves and are safe to show. Everything else becomes a generic error.
const SAFE_MESSAGE = /^(Could not reach the|That name has characters|That address has an invalid)/;

/** The whole of POST /api/scan, kept free of Next types so it can be tested directly. */
export async function handleScan(input: unknown, ip: string, deps: ScanDeps): Promise<ScanResponse> {
  const { store } = deps;
  const scanFn = deps.scanFn ?? ((t: string) => scan(t));
  const limit = deps.rateLimit ?? Number(process.env.SCAN_RATE_LIMIT ?? 10);

  const raw = input && typeof input === "object" ? (input as { target?: unknown }).target : undefined;
  if (typeof raw !== "string" || raw.length > 300) return { status: 400, body: { error: BAD_TARGET } };

  // Validate before any network call.
  let key: string;
  try {
    const t = parseTarget(raw);
    key = t.type === "address" ? t.address + (t.tokenId !== undefined ? `#${t.tokenId}` : "") : t.name;
  } catch (e) {
    return { status: 400, body: { error: (e as Error).message } };
  }

  const origin = (id: string) => `/s/${id}`;

  // Cached reports are free: they cost no RPC calls and no model calls.
  try {
    const cached = await store.findRecent(key, CACHE_MS);
    if (cached) return { status: 200, body: { ...cached.report, id: cached.id, url: origin(cached.id), cached: true } };
  } catch (e) {
    console.error("cache lookup failed", e);
  }

  try {
    const n = await store.hit(`scan:${ip}`, RATE_WINDOW_SEC);
    if (n > limit) return { status: 429, retryAfter: RATE_WINDOW_SEC, body: { error: "Too many scans. Try again in a minute." } };
  } catch (e) {
    // Fail closed on cost: if we can't count, refuse rather than allow unlimited paid scans.
    console.error("rate limit store failed", e);
    return { status: 502, body: { error: "Scanning is temporarily unavailable. Try again shortly." } };
  }

  let report: ScanReport;
  try {
    report = await scanFn(raw);
  } catch (e) {
    if (e instanceof NoContractError) return { status: 404, body: { error: e.message } };
    const msg = (e as Error)?.message ?? "";
    if (SAFE_MESSAGE.test(msg)) return { status: msg.startsWith("Could not reach") ? 502 : 400, body: { error: msg } };
    console.error("scan failed", e);
    return { status: 500, body: { error: "The scan failed. Try again." } };
  }

  const id = newId();
  try {
    await store.saveScan({ id, report, createdAt: new Date((deps.now ?? Date.now)()).toISOString() });
  } catch (e) {
    console.error("saving scan failed", e);
    return { status: 502, body: { error: "The scan finished but could not be saved. Try again." } };
  }
  return { status: 200, body: { ...report, id, url: origin(id), cached: false } };
}

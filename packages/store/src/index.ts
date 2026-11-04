import { MemoryStore } from "./memory.js";
import { PgStore } from "./pg.js";
import type { Store } from "./types.js";

export * from "./types.js";
export * from "./ids.js";
export { MemoryStore } from "./memory.js";
export { PgStore } from "./pg.js";
export { summarize } from "./summary.js";

const g = globalThis as unknown as { __sentinyxStore?: Store };

/** One store per process. Postgres when DATABASE_URL is set, memory otherwise. */
export function getStore(): Store {
  if (!g.__sentinyxStore) {
    const url = process.env.DATABASE_URL;
    g.__sentinyxStore = url ? new PgStore(url) : new MemoryStore();
  }
  return g.__sentinyxStore;
}

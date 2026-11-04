// Upload the recorded Attack Lab traces to a running site, so they appear in its Traces list as stored rows.
// Usage: SITE=https://your-app.vercel.app TRACE_INGEST_TOKEN=… npm run lab:upload -w @sentinyx/web
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = process.env.SITE;
const token = process.env.TRACE_INGEST_TOKEN;
if (!site || !token) throw new Error("Set SITE and TRACE_INGEST_TOKEN.");
const here = dirname(fileURLToPath(import.meta.url));
const lab = JSON.parse(readFileSync(join(here, "../../src/data/lab-runs.json"), "utf8"));
const body = lab.scenarios.flatMap((s) => s.on.trace).map((t) => JSON.stringify(t)).join("\n");
const res = await fetch(new URL("/api/traces", site), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
console.log(res.status, await res.text());

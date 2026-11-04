import { fileURLToPath } from "node:url";
import { scan } from "./scan.js";

// Load the repo-root .env if present. Values stay in process.env; nothing here prints them.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  /* no .env: defaults apply */
}

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run scan -- <0xaddress | 0xaddress#id | name.base.eth>");
  process.exit(1);
}
const chainArg = process.argv[3] === "sepolia" ? "base-sepolia" : undefined;
let report;
try {
  report = await scan(input, { chain: chainArg });
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
console.log(`\n${report.title}  [${report.kind} · ${report.chain}]  →  ${report.verdict.toUpperCase()}\n`);
for (const f of report.fields) {
  const mark = f.verdict === "flagged" ? "■" : f.verdict === "suspicious" ? "◐" : "·";
  console.log(`${mark} ${f.label.padEnd(36)} ${f.verdict}`);
  for (const x of f.findings) console.log(`    ${x.severity.padEnd(6)} ${x.rule}: ${x.message}\n           ${x.excerpt}`);
}
if (report.warnings.length) console.log("\nWarnings:\n  " + report.warnings.join("\n  "));

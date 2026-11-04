import { fileURLToPath } from "node:url";
import { getStore, type Label } from "@sentinyx/store";
import { runCrawl } from "./crawl.js";

// Load the repo-root .env if present. Values stay in process.env; nothing here prints them.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  /* no .env: defaults apply */
}

const [cmd, ...args] = process.argv.slice(2);
const store = getStore();

function needDb() {
  if (store.kind !== "postgres" && !args.includes("--memory")) {
    console.error("DATABASE_URL is not set, so results would be lost when this exits. Set it, or pass --memory to try a dry run.");
    process.exit(2);
  }
}

async function main() {
  if (cmd === "crawl") {
    needDb();
    const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 40);
    const r = await runCrawl({ store, limit, log: (m) => console.log(m) });
    console.log(`\ncrawl #${r.crawlId}:`, r.stats, `remaining: ${r.remaining}`);
  } else if (cmd === "review") {
    needDb();
    const items = (await store.ledgerEntries({ limit: 200 })).filter((i) => !i.reviewed);
    for (const i of items) console.log(`${i.id}  ${i.verdict.padEnd(10)} ${i.target}  [${i.field}]  ${i.excerptRedacted}`);
    console.log(`\n${items.length} unreviewed. Label with: npm run label -w @sentinyx/crawler -- <id> tp|fp|clear`);
  } else if (cmd === "label") {
    needDb();
    const [id, verdict] = args;
    const map: Record<string, Label | null> = { tp: "true_positive", fp: "false_positive", clear: null };
    if (!id || !(verdict in map)) {
      console.error("Usage: label <item id> tp|fp|clear");
      process.exit(1);
    }
    console.log((await store.labelItem(id, map[verdict])) ? "labelled" : "no such item");
  } else {
    console.error("Usage: crawl [--limit=40] | review | label <id> tp|fp|clear   (add --memory for a dry run without a database)");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

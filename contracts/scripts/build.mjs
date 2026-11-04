// Compile contracts/src/*.sol with solc-js into contracts/out/<Name>.json ({ abi, bytecode }).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = "NightPepeDemo.sol";
const input = {
  language: "Solidity",
  sources: { [file]: { content: readFileSync(join(root, "src", file), "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);
const c = out.contracts[file].NightPepeDemo;
mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(join(root, "out/NightPepeDemo.json"), JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
console.log("compiled NightPepeDemo:", c.evm.bytecode.object.length / 2, "bytes");

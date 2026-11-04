// Deploy the NITE demo coin to Base Sepolia (or a local anvil). TESTNET ONLY: any other chain is refused.
//
//   DEPLOYER_PRIVATE_KEY=0x… DEMO_ATTACKER_ADDRESS=0x… npm run deploy -w @sentinyx/contracts -- --chain base-sepolia
//
// The key is read from the environment only and never printed. Use a throwaway testnet key.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { demoContractURI } from "./metadata.mjs";

const CHAINS = { "base-sepolia": baseSepolia, local: foundry };
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

const chainName = arg("chain", "base-sepolia");
const chain = CHAINS[chainName];
if (!chain) throw new Error(`Unknown chain "${chainName}". Allowed: ${Object.keys(CHAINS).join(", ")}. Mainnet is never allowed.`);

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Set DEPLOYER_PRIVATE_KEY to a throwaway testnet key (0x + 64 hex).");
const attackerRaw = process.env.DEMO_ATTACKER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";
if (!isAddress(attackerRaw)) throw new Error("DEMO_ATTACKER_ADDRESS must be an address. Use a testnet address you control.");
const attacker = getAddress(attackerRaw);

const rpc = process.env.RPC_URL || (chainName === "local" ? "http://127.0.0.1:8545" : undefined);
const transport = http(rpc);
const pub = createPublicClient({ chain, transport });
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport });

// Belt and braces: confirm the node really is the testnet we think it is before signing anything.
const id = await pub.getChainId();
if (![84532, 31337].includes(id)) throw new Error(`Connected node reports chain id ${id}. Refusing: testnet only.`);
if (id !== chain.id) throw new Error(`Node chain id ${id} does not match --chain ${chainName}.`);

const { abi, bytecode } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../out/NightPepeDemo.json"), "utf8"));
const balance = await pub.getBalance({ address: account.address });
console.log(`chain ${chain.name} (${id}), deployer ${account.address}, balance ${Number(balance) / 1e18} ETH, attacker address in metadata ${attacker}`);
if (balance === 0n) throw new Error("The deployer has no test ETH. Get some from a Base Sepolia faucet.");
if (process.argv.includes("--dry-run")) {
  console.log("dry run: nothing sent.");
  process.exit(0);
}

const hash = await wallet.deployContract({ abi, bytecode, args: [demoContractURI(attacker), parseEther("1000000")] });
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`deployed NITE at ${receipt.contractAddress} (tx ${hash})`);
console.log(`scan it:  npm run scan -w @sentinyx/scanner -- ${receipt.contractAddress} sepolia`);

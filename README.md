# Sentinyx

**Every token talks. Some give orders.**

Sentinyx finds instructions hidden in onchain text that AI agents read, and stops agents from obeying them. Built for Vibeathon 02 (theme: Night shift).

- **Scan**: paste a Base contract, an NFT (`0x…#id`) or a name (`dana.base.eth`). Get a receipt of every field an agent would read, what was found, and a shareable report.
- **Night Ledger**: a nightly crawl of the newest tokens on Base, published as open data (CSV and JSON). Attacker addresses are masked until a person reviews them.
- **Guard**: a Go proxy for MCP and JSON-RPC. It labels what tools return as untrusted and denies or holds actions whose critical argument came from that text.
- **Attack Lab**: launch an injection with Guard off, then on, and see the provenance trace.

## Contents

[Layout](#layout) · [Run it](#run-it) · [How it works](#how-it-works) · [Limits](#limits-read-this) · [What is measured](#what-is-measured-so-far) · [Safety](#safety) · [Deploy](#deploy) · [Citations](#citations)

## Layout

```
packages/scanner   TypeScript scan engine: rules, hidden-text decoding, optional classifier, Base readers, CLI
packages/store     Shared store: Postgres or in-memory (scans, ledger, traces, rate limits)
apps/web           Next.js 16 site: landing, /scan, /s/[id], /ledger, /guard, /guard/lab, /guard/traces, APIs, share cards
apps/crawler       Night Ledger crawler: discovery, scan, address redaction, CLI
guard/             Go CLI (stdlib only): MCP proxy, JSON-RPC proxy, package and transaction checks
contracts/         Testnet-only demo coin (NITE) whose metadata carries visible and hidden orders
docs/              DEPLOY.md
```

## Run it

Needs Node 22+ and Go 1.22+ (Guard only).

```bash
npm install
cp .env.example .env              # optional: everything runs on public RPCs without it
npm test                          # scanner, store, crawler, web, contracts (contracts need `anvil`, else they skip)
npm run dev -w @sentinyx/web      # http://localhost:3000 (builds the workspace packages first)

npm run scan -- 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913     # CLI scan (any 0x…, 0x…#id, name.base.eth)
cd guard && go test ./... && go build -o sentinyx ./cmd/sentinyx
```

Without `DATABASE_URL` the web app keeps everything in memory and forgets it on restart. With a Neon or Supabase Postgres URL
the tables are created on first use.

Night Ledger and Guard commands:

```bash
npm run crawl -w @sentinyx/crawler -- --limit=40       # needs DATABASE_URL; add --memory for a dry run
npm run review -w @sentinyx/crawler                    # unreviewed items, with ids
npm run label -w @sentinyx/crawler -- <id> tp|fp       # hand-label one item
SENTINYX_BIN=/path/to/sentinyx npm run lab:record -w @sentinyx/web   # re-record the Attack Lab
```

## How it works

### Scan

`POST /api/scan { "target": "…" }` validates the target, reads every field an agent would read, runs detection, saves the report and
returns it with an `id` and `url`. Reports are cached for 10 minutes per target; scans are limited per IP (`SCAN_RATE_LIMIT`, default 10 a minute).

| Target | What is read |
|---|---|
| Any contract | `name()`, `symbol()`, ERC-7572 `contractURI()` metadata, verified source comments (Sourcify, then Blockscout) |
| Coins with `tokenURI()` | the coin's metadata JSON |
| NFTs | `tokenURI(id)` or `uri(id)` JSON: name, description, attributes |
| Names | resolved address and text records (description, url, notice, keywords, socials…) through the ENS universal resolver, which also resolves Basenames |

Plain ERC-20s have no onchain description. Sentinyx says “metadata”, never “token description”, unless the field really is one.
Contracts are looked up on Base first, then Base Sepolia, so testnet demo contracts can be scanned.

**Detection** (`packages/scanner/src/detect`):

1. **Hidden text first.** Unicode tag characters (the U+E0000 block) are decoded back to the ASCII they hide. Zero-width characters,
   bidirectional controls and base64 blobs that decode to instructions are flagged. Decoded text is then scanned like visible text, and
   findings inside it are always high severity.
2. **Rules** for instruction overrides, fake system messages, text addressed to agents, orders to move or approve funds, requests for
   secrets, and download-and-run commands.
3. **Combinations** escalate: speaking to agents plus a money order plus an unknown address is `combo.drain` (high).
4. **Optional language-model second opinion.** With `ANTHROPIC_API_KEY` set, long or suspicious fields are also read by a classifier.
   The scanned text goes inside `<untrusted_text>` tags (with any closing tag in the text neutralised), the model is told it is data,
   and only a small JSON verdict is accepted. The classifier can raise a verdict, never lower one.

**Verdicts.** Any high finding makes a field `flagged`; any medium makes it `suspicious`; otherwise `clean`. A report takes the worst
field verdict. A field that could not be read becomes a warning, never a silent skip, and a clean report with warnings says it is
not a full all-clear.

**Fetching metadata** is the one place the scanner touches attacker-chosen URLs, so it is locked down: https, ipfs, ar and data URIs
only; every IP-address spelling refused; hostnames resolved and refused if they point at a private address; no redirects; 256 KB and
6 s caps. IPFS is tried on several public gateways because they rate-limit.

### Night Ledger

Each night (03:00 UTC through Vercel Cron, or `npm run crawl`) the crawler takes the newest tokens that started trading on Base
(GeckoTerminal new pools), skips ones already scanned, and runs the same scanner on each. Flagged reports are stored with addresses
masked; the public table shows masked excerpts only. Precision is `true positives / hand-labelled items` and stays “—” until
someone labels items with `npm run review` and `npm run label` in `apps/crawler`. A clean crawl is a valid result and is published.

### Guard

Guard sits between an agent and its tools. Every value that comes back from a tool is labelled `untrusted:<origin>`, and Guard remembers
the addresses, package names and commands inside it. Before a side effect it checks the critical arguments:

- a recipient, spender, package or shell command that matches untrusted text is **denied**;
- a tainted amount, target contract or URL is **held**;
- unlimited approvals, `setApprovalForAll`, contract creation and undecodable transactions are **held**;
- any internal error is **held**. Guard fails closed.

Every decision is written as a JSON line (`id, agent, action, args, provenance, decision, reason, created_at`) that the web app shows.
Details and test coverage are in [`guard/README.md`](guard/README.md).

Real agents can upload traces with `POST /api/traces` (JSON lines, `Authorization: Bearer $TRACE_INGEST_TOKEN`). The endpoint refuses
everything unless that token is set. Recorded Attack Lab traces are always tagged “Lab, recorded”.

### Attack Lab

The Lab replays **recorded runs**: a scripted agent drives the real `sentinyx` binary against a sandbox MCP wallet and file reader.
The decisions are the binary's real output. No chain is touched and nothing is signed, and the page says so.

### Demo coin

`contracts/` has a testnet-only ERC-20, “Night Pepe” (NITE), whose `contractURI()` metadata carries a visible order and a second order
hidden in invisible Unicode tag characters. The deploy script refuses any chain except Base Sepolia and a local anvil, and reads its key
from `DEPLOYER_PRIVATE_KEY` only. Its tests deploy it to a local chain, check it is a working ERC-20, and check the scanner flags both orders.

## Limits (read this)

- **The rules are patterns.** Someone who paraphrases an instruction can get past them. The classifier helps when enabled, but it is
  also fallible. Scans can be wrong, and every report says so and has a “report a false positive” form.
- **Guard matches values; it does not follow data flow.** It catches a poisoned address the model passes through verbatim. It will not
  catch a value the model retypes differently, base64-encodes, splits across arguments, or learns from a source Guard never saw.
  Amounts are only matched as verbatim decimal strings. Labels are not propagated through derived values.
- **No transaction simulation.** Guard decodes transactions; it does not run them against a fork.
- **Guard has no approval channel.** A held action stays held; there is no Allow button.
- **Guard is tested against a fake MCP server and hand-encoded transactions**, not against a real MCP client or a live node. Only npm
  packages are registry-checked.
- **The Night Ledger only sees what tokens publish.** Many new tokens expose little beyond a name and a symbol, so “clean” means nothing
  readable was addressed to agents. Discovery depends on one third-party source.
- **Scope:** Base and Base Sepolia. Names resolve through Ethereum mainnet's ENS.
- **The Lab is a replay,** not a live agent.

## What is measured so far

Only what has actually been run:

- A real crawl of 40 live Base tokens found 0 flagged and 0 suspicious. Most of the tokens inspected exposed only a name and a symbol.
- Detector precision, recall and attack-success rates have **not** been measured. The Ledger shows “—” for precision until items are
  hand-labelled, and no recall number exists. Do not quote any.
- Tests cover each rule, the hidden-text decoders, the fetch safety checks, the stores (the same suite runs against the in-memory
  store and a real Postgres engine), the crawler, the API handlers, the demo coin on a local chain, and Guard's policy.

## Safety

- Scanned text is attacker-controlled data. It is never executed, never followed, and only ever rendered as plain text, with invisible
  and direction-changing characters made visible.
- No secrets in the repo. Configuration comes from environment variables; `.env.example` lists names only.
- Demo wallets and contracts are testnet-only.
- The cron and trace-upload endpoints refuse to run unless their secret is configured.

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the Vercel and Postgres steps.

## Citations

As listed in the project brief. Check the details before quoting them.

- Greshake et al. (2023). Indirect prompt injection against LLM-integrated applications.
- AgentDojo (ETH Zurich, 2024). A benchmark environment for prompt-injection attacks and defences against LLM agents.
- CaMeL (Google DeepMind, 2025). Defeating prompt injection by design with capability-style provenance tracking: the idea behind Guard's labels.
- Spracklen et al. (USENIX Security 2025). Package hallucinations by code-generating LLMs (“slopsquatting”).

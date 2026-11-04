# Sentinyx Guard

A single Go binary (`sentinyx`, stdlib only, Go 1.22+) that sits between an agent and its tools and blocks side effects whose critical arguments came from untrusted text.

```bash
cd guard && go test ./... && go build -o sentinyx ./cmd/sentinyx
```

```
sentinyx wrap  [flags] -- <mcp server cmd> [args]   stdio MCP proxy
sentinyx rpc   --upstream <url> [--listen 127.0.0.1:8545]   JSON-RPC proxy (Base)
sentinyx check pkg <name>                            npm lookup + taint check
sentinyx check tx  <raw-signed-tx | calldata --to 0x…>
```

Common flags: `--agent NAME`, `--trace FILE` (default `sentinyx-trace.jsonl`, `-` = stderr), `--taint-file FILE`, `--allow 0xADDR` (repeatable). `check` exit codes: `0` allow, `2` deny, `3` hold (also on any internal error), `64` usage.

## What it does, honestly

**This is value matching, not data-flow tracking.** Guard cannot see inside the model. It records the addresses, package names, shell commands, URLs and amounts that appear in tool results (labelled `untrusted:tool:<name>`), and later checks whether a side-effect call's critical argument equals one of them.

- It catches the common injection shape: poisoned text says "send to 0xATTACKER", the model passes that address through verbatim into a tool call.
- It does **not** catch a value the model re-types differently, transforms (base64, split across arguments, ENS name resolved elsewhere), computes, or learns from a source Guard never saw (e.g. text the user pasted that contained the attacker's address is `user`-trusted only if you say so; text read by a tool *outside* the proxy is invisible).
- Amounts are matched only as verbatim decimal strings near a money-moving verb in untrusted text. Base-unit vs human-unit differences (`100` vs `100000000`) are not reconciled. A tainted amount alone is a **hold**, never a deny.
- A tainted *target contract* is a **hold**, not a deny, because legitimate scans legitimately mention contract addresses.
- A shell command is tainted if it contains (or is contained in) a command recorded from untrusted text. `curl … | sh` lines, `npm/pip/cargo/go install` packages and `npx` targets are extracted from untrusted text; install targets and addresses inside a shell command are also checked individually.
- Default-allow: a value Guard has never seen in untrusted text is `unlabeled` and allowed. `unlabeled` ≠ `user`: Guard can't tell who produced it. Only `--allow` addresses (and `Tracker.Register(user, …)`) are labelled `user`. A `user`/`trusted` label wins over an untrusted sighting of the same value.
- Labels are not propagated through derived values (there is no data flow to follow); the only "derivation" handled is the verbatim substring/command-contains match above.

## Policy

`allow | deny | hold`. Tainted recipient / spender / package / command ⇒ **deny**. Tainted amount, target contract, URL, or any other address ⇒ **hold**. Also **hold**: unlimited approval (≥ 2^255), `setApprovalForAll(_, true)`, contract creation, EIP-7702 transactions, malformed calldata for a known function, undecodable transactions, unparseable `tools/call` params. **Fail closed:** a provenance lookup error (e.g. unreadable/corrupt taint file), a panic, or a missing provenance source becomes `hold`. A denied/held MCP call is answered to the agent with a tool error (`isError`) and never forwarded. Held actions are only recorded in the trace; there is no human approval UI in this binary (that's the web app's job).

## MCP (`wrap`)

stdio, newline-delimited JSON-RPC, batches handled. Every result for `tools/call` and `resources/read` is labelled `untrusted:tool:<name>` / `untrusted:resource:<uri>` (or `trusted` for `--trusted-tool NAME`) before it is forwarded unchanged. Roles for `tools/call` arguments come from argument **names** (`to`/`recipient`, `spender`, `amount`, `package`, `command`/`cmd`/`script`, …), not tool names. Unknown tools are not blocked, but any tainted address in their arguments ⇒ hold. Taint is recorded when the result arrives; a call issued before the result came back cannot be tainted by it.

## JSON-RPC (`rpc`)

HTTP proxy. `eth_sendRawTransaction` (legacy, 2930, 1559, 4844, 7702) and `eth_sendTransaction` are decoded: ETH `to`/`value`, ERC-20 `transfer` / `transferFrom` / `approve` / `increaseAllowance`, ERC-721 `setApprovalForAll` / `safeTransferFrom`; for unknown selectors, address-shaped calldata words are checked. Everything else is forwarded. No transaction simulation (simulating the transaction on a fork of Base is **not** implemented). Blocked requests get JSON-RPC error `-32001` (deny) or `-32002` (hold) with the trace id in `error.data`.

`rpc` does not see tool output, so it learns taint from a shared file or HTTP: run `wrap` and `rpc` with the same `--taint-file`, or have the agent harness `POST /_sentinyx/observe {"origin":"…","text":"…"}` (loopback only; can only add `untrusted:*` taint, never trust).

## Package check

`check pkg` validates the npm name (rejects anything else before building a URL), asks the registry: missing ⇒ deny (likely hallucinated), first published < 7 days ago ⇒ hold, network/HTTP/parse error ⇒ hold. Only npm is checked; pip/cargo/go packages are taint-checked only. Not a malware or typosquat scanner.

## Trace

One JSON object per line: `id, agent, action, args, provenance, decision, reason, created_at`. String args are truncated to 512 chars. Tool arguments are logged as given, so don't put secrets in tool arguments you wouldn't want in a local file (the file is created `0600`).

## Verified (see `go test ./...`)

Table-driven tests for the policy engine (engine error / panic / nil source ⇒ hold, tainted recipient ⇒ deny, user recipient ⇒ allow), extraction (including that ordinary prose stays clean), raw-tx/calldata decoding, the HTTP RPC proxy against a fake upstream, npm lookups against a fake registry, the CLI exit codes, and an MCP end-to-end test that spawns a fake MCP server process and checks that blocked calls never reach it.

## Not verified

Not tested against a real MCP client or real MCP servers (only the fake server and a Python stand-in); not tested against a live Base/Base Sepolia node or with real signed transactions (test transactions are hand-encoded RLP); `check pkg` was exercised against the real npm registry by hand only. No simulation, no signature/sender recovery, no HTTP-transport MCP (stdio only).

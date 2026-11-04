# Deploying Sentinyx

Deadline: **Mon 9 Nov 2026, 22:00 UTC**. Do this by Saturday so there is time to fix surprises. Never paste a secret into a chat, an
issue or a commit. Set them in the Vercel dashboard only.

## 1. Postgres

Create a database on [Neon](https://neon.tech) or Supabase and copy its **connection string** (it starts with `postgres://`). The app
creates its own tables on first use (`scans`, `feedback`, `rate_hits`, `crawls`, `ledger_scanned`, `ledger_items`, `traces`).

## 2. Code on GitHub

This folder is not a git repository yet.

```bash
git init && git add -A && git commit -m "Sentinyx"
# create an empty GitHub repo, then:
git remote add origin git@github.com:YOU/sentinyx.git && git push -u origin main
```

Check `git status` shows no `.env` (it is in `.gitignore`).

## 3. Vercel project

1. Import the repo. Set **Root Directory** to `apps/web` and keep **Include source files outside of the Root Directory** on.
2. Framework: Next.js. Node.js version: 22.x. Leave the install and build commands on their defaults: `npm run build` first
   builds the scanner, store and crawler packages.
3. Add environment variables (Production):

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | the Postgres connection string |
| `NEXT_PUBLIC_SITE_URL` | yes | e.g. `https://your-app.vercel.app`, used for share cards |
| `CRON_SECRET` | yes | a long random string. Without it the crawl route refuses to run |
| `TRACE_INGEST_TOKEN` | yes | a long random string. Without it trace upload is closed |
| `BASE_RPC_URL` | strongly advised | a dedicated Base RPC. The public one rate-limits under load |
| `ETH_RPC_URL` | advised | a dedicated Ethereum RPC for Basename resolution |
| `ANTHROPIC_API_KEY` | optional | turns on the language-model second opinion |
| `NEXT_PUBLIC_DEMO_COIN` | after step 5 | the Base Sepolia demo coin address, adds a one-click example |
| `SCAN_RATE_LIMIT` | optional | scans per minute per IP, default 10 |

Generate secrets with `openssl rand -hex 32`.

4. Deploy. `vercel.json` (in `apps/web`) schedules `/api/cron/crawl` at 03:00 UTC.

## 4. Check it works

Replace `$SITE`:

```bash
curl -s -X POST $SITE/api/scan -H 'content-type: application/json' -d '{"target":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"}' | head -c 300   # 200, verdict clean, under ~8 s
curl -s -X POST $SITE/api/scan -H 'content-type: application/json' -d '{"target":"hello"}'                                                          # 400
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/cron/crawl                                                                                       # 401
```

Then open `$SITE/s/<id>` from the first response, and view the share card at `$SITE/s/<id>/opengraph-image`.

## 5. Demo coin on Base Sepolia (you, with your own testnet key)

Use a **throwaway** key funded with Base Sepolia test ETH from a faucet. Set the key only in your shell, never in a file that is committed.

```bash
export DEPLOYER_PRIVATE_KEY=0x…                       # throwaway testnet key
export DEMO_ATTACKER_ADDRESS=0x…                      # a testnet address you control (shown in the metadata)
npm run build -w @sentinyx/contracts
npm run deploy -w @sentinyx/contracts -- --chain base-sepolia --dry-run    # checks everything, sends nothing
npm run deploy -w @sentinyx/contracts -- --chain base-sepolia
unset DEPLOYER_PRIVATE_KEY
```

It prints the contract address. Scan it: `npm run scan -w @sentinyx/scanner -- 0xADDRESS sepolia`, expect **flagged**, with the hidden text
decoded. Then set `NEXT_PUBLIC_DEMO_COIN` in Vercel and redeploy.

## 6. Seed real data

```bash
# first Night Ledger crawl, now instead of waiting for 03:00 UTC
curl -s -H "Authorization: Bearer $CRON_SECRET" $SITE/api/cron/crawl

# make the recorded Attack Lab traces appear as stored traces (optional; they already show tagged "Lab, recorded")
SITE=$SITE TRACE_INGEST_TOKEN=… npm run lab:upload -w @sentinyx/web
```

Run the crawl on a few nights if you can: each run scans up to 40 new tokens and stops after 45 s.

## 7. Label some items (this is what makes precision real)

```bash
export DATABASE_URL=…            # same string as Vercel
npm run review -w @sentinyx/crawler
npm run label  -w @sentinyx/crawler -- <item id> tp      # or fp
```

Precision on `/ledger` is `tp / labelled` and shows “—” until there is at least one label. Only label what you have actually checked.

## Known limits on Vercel

- Functions have a time limit. `/api/scan` allows 30 s and the crawl 60 s.
- The in-process rate limiter lives in Postgres, so it works across instances.
- The scanner makes outbound requests to RPCs, Sourcify, IPFS gateways and GeckoTerminal. If one is down, reports show a warning.

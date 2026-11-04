import type { Metadata } from "next";
import Link from "next/link";
import { BadgeBuilder } from "@/components/BadgeBuilder";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata: Metadata = {
  title: "Use it",
  description: "Check a token before your agent reads it, show a badge on your own token, or read the Night Ledger as open data.",
};

const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const CURL = `curl "${site}/api/check?target=${USDC}"`;
const SHAPE = `{
  "target": "${USDC}",
  "chain": "base",
  "verdict": "clean",
  "action": "allow",
  "complete": true,
  "findings": [],
  "report": "${site}/s/…",
  "method": "…"
}`;
const JS = `const res = await fetch(\`${site}/api/check?target=\${token}\`);
const check = await res.json();

// allow: nothing is addressed to agents. hold: worth a look. deny: do not let an agent read it.
if (check.action !== "allow") {
  throw new Error(\`Sentinyx says \${check.action} for \${token}: \${check.report}\`);
}`;
const GUARD = `# in a script, a CI step or an agent's tool wrapper
sentinyx check token ${USDC}
# exit 0 allow, 2 deny, 3 hold (also for any error: it fails closed)

# sit between an agent and its tools
sentinyx wrap -- npx some-mcp-server`;

const USERS = [
  {
    who: "Agent and bot builders",
    what: "Your agent reads a token's name, metadata and source before it trades or lists it. Call one URL first. If the answer is not “allow”, the agent never reads the text.",
    how: "GET /api/check",
  },
  {
    who: "Token and NFT launchers",
    what: "Show people that nothing in your metadata is written for machines. One line of Markdown puts a live badge in your README or site.",
    how: "/badge/0x….svg",
  },
  {
    who: "Researchers and reporters",
    what: "Every night the newest tokens on Base are scanned and published. Take the CSV or JSON, with attacker addresses masked.",
    how: "Night Ledger data",
  },
  {
    who: "Teams running agents",
    what: "Guard labels what tools return as untrusted and blocks transfers, installs and shell commands that came from that text.",
    how: "sentinyx wrap",
  },
];

const COMPARE: { what: string; explorer: string; scanner: string; us: string }[] = [
  { what: "Shows a token's metadata text", explorer: "Yes, as raw text", scanner: "Usually not", us: "Yes, every field an agent reads" },
  { what: "Flags text written for AI agents", explorer: "No", scanner: "No", us: "Yes" },
  { what: "Decodes hidden characters", explorer: "No", scanner: "No", us: "Yes, then scans what they say" },
  { what: "Gives a program a yes or no", explorer: "No", scanner: "For rug and honeypot checks", us: "allow, hold or deny" },
  { what: "Stops the agent acting on it", explorer: "No", scanner: "No", us: "Guard" },
];

const PLAN = [
  { when: "Now", text: "Free and public. No account and no wallet. Scans are limited to about ten new ones a minute per IP; answers we already have are free." },
  { when: "How it pays", text: "Free scans and open data stay free. The people who would pay are teams running agents with real funds: higher limits, alerts and a hosted Guard with approvals. That is a plan, not something for sale today." },
  { when: "Next", text: "API keys with higher limits, alerts when a token you care about changes, and the language-model second opinion on by default." },
  { when: "Later", text: "Guard with an approval channel, so a held action can be allowed by a person, and more chains." },
];

export default function UsePage() {
  return (
    <main id="main">
      <section className="page" style={{ paddingBottom: 30 }}>
        <span className="kicker mono">Use it</span>
        <h1 className="title" style={{ marginTop: 12 }}>
          Check before your agent reads.
        </h1>
        <p className="sub">
          Sentinyx is useful from one line of code. Ask whether a token&apos;s text is safe to read, put the answer on your own token, or build
          on the open data. Everything here is free and needs no account.
        </p>

        <div className="use-who">
          {USERS.map((u) => (
            <article key={u.who} className="use-card">
              <h2>{u.who}</h2>
              <p>{u.what}</p>
              <span className="mono">{u.how}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="page use-section" aria-labelledby="api-h">
        <h2 id="api-h" className="h-small">1 · Ask before the agent reads</h2>
        <p className="sub">
          One GET request. It works for any contract, an NFT as <code>0x…#id</code>, or a name. If it hasn&apos;t seen the token lately it scans it
          first, so allow a few seconds.
        </p>
        <div className="use-code">
          <CodeBlock label="curl" code={CURL} />
          <CodeBlock label="The answer" code={SHAPE} />
          <CodeBlock label="JavaScript" code={JS} />
        </div>
        <p className="reading-note">
          The answer says where findings are and which rule fired. It never repeats the scanned text, because an agent may read the response.
          Add <code>&amp;chain=base</code> or <code>base-sepolia</code> to pick a network. When <code>complete</code> is false, some fields
          could not be read, so “allow” is not a full all-clear.
        </p>
      </section>

      <section className="page use-section" aria-labelledby="badge-h">
        <h2 id="badge-h" className="h-small">2 · Show it on your token</h2>
        <p className="sub">A small live badge for your README, docs or site. It reads the latest scan and never starts one by itself.</p>
        <BadgeBuilder site={site} />
      </section>

      <section className="page use-section" aria-labelledby="guard-h">
        <h2 id="guard-h" className="h-small">3 · Guard, from the command line</h2>
        <p className="sub">
          The same check as a command for scripts and agent wrappers, and the proxy that blocks actions steered by untrusted text. See it
          in the <Link href="/guard/lab">Attack Lab</Link>.
        </p>
        <div className="use-code">
          <CodeBlock label="shell" code={GUARD} />
        </div>
      </section>

      <section className="page use-section" aria-labelledby="diff-h">
        <h2 id="diff-h" className="h-small">Why not what already exists</h2>
        <p className="sub">Explorers show the text and scanners check how a token behaves. Neither asks whether the text is written for a machine.</p>
        <div className="use-table-wrap">
          <table className="use-table">
            <thead>
              <tr>
                <th scope="col"> </th>
                <th scope="col">Block explorer</th>
                <th scope="col">Token security scanner</th>
                <th scope="col">Sentinyx</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.what}>
                  <th scope="row">{r.what}</th>
                  <td>{r.explorer}</td>
                  <td>{r.scanner}</td>
                  <td>{r.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="reading-note">Typical behaviour of each kind of tool; individual products vary.</p>
      </section>

      <section className="page use-section" aria-labelledby="plan-h">
        <h2 id="plan-h" className="h-small">Where this goes</h2>
        <p className="sub">Plans, not promises. Today it is the first line.</p>
        <ol className="use-plan">
          {PLAN.map((p) => (
            <li key={p.when}>
              <span className="mono">{p.when}</span>
              <p>{p.text}</p>
            </li>
          ))}
        </ol>
        <p className="reading-note">
          Want something here sooner, or found a miss? Open a scan and use “report a false positive”, or{" "}
          <Link href="/ledger">read the Night Ledger</Link>.
        </p>
      </section>
    </main>
  );
}

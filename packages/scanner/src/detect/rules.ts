import type { DetectContext, Finding, Verdict } from "../types.js";
import { detectHidden } from "./hidden.js";

interface Rule {
  id: string;
  severity: Finding["severity"];
  message: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: "override.instructions",
    severity: "high",
    message: "Tells the reader to drop its instructions.",
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,25}\b(all\s+)?(previous|prior|above|earlier|your|system|original)\b[^.\n]{0,15}\b(instructions?|prompts?|rules|directions|guidelines|task)\b/i,
  },
  {
    id: "spoof.role",
    severity: "high",
    message: "Pretends to be a system or assistant message.",
    pattern: /(^|\n)\s*(system|assistant)\s*[:>]|<\/?\s*(system|instructions?|im_start|im_end)\s*>|\[\s*\/?INST\s*\]/i,
  },
  {
    id: "address.agents",
    severity: "medium",
    message: "Speaks directly to AI agents or assistants.",
    pattern:
      /\b(ai|llm|language model|assistant|autonomous)\s*(agents?|models?|bots?|assistants?)?\b\s*(reading this|that read|:|,)|\b(attention|note to|dear|hey|to all)\b[^.\n]{0,12}\b(ai|agents?|assistants?|bots?|llms?)\b/i,
  },
  {
    id: "money.imperative",
    severity: "medium",
    message: "Orders the reader to move or approve funds.",
    pattern:
      /\b(send|transfer|move|bridge|withdraw|approve|sweep|drain|forward)\b[^.\n]{0,40}\b(all|entire|full|whole|max(imum)?|unlimited|remaining|your)\b[^.\n]{0,20}\b(funds|balance|tokens|usdc|eth|assets|allowance|holdings)\b/i,
  },
  {
    id: "secrets.request",
    severity: "high",
    message: "Asks for keys, seed phrases or environment secrets.",
    pattern: /\b(private key|seed phrase|mnemonic|secret key|api key|\.env)\b[^.\n]{0,40}\b(send|post|share|paste|reveal|print|attach|upload)\b|\b(send|post|share|paste|reveal|print|attach|upload)\b[^.\n]{0,40}\b(private key|seed phrase|mnemonic|secret key|api key|\.env)\b/i,
  },
  {
    id: "exec.shell",
    severity: "high",
    message: "Contains a command that downloads and runs code.",
    pattern: /\b(curl|wget)\b[^\n|]{0,120}\|\s*(sudo\s+)?(ba|z)?sh\b|\bnpx\s+-y\s+\S+|\bpowershell\b[^\n]{0,40}\biex\b/i,
  },
  {
    id: "url.lure",
    severity: "low",
    message: "Tells the reader to open or fetch a link.",
    pattern: /\b(visit|go to|open|fetch|load|call|read)\b[^.\n]{0,20}https?:\/\/\S+/i,
  },
];

// Exactly 40 hex digits: not the head of a 64-digit hash or a longer hex string.
const ADDRESS = /(?<![a-fA-F0-9])0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;

function excerpt(text: string, start: number, end: number): string {
  const a = Math.max(0, start - 30);
  const b = Math.min(text.length, end + 30);
  return (a > 0 ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ") + (b < text.length ? "…" : "");
}

export function detectRules(text: string, ctx: DetectContext = {}): Finding[] {
  if (!text || !text.trim()) return [];
  const { findings, revealed } = detectHidden(text);

  // Run the text rules over the visible text and anything hidden inside it.
  const corpora = [text, ...revealed];
  for (const body of corpora) {
    for (const rule of RULES) {
      const m = rule.pattern.exec(body);
      if (!m) continue;
      const isHidden = body !== text;
      findings.push({
        rule: rule.id,
        severity: isHidden ? "high" : rule.severity,
        message: isHidden ? `${rule.message} (inside hidden text)` : rule.message,
        excerpt: excerpt(body, m.index, m.index + m[0].length),
        start: isHidden ? 0 : m.index,
        end: isHidden ? 0 : m.index + m[0].length,
      });
    }
  }

  const known = new Set((ctx.knownAddresses ?? []).map((a) => a.toLowerCase()));
  for (const m of text.matchAll(ADDRESS)) {
    if (known.has(m[0].toLowerCase())) continue;
    findings.push({
      rule: "address.foreign",
      severity: "low",
      message: "Mentions an address that isn’t this contract or its owner.",
      excerpt: excerpt(text, m.index!, m.index! + m[0].length),
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }

  // Combinations matter more than single hits:
  // speaking to agents + ordering a money move (+ an unknown address) is the classic drain.
  const has = (id: string) => findings.some((f) => f.rule === id);
  if (has("money.imperative") && (has("address.agents") || has("address.foreign"))) {
    findings.push({
      rule: "combo.drain",
      severity: "high",
      message: "Directs an agent to move funds" + (has("address.foreign") ? " to an unknown address." : "."),
      excerpt: findings.find((f) => f.rule === "money.imperative")!.excerpt,
      start: 0,
      end: 0,
    });
  }

  return dedupe(findings);
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = `${f.rule}:${f.start}:${f.excerpt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function verdictFor(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === "high")) return "flagged";
  const mediums = findings.filter((f) => f.severity === "medium").length;
  if (mediums >= 1) return "suspicious";
  return "clean";
}

export function worst(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("flagged")) return "flagged";
  if (verdicts.includes("suspicious")) return "suspicious";
  return "clean";
}

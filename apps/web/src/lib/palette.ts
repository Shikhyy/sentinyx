export const REPO = process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/Shikhyy/sentinyx";

export interface Command {
  id: string;
  label: string;
  hint: string;
  href: string;
  keywords: string;
  external?: boolean;
  download?: boolean;
}

export const COMMANDS: Command[] = [
  { id: "scan", label: "Scan", hint: "Page", href: "/scan", keywords: "paste address token nft name check" },
  { id: "ledger", label: "Night Ledger", hint: "Page", href: "/ledger", keywords: "crawl nightly open data tokens" },
  { id: "guard", label: "Guard: Morning brief", hint: "Page", href: "/guard", keywords: "agents shift blocked held overview" },
  { id: "lab", label: "Attack Lab", hint: "Page", href: "/guard/lab", keywords: "demo attack injection guard on off" },
  { id: "traces", label: "Traces", hint: "Page", href: "/guard/traces", keywords: "guard decisions log lineage" },
  { id: "how", label: "How it works", hint: "Page", href: "/#how", keywords: "poisoned token steps explain" },
  { id: "csv", label: "Download Ledger CSV", hint: "Download", href: "/ledger/data.csv", keywords: "data export spreadsheet", download: true },
  { id: "json", label: "Download Ledger JSON", hint: "Download", href: "/ledger/data.json", keywords: "data export api", download: true },
  { id: "source", label: "Source on GitHub", hint: "Opens a new tab", href: REPO, keywords: "code repo open source", external: true },
];

export interface QuickTarget {
  kind: "address" | "nft" | "name";
  value: string;
}

/** Is this text something the scanner can take? Mirrors the scanner's `parseTarget`, without its chain libraries, so it stays light in the browser. */
export function quickTarget(input: string): QuickTarget | null {
  const s = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) return { kind: "address", value: s };
  if (/^0x[a-fA-F0-9]{40}[#/:]\d{1,78}$/.test(s)) return { kind: "nft", value: s };
  if (s.length <= 255 && /^[a-z0-9-_.]+\.eth$/i.test(s)) return { kind: "name", value: s.toLowerCase() };
  return null;
}

/** Every word typed must appear in the label or keywords. Label-prefix matches come first, then label matches, then keyword-only. */
export function filterCommands(query: string, commands: Command[] = COMMANDS): Command[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  const scored: { c: Command; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const label = c.label.toLowerCase();
    const hay = `${label} ${c.keywords}`;
    if (!words.every((w) => hay.includes(w))) return;
    const score = label.startsWith(words[0]) ? 0 : words.every((w) => label.includes(w)) ? 1 : 2;
    scored.push({ c, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((x) => x.c);
}

export interface Row {
  key: string;
  group: string;
  label: string;
  right: string;
  /** Present when this row scans a pasted target. */
  scan?: string;
  cmd?: Command;
}

/** The rows the palette shows for some text. Keys are unique even when a pasted target sits above the "Scan" page command. */
export function buildRows(query: string): Row[] {
  const t = quickTarget(query);
  if (t) {
    return [
      { key: "scan-target", group: "Scan", label: `Scan ${shortTargetLabel(t.value)}`, right: t.kind === "name" ? "Name" : t.kind === "nft" ? "NFT" : "Contract", scan: t.value },
      ...COMMANDS.slice(0, 4).map((c) => ({ key: `cmd-${c.id}`, group: "Go to", label: c.label, right: c.hint, cmd: c })),
    ];
  }
  return filterCommands(query).map((c) => ({ key: `cmd-${c.id}`, group: "Go to", label: c.label, right: c.hint, cmd: c }));
}

export function shortTargetLabel(v: string): string {
  const m = v.match(/^(0x[a-fA-F0-9]{40})(.*)$/);
  if (m) return `${m[1].slice(0, 6)}…${m[1].slice(-4)}${m[2]}`;
  return v.length > 30 ? v.slice(0, 28) + "…" : v;
}

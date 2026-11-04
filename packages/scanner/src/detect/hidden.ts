import type { Finding } from "../types.js";

// U+200C/200D (joiners) and U+200E/200F (direction marks) appear in ordinary emoji and
// right-to-left text, so they are not counted. The rest have almost no legitimate use mid-text.
const ZERO_WIDTH = /[\u200B\u2060-\u2064\uFEFF]/g;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
// Unicode "tag" characters (U+E0000–U+E007F) render as nothing but map 1:1 to ASCII.
// Attackers use them to smuggle instructions that people can't see but models read.
const TAGS = /[\u{E0000}-\u{E007F}]+/gu;
const BASE64 = /[A-Za-z0-9+/]{60,}={0,2}/g;

const INSTRUCTION_WORDS = /\b(ignore|instructions?|assistant|agent|send|transfer|approve|system|prompt)\b/i;

function excerpt(text: string, start: number, end: number): string {
  const a = Math.max(0, start - 30);
  const b = Math.min(text.length, end + 30);
  return (a > 0 ? "…" : "") + text.slice(a, b) + (b < text.length ? "…" : "");
}

/** Decode Unicode tag characters back into the ASCII they hide. */
export function decodeTags(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
  }
  return out;
}

export function detectHidden(text: string): { findings: Finding[]; revealed: string[] } {
  const findings: Finding[] = [];
  const revealed: string[] = [];

  for (const m of text.matchAll(TAGS)) {
    const hidden = decodeTags(m[0]);
    if (!hidden.trim()) continue;
    revealed.push(hidden);
    findings.push({
      rule: "hidden.unicode-tags",
      severity: "high",
      message: `Invisible Unicode tag characters hide this text: “${hidden.slice(0, 120)}”`,
      excerpt: hidden.slice(0, 160),
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }

  const zw = [...text.matchAll(ZERO_WIDTH)];
  if (zw.length >= 3) {
    findings.push({
      rule: "hidden.zero-width",
      severity: "medium",
      message: `${zw.length} zero-width characters. These are often used to hide or split instructions.`,
      excerpt: excerpt(text.replace(ZERO_WIDTH, "⟨ZW⟩"), zw[0].index!, zw[0].index! + 1),
      start: zw[0].index!,
      end: zw[zw.length - 1].index! + 1,
    });
  }

  const bidi = [...text.matchAll(BIDI)];
  if (bidi.length > 0) {
    findings.push({
      rule: "hidden.bidi",
      severity: "medium",
      message: "Bidirectional control characters can make text display differently from how a model reads it.",
      excerpt: excerpt(text, bidi[0].index!, bidi[0].index! + 1),
      start: bidi[0].index!,
      end: bidi[0].index! + 1,
    });
  }

  for (const m of text.matchAll(BASE64)) {
    let decoded = "";
    try {
      decoded = Buffer.from(m[0], "base64").toString("utf8");
    } catch {
      continue;
    }
    const printable = decoded.replace(/[^\x20-\x7E]/g, "").length / Math.max(1, decoded.length);
    if (printable > 0.9 && INSTRUCTION_WORDS.test(decoded)) {
      revealed.push(decoded);
      findings.push({
        rule: "hidden.base64-instructions",
        severity: "high",
        message: `Base64 text decodes to instructions: “${decoded.slice(0, 120)}”`,
        excerpt: decoded.slice(0, 160),
        start: m.index!,
        end: m.index! + m[0].length,
      });
    }
  }

  return { findings, revealed };
}

export function visibleText(text: string): string {
  return text.replace(TAGS, "").replace(ZERO_WIDTH, "").replace(BIDI, "");
}

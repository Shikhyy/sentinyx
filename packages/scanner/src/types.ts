export type Severity = "low" | "medium" | "high";
export type Verdict = "clean" | "suspicious" | "flagged";
export type TargetKind = "erc20" | "erc721" | "erc1155" | "contract" | "name";
export type ChainName = "base" | "base-sepolia";

/** One piece of text an AI agent might read, and where it came from. */
export interface Field {
  /** Machine id of the source, e.g. "erc20.name", "contractURI.description", "basename.text:url". */
  source: string;
  /** Human label shown in the report, e.g. "Description". */
  label: string;
  text: string;
}

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Short excerpt around the match, for display. Never the whole field. */
  excerpt: string;
  start: number;
  end: number;
}

export interface FieldResult extends Field {
  findings: Finding[];
  verdict: Verdict;
  classifier?: ClassifierResult;
}

export interface ClassifierResult {
  label: "injection" | "benign";
  confidence: number;
  reason: string;
}

export interface ScanReport {
  target: string;
  kind: TargetKind;
  chain: ChainName;
  chainId: number;
  title: string;
  fields: FieldResult[];
  verdict: Verdict;
  scannedAt: string;
  method: string;
  /** Problems fetching data. A field that could not be read is listed here, not silently skipped. */
  warnings: string[];
}

export interface DetectContext {
  /** Addresses that legitimately belong to the target (the contract itself, its owner, its pool). */
  knownAddresses?: string[];
}

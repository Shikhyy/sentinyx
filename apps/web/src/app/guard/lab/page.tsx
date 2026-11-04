import type { Metadata } from "next";
import { AttackLab, type LabProps } from "@/components/AttackLab";
import { LAB_RECORDED_AT, labScenarios, shortAddrs } from "@/lib/traces";

export const metadata: Metadata = {
  title: "Attack Lab",
  description: "Launch a prompt-injection attack with Guard off, then on, and see the provenance trace.",
};

type Props = { searchParams: Promise<{ s?: string }> };

export default async function LabPage({ searchParams }: Props) {
  const { s } = await searchParams;
  const scenarios: LabProps["scenarios"] = labScenarios().map((sc) => {
    const final = sc.on.trace[sc.on.trace.length - 1];
    // The value that travels the untrusted lane: the argument Guard traced to untrusted text, else the first string argument.
    const key = Object.entries(final.provenance).find(([, v]) => v.startsWith("untrusted:"))?.[0];
    const raw = (key && final.args[key]) ?? Object.values(final.args).find((v) => typeof v === "string") ?? "value";
    return {
      id: sc.id, number: sc.number, title: sc.title, kind: sc.kind, task: sc.task,
      value: shortAddrs(String(raw)).slice(0, 26),
      off: { log: sc.off.log, word: sc.off.word, row: sc.off.row },
      on: { log: sc.on.log, word: sc.on.word, outcome: sc.on.outcome, traceId: final.id, reason: final.reason },
    };
  });
  return (
    <main id="main" className="page">
      <h1 className="title lab-title">Attack Lab</h1>
      <AttackLab scenarios={scenarios} initial={s ?? ""} recordedAt={LAB_RECORDED_AT} />
    </main>
  );
}

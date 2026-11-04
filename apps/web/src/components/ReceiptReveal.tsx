"use client";

import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion, scrambleTo } from "@/lib/scramble";

/** Statuses resolve one after another, like the receipt is being printed. Final content is server-rendered. */
export function ReceiptReveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    const root = ref.current!;
    const cells = [...root.querySelectorAll<HTMLElement>(".st")];
    const gap = Math.min(110, 1400 / Math.max(1, cells.length));
    const finals = cells.map((c) => c.textContent || "");
    const timers: number[] = [];
    const cancels: (() => void)[] = [];
    cells.forEach((c) => (c.textContent = "······"));
    cells.forEach((c, i) => timers.push(window.setTimeout(() => cancels.push(scrambleTo(c, finals[i], 320)), 120 + i * gap)));
    return () => {
      timers.forEach(clearTimeout);
      cancels.forEach((fn) => fn());
      cells.forEach((c, i) => (c.textContent = finals[i]));
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}

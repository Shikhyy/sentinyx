"use client";

import { useEffect, useRef } from "react";
import { scrambleTo } from "@/lib/scramble";

export function Wordmark() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            scrambleTo(el, "Sentinyx", 1000);
            io.disconnect();
          }
        }),
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="wordmark" ref={ref} aria-hidden="true">
      Sentinyx
    </div>
  );
}

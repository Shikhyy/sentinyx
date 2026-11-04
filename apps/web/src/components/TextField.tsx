"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/scramble";

const ROWS = [
  "NEW POOL / NAME / SYMBOL / CONTRACT METADATA / VERIFIED SOURCE / ",
  "WHAT AN AGENT READS BEFORE IT SWAPS / ",
  "READ EVERYTHING / OBEY NOTHING / ",
  "CONTRACTURI / TOKENURI / TEXT RECORDS / SOURCE COMMENTS / ",
];

/** Rows of text sliding at different speeds behind the Ledger hero. Pre-rendered once, paused off-screen. */
export function TextField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const reduce = prefersReducedMotion();
    let strips: { c: HTMLCanvasElement; unit: number; w: number }[] = [];
    let W = 0;
    let H = 0;
    const CH = 16;
    let ctx: CanvasRenderingContext2D;

    const build = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.25);
      const r = cv.getBoundingClientRect();
      W = r.width;
      H = r.height;
      cv.width = Math.max(1, Math.floor(W * dpr));
      cv.height = Math.max(1, Math.floor(H * dpr));
      ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cs = getComputedStyle(cv);
      const font = `500 12px ${getComputedStyle(document.body).getPropertyValue("--font-geist-mono") || "ui-monospace, monospace"}`;
      const ink = cs.getPropertyValue("--night-ink").trim() || "#E9E6DF";
      strips = ROWS.map((s) => {
        const c = document.createElement("canvas");
        const x = c.getContext("2d")!;
        x.font = font;
        const unit = x.measureText(s).width || 400;
        const reps = Math.ceil((W + unit) / unit) + 1;
        c.width = Math.ceil(unit * reps * dpr);
        c.height = Math.ceil(CH * dpr);
        const y = c.getContext("2d")!;
        y.setTransform(dpr, 0, 0, dpr, 0, 0);
        y.font = font;
        y.textBaseline = "top";
        y.fillStyle = ink;
        y.fillText(s.repeat(reps), 0, 1);
        return { c, unit, w: unit * reps };
      });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 0.09;
      const rows = Math.ceil(H / CH);
      for (let r = 0; r < rows; r++) {
        const st = strips[r % strips.length];
        const sp = (0.01 + (r % 5) * 0.005) * (r % 2 ? 1 : -1);
        const off = (((t * sp) % st.unit) + st.unit) % st.unit;
        ctx.drawImage(st.c, -off, r * CH, st.w, CH);
      }
      ctx.globalAlpha = 1;
    };

    build();
    let vis = false;
    let raf = 0;
    let last = 0;
    const io = new IntersectionObserver((e) => (vis = e[0].isIntersecting));
    io.observe(cv);
    if (reduce) draw(0);
    else {
      const tick = (t: number) => {
        raf = requestAnimationFrame(tick);
        if (!vis || t - last < 42) return;
        last = t;
        draw(t);
      };
      raf = requestAnimationFrame(tick);
    }
    let rt = 0;
    const onResize = () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => {
        build();
        if (reduce) draw(0);
      }, 150);
    };
    addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      removeEventListener("resize", onResize);
      clearTimeout(rt);
    };
  }, []);
  return <canvas ref={ref} className="field-bg" aria-hidden="true" />;
}

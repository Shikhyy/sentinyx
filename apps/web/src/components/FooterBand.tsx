"use client";

import { useEffect, useRef } from "react";

const SRC = [
  "MOONLIGHT FROGS IS A COMMUNITY TOKEN FOR NIGHT OWLS ON BASE / ",
  "FAIR LAUNCH / NO TEAM ALLOCATION / LP LOCKED / ",
  "NAME / SYMBOL / CONTRACT METADATA / VERIFIED SOURCE / TEXT RECORDS / ",
  "READ EVERYTHING / OBEY NOTHING / ",
];
const hash = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/** The page dissolves into the footer, character by character. Drawn once (no animation loop), redrawn on resize and theme change. */
export function FooterBand() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const draw = () => {
      const r = cv.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // hidden when the page already ends on night
      const dpr = Math.min(devicePixelRatio || 1, 1);
      cv.width = Math.floor(r.width * dpr);
      cv.height = Math.floor(r.height * dpr);
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const root = getComputedStyle(document.documentElement);
      const night = root.getPropertyValue("--night").trim() || "#1C1C1B";
      ctx.font = `500 12px ${getComputedStyle(cv).fontFamily}`;
      ctx.textBaseline = "top";
      ctx.fillStyle = night;
      const cw = 10;
      const ch = 15;
      const cols = Math.ceil(r.width / cw);
      const rows = Math.ceil(r.height / ch);
      for (let y = 0; y < rows; y++) {
        const f = Math.pow(y / (rows - 1), 1.25) * 1.15;
        const src = SRC[y % SRC.length];
        for (let x = 0; x < cols; x++) {
          const n = hash(x, y, 3);
          if (n < f) ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
          else if (n - f < 0.09) ctx.fillText(src[x % src.length], x * cw + 1, y * ch + 1);
        }
      }
    };
    draw();
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(draw, 150);
    };
    addEventListener("resize", onResize);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    return () => {
      removeEventListener("resize", onResize);
      mq.removeEventListener("change", draw);
      clearTimeout(t);
    };
  }, []);
  return <canvas ref={ref} className="foot-band-canvas" aria-hidden="true" />;
}

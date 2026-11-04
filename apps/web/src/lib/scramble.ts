export const GLY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/:.";

export const prefersReducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Characters resolve left to right out of random glyphs. Returns a cancel function. */
export function scrambleTo(el: { textContent: string | null }, txt: string, ms: number): () => void {
  if (prefersReducedMotion()) {
    el.textContent = txt;
    return () => {};
  }
  let alive = true;
  const t0 = performance.now();
  const f = (now: number) => {
    if (!alive) return;
    const p = Math.min(1, (now - t0) / ms);
    const n = Math.floor(p * txt.length);
    let o = txt.slice(0, n);
    for (let i = n; i < txt.length; i++) o += txt[i] === " " ? " " : GLY[(Math.random() * GLY.length) | 0];
    el.textContent = o;
    if (p < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  return () => {
    alive = false;
    el.textContent = txt;
  };
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { prefersReducedMotion, scrambleTo } from "@/lib/scramble";

interface NavLink {
  href: string;
  label: string;
  id?: string;
  dot?: boolean;
}

const LANDING: NavLink[] = [
  { href: "#read", id: "read", label: "What agents read" },
  { href: "#how", id: "how", label: "How it works" },
  { href: "#scan", id: "scan", label: "Scan", dot: true },
  { href: "#guard", id: "guard", label: "Guard" },
];
const PUBLIC: NavLink[] = [
  { href: "/scan", label: "Scan", dot: true },
  { href: "/ledger", label: "Ledger" },
  { href: "/guard", label: "Guard" },
];
const GUARD: NavLink[] = [
  { href: "/guard", label: "Morning brief" },
  { href: "/guard/lab", label: "Attack Lab" },
  { href: "/guard/traces", label: "Traces" },
  { href: "/scan", label: "Scan" },
];

const TICKER = ["Free, no wallet needed", "Reads what your agent reads", "Guard ships as one CLI"];

export function Nav() {
  const path = usePathname();
  const isLanding = path === "/";
  const links = isLanding ? LANDING : path.startsWith("/guard") ? GUARD : PUBLIC;
  const logo = useRef<HTMLCanvasElement>(null);
  const prog = useRef<HTMLElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // dotted-ring logo
  useEffect(() => {
    const cv = logo.current!;
    const lg = cv.getContext("2d")!;
    const draw = (t: number) => {
      lg.clearRect(0, 0, 56, 56);
      for (let k = 0; k < 3; k++) {
        const r = 8 + k * 8;
        const n = 10 + k * 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ((k % 2 ? -1 : 1) * t) / (1600 + k * 600);
          lg.fillStyle = k === 1 && i === 0 ? "#FF5F1F" : `rgba(233,230,223,${0.35 + 0.2 * k})`;
          lg.beginPath();
          lg.arc(28 + Math.cos(a) * r, 28 + Math.sin(a) * r, 1.6, 0, 7);
          lg.fill();
        }
      }
    };
    if (prefersReducedMotion()) {
      draw(0);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 40) return;
      last = t;
      draw(t);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // scroll progress, one update per frame
  useEffect(() => {
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? Math.max(0, Math.min(1, scrollY / max)) : 0;
      if (prog.current) prog.current.style.transform = `scaleX(${p.toFixed(3)})`;
    };
    const queue = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    update();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    return () => {
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
    };
  }, [path]);

  // highlight the landing section being read
  useEffect(() => {
    if (!isLanding) return;
    const els = LANDING.map((l) => document.getElementById(l.id!)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          LANDING.forEach((l, i) => linkRefs.current[i]?.setAttribute("aria-current", l.id === e.target.id ? "true" : "false"));
        }),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [isLanding]);

  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-row">
        <Link className="logo-wrap" href="/" aria-label="Sentinyx home">
          <canvas ref={logo} width={56} height={56} aria-hidden="true" />
        </Link>
        <div className="nav-links">
          {links.map((l, i) => {
            const current = isLanding ? undefined : l.href === path || (l.href !== "/guard" && path.startsWith(l.href + "/")) || (l.href === "/guard" && path === "/guard");
            const label = (
              <>
                <span>{l.label}</span>
                {l.dot ? <span className="dot" aria-hidden="true" /> : null}
              </>
            );
            const props = {
              className: "link",
              "aria-current": isLanding ? undefined : current ? ("page" as const) : undefined,
              onMouseEnter: (e: React.MouseEvent<HTMLAnchorElement>) => {
                const span = e.currentTarget.querySelector("span");
                if (span) scrambleTo(span, l.label, 320);
              },
            };
            return l.href.startsWith("#") ? (
              <a key={l.href} href={`/${l.href}`} ref={(el) => { linkRefs.current[i] = el; }} {...props}>
                {label}
              </a>
            ) : (
              <Link key={l.href} href={l.href} {...props}>
                {label}
              </Link>
            );
          })}
        </div>
        {/* The name fills the right of the bar. The logo link above is the accessible way home, so this is a mouse convenience only. */}
        <Link className="nav-name" href="/" tabIndex={-1} aria-hidden="true">
          Sentinyx
        </Link>
      </div>
      <div className="progress" aria-hidden="true">
        <i ref={prog} />
      </div>
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </nav>
  );
}

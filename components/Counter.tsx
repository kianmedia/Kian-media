"use client";
import { useEffect, useRef, useState } from "react";

// ⚠️ V2-1.2-B — `display` is the FINAL value, already rendered by the server.
// The component now starts FROM it instead of from 0, so the first HTML a
// crawler or a JS-disabled visitor sees carries the real figure. Passing the
// pre-formatted string (rather than formatting here) also keeps server and
// client output byte-identical, which is what avoids a hydration mismatch.
export default function Counter({ to, suffix = "", duration = 1800, display }: { to: number; suffix?: string; duration?: number; display?: string }) {
  // `null` = "not animating yet, show the server value". Never 0: rendering 0
  // on mount is exactly the bug this fixes.
  const [val, setVal] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // V2-1.10-B — respect prefers-reduced-motion: land on the final value at
    // once rather than animating. The number is information, not decoration.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    const runAnimation = () => {
      if (started.current) return;
      started.current = true;
      if (reduced) { setVal(to); return; }
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
        setVal(Math.round(to * eased));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const el = ref.current;

    // 1. If element is already visible on mount (e.g. hero stats above the fold),
    //    start immediately. This is the key fix for the "0+" bug.
    if (el) {
      const rect = el.getBoundingClientRect();
      const inView = rect.top < window.innerHeight && rect.bottom > 0;
      if (inView) {
        runAnimation();
      }
    }

    // 2. Otherwise, observe and start when it scrolls into view.
    let obs: IntersectionObserver | null = null;
    if (el && !started.current) {
      obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) runAnimation();
          });
        },
        { threshold: 0.2 }
      );
      obs.observe(el);
    }

    // 3. Safety net: if for any reason neither fired within 1.2s, force-run.
    //    Guarantees the final number is never stuck at 0.
    const fallback = setTimeout(() => runAnimation(), 1200);

    return () => {
      if (obs) obs.disconnect();
      clearTimeout(fallback);
    };
  }, [to, duration]);

  // Before the animation starts, emit the server string verbatim.
  if (val === null) return <span ref={ref}>{display ?? `${to.toLocaleString("en-US")}${suffix}`}</span>;
  return <span ref={ref}>{val.toLocaleString("en-US")}{suffix}</span>;
}

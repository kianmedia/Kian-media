"use client";
import { useEffect, useRef, useState } from "react";

export default function Counter({ to, suffix = "", duration = 1800 }: { to: number; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const runAnimation = () => {
      if (started.current) return;
      started.current = true;
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

  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

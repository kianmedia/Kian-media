"use client";
import { useEffect, useRef } from "react";

export default function Cursor() {
  const dot  = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer:coarse)").matches) return;

    document.body.style.cursor = "none";
    let mx = 0, my = 0, rx = 0, ry = 0, raf = 0;

    const move = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; };
    document.addEventListener("mousemove", move);

    const tick = () => {
      rx += (mx - rx) * .11;
      ry += (my - ry) * .11;
      dot.current  && (dot.current.style.cssText  += `;left:${mx}px;top:${my}px`);
      ring.current && (ring.current.style.cssText += `;left:${rx}px;top:${ry}px`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const hover = () => { dot.current?.classList.add("hovered");  ring.current?.classList.add("hovered"); };
    const leave = () => { dot.current?.classList.remove("hovered"); ring.current?.classList.remove("hovered"); };
    const addListeners = () => {
      document.querySelectorAll("a,button,[data-cursor]").forEach(el => {
        el.addEventListener("mouseenter", hover);
        el.addEventListener("mouseleave", leave);
      });
    };
    addListeners();
    const obs = new MutationObserver(addListeners);
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("mousemove", move);
      cancelAnimationFrame(raf);
      obs.disconnect();
      document.body.style.cursor = "";
    };
  }, []);

  return (
    <>
      <div ref={dot}  className="cursor-dot"  style={{ position:"fixed", pointerEvents:"none", zIndex:9999 }} />
      <div ref={ring} className="cursor-ring" style={{ position:"fixed", pointerEvents:"none", zIndex:9998 }} />
    </>
  );
}

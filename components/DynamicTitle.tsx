"use client";
import { useEffect } from "react";

/**
 * Changes the browser tab title when the visitor switches away,
 * and restores it when they come back. A subtle, premium touch
 * used by many world-class sites. No visual footprint on the page.
 */
export default function DynamicTitle() {
  useEffect(() => {
    const original = document.title;
    const away = "في انتظارك — كيان ميديا";

    const onVisibility = () => {
      document.title = document.hidden ? away : original;
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.title = original;
    };
  }, []);

  return null;
}

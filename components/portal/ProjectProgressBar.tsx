"use client";
// Authoritative project progress (P0-9) — reads project_progress(), the same
// SECURITY DEFINER source for admin and client, so the number never disagrees.
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { projectProgress, type ProjectProgress } from "@/lib/portal/projects";

export default function ProjectProgressBar({ projectId, compact, refreshSignal }: { projectId: string; compact?: boolean; refreshSignal?: number }) {
  const { t } = useI18n();
  const [p, setP] = useState<ProjectProgress | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    void projectProgress(projectId).then((r) => { if (!alive) return; if (r.ok) setP(r.data); else setErr(true); });
    return () => { alive = false; };
  }, [projectId, refreshSignal]);

  if (err) return null;                // non-fatal: header still renders without it
  const pct = p?.pct ?? 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: "5px" }}>
        <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
          {t({ ar: "نسبة الإنجاز", en: "Overall progress" })}
          {p?.overridden && (
            <span style={{ color: p.override_above_auto ? "#ff8a8e" : "rgba(255,210,138,0.9)" }}>
              {" · "}{t({ ar: "يدوي", en: "manual" })}
              {p.auto_pct != null && <span style={{ color: "rgba(255,255,255,0.45)" }}> ({t({ ar: "المحسوب", en: "auto" })} <span dir="ltr">{p.auto_pct}%</span>)</span>}
              {p.override_above_auto && <span> ⚠ {t({ ar: "يتجاوز سقف المرحلة", en: "exceeds stage cap" })}</span>}
            </span>
          )}
        </span>
        <span className="f-sans" style={{ fontSize: "13px", fontWeight: 700, color: p?.delivered ? "#7CFC9A" : "#fff" }} dir="ltr">{pct}%</span>
      </div>
      <div style={{ height: "8px", background: "rgba(255,255,255,0.08)", borderRadius: "999px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: p?.delivered ? "#7CFC9A" : "#E31E24", transition: "width 0.4s ease" }} />
      </div>
      {!compact && p && (
        <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ marginTop: "8px" }}>
          {p.phases.map((ph) => (
            <span key={ph.key} className="f-sans" style={{ fontSize: "10px", color: ph.pct >= 100 ? "#7CFC9A" : ph.pct > 0 ? "rgba(255,210,138,0.9)" : "rgba(255,255,255,0.35)" }}>
              {t({ ar: ph.ar, en: ph.en })} <span dir="ltr">{ph.pct}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — «جدولة المشاريع» (Phase 4 · 4C · Portfolio Planning). لوحة شركة-واسعة
// تعرض كل المشاريع النشطة بتواريخها وصحة جدولها وتعارضاتها — بيانات حقيقية عبر RPC واحد
// (portfolio_schedule_dashboard، بلا N+1). العميل لا يصل (سطح داخلي + بوابة RPC).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { portfolioScheduleDashboard, type PortfolioProject } from "@/lib/portal/projectCore";

const HEALTH: Record<string, { ar: string; color: string }> = {
  on_track: { ar: "على المسار", color: "#16a34a" }, at_risk: { ar: "معرّض للخطر", color: "#d97706" }, off_track: { ar: "خارج المسار", color: "#dc2626" },
};

export default function PortfolioSchedule({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<PortfolioProject[]>([]);
  const [summary, setSummary] = useState<{ total: number; off_track: number; at_risk: number } | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [conflictOnly, setConflictOnly] = useState(false);
  const [health, setHealth] = useState<string>("");
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    setPhase("loading"); setErr("");
    const r = await portfolioScheduleDashboard({ conflict_only: conflictOnly, health: health || undefined });
    if (!mountedRef.current) return;
    if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[portfolio]", r.error); setErr(r.error.includes("not authorized") ? t({ ar: "لا تملك صلاحية عرض جدولة المشاريع.", en: "Not authorized." }) : t({ ar: "تعذّر تحميل جدولة المشاريع.", en: "Couldn't load." })); setPhase("error"); return; }
    setRows(r.data.projects); setSummary(r.data.summary); setPhase("ready");
  }, [conflictOnly, health, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-4" onClick={onClose}>
      <div className="bg-stone-950 border border-stone-800 rounded-2xl w-full max-w-5xl my-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-stone-800">
          <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "جدولة المشاريع (المحفظة)", en: "Portfolio Schedule" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-sm">✕</button>
        </div>

        <div className="p-4 space-y-3">
          {/* ملخّص + فلاتر */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {summary && <>
              <span className="text-stone-400">{t({ ar: "الإجمالي", en: "Total" })}: <b className="text-stone-200">{summary.total}</b></span>
              <span className="text-red-400">{t({ ar: "خارج المسار", en: "Off-track" })}: <b>{summary.off_track}</b></span>
              <span className="text-amber-400">{t({ ar: "معرّض للخطر", en: "At-risk" })}: <b>{summary.at_risk}</b></span>
            </>}
            <label className="flex items-center gap-1 ms-auto"><span className="text-stone-500">{t({ ar: "الصحة", en: "Health" })}</span>
              <select value={health} onChange={(e) => setHealth(e.target.value)} className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }}>
                <option value="">{t({ ar: "الكل", en: "All" })}</option>
                {["on_track", "at_risk", "off_track"].map((h) => <option key={h} value={h}>{HEALTH[h].ar}</option>)}
              </select></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={conflictOnly} onChange={(e) => setConflictOnly(e.target.checked)} /><span className="text-stone-400">{t({ ar: "متعارض/متأخر فقط", en: "Conflicts/overdue only" })}</span></label>
          </div>

          {phase === "loading" && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
          {phase === "error" && <div className="py-8 text-center space-y-2"><p className="text-sm text-red-300">{err}</p><button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button></div>}
          {phase === "ready" && rows.length === 0 && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "لا مشاريع مطابقة.", en: "No matching projects." })}</p>}

          {phase === "ready" && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead><tr className="text-stone-500 text-start">
                  {[{ ar: "المشروع", en: "Project" }, { ar: "المرحلة", en: "Stage" }, { ar: "الصحة", en: "Health" }, { ar: "الجدول", en: "Schedule" }, { ar: "التسليم", en: "Due" }, { ar: "التقدم", en: "Progress" }, { ar: "مهام", en: "Open" }, { ar: "تحذيرات", en: "Alerts" }].map((h, i) => <th key={i} className="text-start font-medium px-2 py-1.5 border-b border-stone-800">{t(h)}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((p) => {
                    const sh = HEALTH[p.schedule?.schedule_status] ?? HEALTH.on_track;
                    const hh = HEALTH[p.health] ?? HEALTH.on_track;
                    return (
                      <tr key={p.project_id} className="border-b border-stone-900 hover:bg-stone-900/40">
                        <td className="px-2 py-1.5"><a href={`/client-portal/project-core/${p.project_id}`} className="text-stone-200 hover:text-sky-300" dir="auto">{p.is_subproject && <span className="text-stone-600">↳ </span>}{p.name ?? "—"}</a></td>
                        <td className="px-2 py-1.5 text-stone-400">{p.core_stage}</td>
                        <td className="px-2 py-1.5"><span style={{ color: hh.color }}>●</span></td>
                        <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: sh.color + "22", color: sh.color }}>{sh.ar}</span></td>
                        <td className="px-2 py-1.5 text-stone-400">{p.due_date ?? "—"}</td>
                        <td className="px-2 py-1.5 text-stone-400">{p.progress_pct}%</td>
                        <td className="px-2 py-1.5 text-stone-400">{p.open_tasks}</td>
                        <td className="px-2 py-1.5">
                          {(p.schedule?.warnings ?? []).slice(0, 2).map((w, i) => <span key={i} className="text-amber-400/90 block">{w.ar}</span>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[9px] text-stone-600">{t({ ar: "بيانات حية من portfolio_schedule_dashboard. المشاريع المقفلة مستبعدة.", en: "Live data; closed projects excluded." })}</p>
        </div>
      </div>
    </div>
  );
}

"use client";
// ════════════════════════════════════════════════════════════════════════════
// PlanningHealthCard — Phase 4D §11. بطاقة صحّة موحّدة: تنفيذ + جدول + موارد، مفسّرة
// (لا Black Box score) مع أسباب وأزرار Drill-down. بيانات حية عبر project_planning_health.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { projectPlanningHealth, type PlanningHealth } from "@/lib/portal/projectCore";

const STATUS: Record<string, { ar: string; color: string }> = {
  on_track: { ar: "على المسار", color: "#16a34a" }, at_risk: { ar: "معرّض للخطر", color: "#d97706" },
  off_track: { ar: "خارج المسار", color: "#dc2626" }, unknown: { ar: "غير معروف", color: "#78716c" },
};
const dot = (s: string) => STATUS[s] ?? STATUS.unknown;

export default function PlanningHealthCard({ projectId, gotoTab }: { projectId: string; gotoTab?: (t: string) => void }) {
  const { t } = useI18n();
  const [h, setH] = useState<PlanningHealth | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const mountedRef = useRef(true);
  const reqSeq = useRef(0);                                // الأحدث يفوز عند تغيّر projectId
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const load = useCallback(async () => {
    const my = ++reqSeq.current;
    setPhase("loading");
    const r = await projectPlanningHealth(projectId);
    if (!mountedRef.current || my !== reqSeq.current) return;
    if (!r.ok) { setPhase("error"); return; }
    setH(r.data); setPhase("ready");
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  if (phase === "loading") return <div className="text-[11px] text-stone-500 py-3">{t({ ar: "جارٍ حساب الصحّة…", en: "Computing health…" })}</div>;
  if (phase === "error" || !h) return <div className="text-[11px] text-stone-500 py-3 flex items-center gap-2">{t({ ar: "تعذّر حساب الصحّة.", en: "Health unavailable." })} <button onClick={() => void load()} className="text-sky-400">↻</button></div>;

  const execReasons = (h.execution?.reasons ?? []) as { ar: string }[];
  const schedWarn = (h.schedule?.warnings ?? []) as { ar: string }[];
  const resReasons = h.resource?.reasons ?? [];
  const cs = dot(h.combined_status);

  const Section = ({ label, status, reasons, tab }: { label: string; status: string; reasons: { ar: string }[]; tab: string }) => {
    const d = dot(status);
    return (
      <div className="border border-stone-800 rounded-lg p-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-stone-300">{label}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: d.color + "22", color: d.color }} aria-label={d.ar}>● {d.ar}</span>
        </div>
        {reasons.slice(0, 3).map((r, i) => <p key={i} className="text-[9px] text-stone-500" dir="auto">· {r.ar}</p>)}
        {reasons.length === 0 && <p className="text-[9px] text-stone-600">{t({ ar: "لا ملاحظات.", en: "No issues." })}</p>}
        {gotoTab && <button onClick={() => gotoTab(tab)} className="text-[9px] text-sky-400 hover:text-sky-300">{t({ ar: "تفاصيل ←", en: "Details →" })}</button>}
      </div>
    );
  };

  return (
    <div className="border border-stone-800 rounded-xl p-3 bg-stone-950 space-y-2" dir="rtl">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-stone-200">{t({ ar: "صحّة التخطيط الموحّدة", en: "Planning Health" })}</h4>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: cs.color + "22", color: cs.color }}>{t({ ar: "الإجمالي:", en: "Overall:" })} {cs.ar}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Section label={t({ ar: "التنفيذ", en: "Execution" })} status={String(h.execution?.status ?? "unknown")} reasons={execReasons} tab="execution" />
        <Section label={t({ ar: "الجدول", en: "Schedule" })} status={String(h.schedule?.schedule_status ?? "unknown")} reasons={schedWarn} tab="planning" />
        <Section label={t({ ar: "الموارد", en: "Resources" })} status={h.resource?.status ?? "unknown"} reasons={resReasons} tab="resources" />
      </div>
      <p className="text-[9px] text-stone-600">{t({ ar: "الحالة الإجمالية = أسوأ الحالات الثلاث (بلا جمع درجات غامض).", en: "Overall = worst of the three (no black-box score)." })}</p>
    </div>
  );
}

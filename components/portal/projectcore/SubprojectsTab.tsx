"use client";
// ════════════════════════════════════════════════════════════════════════════
// SubprojectsTab — Batch 6A. تبويب «المشاريع الفرعية» داخل المشروع الرئيسي.
// يُركّب project_subprojects_summary (موجودة، وُسّعت في 6A) + project_hierarchy_rollup.
// تجميع الفروع مشتقّ فقط — لا يُكتب على تقدّم الأب (لا عدّ مزدوج).
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { projectSubprojectsSummary, PC_STAGE_LABELS, HEALTH_LABELS, type Subproject, type PcStage, type PcHealth } from "@/lib/portal/projectCore";
import {
  projectHierarchyRollup, projectHierarchyDetachSubproject, projectHierarchyMoveSubproject,
  projectHierarchyMastersList, hierErr, type HierarchyRollup, type MasterLite,
} from "@/lib/portal/projectHierarchy";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const HEALTH_CLS: Record<string, string> = { on_track: "#16a34a", at_risk: "#d97706", off_track: "#dc2626" };

export default function SubprojectsTab({ projectId, canManage, flash, onAddSubproject }:
  { projectId: string; canManage: boolean; flash: (m: string) => void; onAddSubproject?: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Subproject[]>([]);
  const [rollup, setRollup] = useState<HierarchyRollup | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reqSeq = useRef(0); const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++reqSeq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [s, r] = await Promise.race([
        Promise.all([projectSubprojectsSummary(projectId), projectHierarchyRollup(projectId)]),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("hier_timeout")), 20000); }),
      ]);
      if (!mountedRef.current || my !== reqSeq.current) return;
      if (!s.ok) { if (process.env.NODE_ENV !== "production") console.error("[subprojects]", s.error); setErr(hierErr(s.error)); setPhase("error"); return; }
      setRows(s.data.subprojects ?? []); setRollup(r.ok ? r.data : null); setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(e instanceof Error && e.message === "hier_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : hierErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [projectId, t]);
  useEffect(() => { void load(); }, [load]);

  async function detach(id: string) {
    const reason = window.prompt(t({ ar: "سبب فصل المشروع الفرعي (إلزامي):", en: "Detach reason (required):" }));
    if (!reason || !reason.trim()) return;
    setBusy(true); const r = await projectHierarchyDetachSubproject(id, reason); setBusy(false);
    if (!r.ok) { flash(hierErr(r.error)); return; }
    flash(t({ ar: "أصبح مشروعًا مستقلًّا.", en: "Detached to standalone." })); await load();
  }
  async function move(id: string) {
    const ml = await projectHierarchyMastersList();
    if (!ml.ok) { flash(hierErr(ml.error)); return; }
    const others: MasterLite[] = ml.data.masters.filter((m) => m.id !== projectId);
    if (others.length === 0) { flash(t({ ar: "لا مشاريع رئيسية أخرى.", en: "No other masters." })); return; }
    const pick = window.prompt(t({ ar: `المشروع الرئيسي الجديد:\n${others.map((m, i) => `${i + 1}) ${m.project_name}`).join("\n")}\n\nاكتب الرقم:`, en: `New master:\n${others.map((m, i) => `${i + 1}) ${m.project_name}`).join("\n")}\n\nEnter number:` }));
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= others.length) return;
    const reason = window.prompt(t({ ar: "سبب النقل (إلزامي):", en: "Move reason (required):" }));
    if (!reason || !reason.trim()) return;
    setBusy(true); const r = await projectHierarchyMoveSubproject(id, others[idx].id, reason); setBusy(false);
    if (!r.ok) { flash(hierErr(r.error)); return; }
    flash(t({ ar: "نُقل المشروع الفرعي.", en: "Moved." })); await load();
  }

  if (phase === "loading") return <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ تحميل المشاريع الفرعية…", en: "Loading subprojects…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-red-300">{t({ ar: "تعذّر التحميل.", en: "Failed to load." })}</p>
      {err && <p className="text-[11px] text-stone-500">{err}</p>}
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );

  return (
    <div className="space-y-4" dir="rtl">
      {/* تجميع الأب — مشتقّ */}
      {rollup && (
        <section className={`${card} p-3`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-stone-200">{t({ ar: "تجميع المشاريع الفرعية", en: "Children rollup" })}</h4>
            <button onClick={() => void load()} className="text-xs text-stone-500 hover:text-white" aria-label="refresh">↻</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { ar: "إنجاز المشروع الرئيسي", n: rollup.own_progress == null ? "—" : `${rollup.own_progress}%` },
              { ar: "تجميع إنجاز الفروع", n: rollup.children_aggregate_progress == null ? t({ ar: "غير متاح", en: "n/a" }) : `${rollup.children_aggregate_progress}%` },
              { ar: "إجمالي الفروع", n: rollup.total_children },
              { ar: "نشطة", n: rollup.active_children, c: "#16a34a" },
              { ar: "متأخرة", n: rollup.delayed_children, c: rollup.delayed_children > 0 ? "#dc2626" : undefined },
              { ar: "حرجة", n: rollup.critical_children, c: rollup.critical_children > 0 ? "#dc2626" : undefined },
            ].map((x, i) => (
              <div key={i} className="border border-stone-800 rounded-lg p-2">
                <div className="text-base font-bold" style={{ color: x.c || "#e7e5e4" }}>{x.n}</div>
                <div className="text-[10px] text-stone-500">{x.ar}</div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-stone-600 mt-1.5">{t({ ar: "التجميع مشتقّ للعرض فقط — لا يُكتب على نسبة إنجاز المشروع الرئيسي.", en: "Rollup is derived for display only." })}</p>
        </section>
      )}

      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "المشاريع الفرعية", en: "Subprojects" })} ({rows.length})</h4>
        {canManage && onAddSubproject && (
          <button onClick={onAddSubproject} className="text-[11px] text-sky-300 border border-sky-800 rounded px-2 py-1">+ {t({ ar: "إضافة مشروع فرعي", en: "Add subproject" })}</button>
        )}
      </div>

      {rows.length === 0 && (
        <div className="py-8 text-center space-y-2">
          <p className="text-[11px] text-stone-500">{t({ ar: "لا مشاريع فرعية بعد.", en: "No subprojects yet." })}</p>
          {canManage && onAddSubproject && <button onClick={onAddSubproject} className="text-xs text-sky-300 border border-sky-800 rounded-lg px-4 py-2">+ {t({ ar: "إضافة أول مشروع فرعي", en: "Add the first subproject" })}</button>}
        </div>
      )}

      <div className="space-y-1.5">
        {rows.map((s) => (
          <div key={s.project_id} className={`${card} p-2.5 space-y-1`}>
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <Link href={`/client-portal/project-core/${s.project_id}`} className="text-stone-100 hover:text-sky-300 font-medium truncate max-w-[220px]" dir="auto">{s.name}</Link>
              {s.core_stage && <span className="text-stone-500">{t(PC_STAGE_LABELS[s.core_stage as PcStage] ?? { ar: s.core_stage, en: s.core_stage })}</span>}
              {s.health && <span style={{ color: HEALTH_CLS[s.health] ?? "#78716c" }}>{t(HEALTH_LABELS[s.health as PcHealth] ?? { ar: s.health, en: s.health })}</span>}
              <span className="text-stone-400">{s.progress_pct}%</span>
              {(s.critical_risks ?? 0) > 0 && <span className="text-red-400">{t({ ar: "مخاطر", en: "risks" })}: {s.critical_risks}</span>}
              {(s.critical_issues ?? 0) > 0 && <span className="text-red-400">{t({ ar: "مشكلات", en: "issues" })}: {s.critical_issues}</span>}
              {canManage && (
                <span className="flex items-center gap-2 ms-auto">
                  <button disabled={busy} onClick={() => void move(s.project_id)} className="text-violet-300 hover:text-violet-200">{t({ ar: "نقل", en: "Move" })}</button>
                  <button disabled={busy} onClick={() => void detach(s.project_id)} className="text-amber-300 hover:text-amber-200">{t({ ar: "فصل", en: "Detach" })}</button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-stone-500 flex-wrap">
              <span>{t({ ar: "المدير", en: "Manager" })}: {s.manager_name ?? "—"}</span>
              <span>{t({ ar: "من", en: "From" })}: {s.start ?? "—"}</span>
              <span>{t({ ar: "إلى", en: "To" })}: {s.end ?? "—"}</span>
              <span>{t({ ar: "مهام مفتوحة", en: "Open tasks" })}: {s.open_tasks}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-stone-600">{t({ ar: "كل مشروع فرعي مشروع كامل مستقل (مهامه/مخرجاته/موارده/حوكمته/إغلاقه). رؤية الأب لا تمنح رؤية الفروع تلقائيًّا.", en: "Each subproject is a full independent project; seeing the master does not grant access to children." })}</p>
    </div>
  );
}

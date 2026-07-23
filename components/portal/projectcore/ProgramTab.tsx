"use client";
// ════════════════════════════════════════════════════════════════════════════
// ProgramTab — Batch 8A. «إدارة البرنامج» داخل المشروع الرئيسي فقط.
// يُركّب project_program_dashboard (مشتقّة بالكامل من 6A rollup + 3C) وسجلّ
// الوحدات project_program_units. لا نظام تقدّم/مهام/اعتماد موازٍ، ولا مستوى ثالث.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { csvDownload } from "@/lib/portal/csv";
import { PC_STAGE_LABELS, HEALTH_LABELS, type PcStage, type PcHealth } from "@/lib/portal/projectCore";
import {
  projectProgramDashboard, projectProgramUnits, projectProgramSettingsUpsert, projectUnitMetadataUpsert,
  OPERATING_MODEL_AR, UNIT_TYPE_AR, CADENCE_AR, unitLabel, programErr,
  type ProgramDashboard, type ProgramUnits, type ProgramUnit, type UnitFilters,
  type OperatingModel, type CadenceType, type UnitType,
} from "@/lib/portal/programs";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const lbl = "text-[11px] text-stone-500 mb-1 block";
const HEALTH_CLR: Record<string, string> = { on_track: "#16a34a", at_risk: "#d97706", off_track: "#dc2626" };

export default function ProgramTab({ projectId, canManage, flash }:
  { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [dash, setDash] = useState<ProgramDashboard | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [rev, setRev] = useState(0);
  const seq = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        projectProgramDashboard(projectId),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("prog_timeout")), 20000); }),
      ]);
      if (!mounted.current || my !== seq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[program]", r.error); setErr(programErr(r.error)); setPhase("error"); return; }
      setDash(r.data); setPhase("ready");
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      setErr(e instanceof Error && e.message === "prog_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : programErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [projectId, t]);
  useEffect(() => { void load(); }, [load, rev]);

  if (phase === "loading") return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-2" role="alert">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!dash) return null;
  const s = dash.settings;
  const ul = unitLabel(s);

  return (
    <div className="space-y-4">
      {!s && (
        <div className={`${card} p-3 flex items-center justify-between gap-2 flex-wrap`}>
          <p className="text-xs text-stone-400">{t({ ar: "لم يُضبط ملف تشغيل لهذا البرنامج بعد.", en: "No program profile configured yet." })}</p>
          {canManage && <button onClick={() => setShowSettings(true)} className="text-[11px] text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5">{t({ ar: "ضبط البرنامج", en: "Configure" })}</button>}
        </div>
      )}

      {/* اللوحة مشتقّة من الفروع ولا تحتاج ملف إعدادات — كانت مخفيّة بالكامل بدونه */}
      <section className={`${card} p-3 space-y-2`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {s && <span className="text-[10px] px-2 py-0.5 rounded bg-violet-950/40 text-violet-300 border border-violet-900">{OPERATING_MODEL_AR[s.operating_model]}</span>}
              {s && s.cadence_type !== "none" && <span className="text-[10px] text-stone-500">{CADENCE_AR[s.cadence_type]}{s.cadence_interval > 1 ? ` ×${s.cadence_interval}` : ""}</span>}
              {s?.numbering_prefix && <span className="text-[10px] text-stone-600" dir="ltr">{s.numbering_prefix}-</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setRev((v) => v + 1)} className="text-[11px] text-stone-400 hover:text-white">↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
              {canManage && <button onClick={() => setShowSettings(true)} className="text-[11px] text-stone-300 border border-stone-700 rounded-lg px-2.5 py-1">{t({ ar: "الإعدادات", en: "Settings" })}</button>}
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2 text-center">
            <M n={dash.units.target ?? "—"} ar={`${ul} مستهدفة`} />
            <M n={dash.units.created} ar={`${ul} منشأة`} />
            <M n={dash.units.unplanned ?? "—"} ar="متبقٍّ إنشاؤه" />
            <M n={dash.units.active} ar="نشطة" />
            <M n={dash.units.delayed} ar="متأخرة" danger />
            <M n={dash.units.critical} ar="حرجة" danger />
            <M n={dash.units.awaiting_client} ar="بانتظار العميل" />
            <M n={dash.units.delivered} ar="مُسلَّمة" />
            <M n={dash.units.closed} ar="مغلقة" />
            <M n={dash.progress.operational_by_count_pct == null ? "—" : `${dash.progress.operational_by_count_pct}%`} ar="إنجاز بالعدد" />
            <M n={dash.progress.children_aggregate == null ? "—" : `${dash.progress.children_aggregate}%`} ar="إنجاز الوحدات" />
            <M n={dash.progress.own == null ? "—" : `${dash.progress.own}%`} ar="إنجاز الأب" />
          </div>

          {/* صحّة الأب وصحّة الوحدات منفصلتان صراحةً — لا رقم واحد يخلطهما */}
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded border border-stone-800 text-stone-400">
              {t({ ar: "صحّة المشروع الرئيسي", en: "Own health" })}:{" "}
              <b style={{ color: HEALTH_CLR[dash.own_health ?? ""] ?? "#78716c" }}>
                {dash.own_health ? t(HEALTH_LABELS[dash.own_health as PcHealth] ?? { ar: dash.own_health, en: dash.own_health }) : "—"}
              </b>
            </span>
            <span className="px-2 py-0.5 rounded border border-stone-800 text-stone-400">
              {t({ ar: "صحّة الوحدات (تجميع)", en: "Units aggregate health" })}:{" "}
              <b style={{ color: HEALTH_CLR[dash.children_aggregate_health ?? ""] ?? "#78716c" }}>
                {dash.children_aggregate_health ? t(HEALTH_LABELS[dash.children_aggregate_health as PcHealth] ?? { ar: dash.children_aggregate_health, en: dash.children_aggregate_health }) : t({ ar: "غير متاح", en: "n/a" })}
              </b>
            </span>
            <span className="px-2 py-0.5 rounded border border-stone-800 text-stone-500">
              {t({ ar: "أقرب تسليم", en: "Earliest due" })}: <b dir="ltr">{dash.dates.earliest_due ?? "—"}</b>
            </span>
            <span className="px-2 py-0.5 rounded border border-stone-800 text-stone-500">
              {t({ ar: "أبعد تسليم", en: "Latest due" })}: <b dir="ltr">{dash.dates.latest_due ?? "—"}</b>
            </span>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="text-stone-500">
              {t({ ar: "سرعة التسليم", en: "Velocity" })}:{" "}
              {dash.velocity.available
                ? `${dash.velocity.delivered_7d}/٧ · ${dash.velocity.delivered_30d}/٣٠ · ${dash.velocity.delivered_90d}/٩٠ ${t({ ar: "يومًا", en: "days" })}`
                : <span className="text-stone-600">{t({ ar: "غير متاحة (لا وحدة مُسلَّمة بتاريخ تسليم)", en: "n/a (no delivered unit has a delivery date)" })}</span>}
            </span>
            <span className="text-stone-500">
              {t({ ar: "التوقّع", en: "Forecast" })}:{" "}
              {dash.forecast.available
                ? <b dir="ltr">{dash.forecast.projected_finish}</b>
                : <span className="text-stone-600">{t({ ar: "غير متاح", en: "n/a" })}{dash.forecast.reason === "no_velocity" ? t({ ar: " (لا تسليمات حديثة)", en: " (no recent deliveries)" }) : dash.forecast.reason === "no_target" ? t({ ar: " (بلا هدف)", en: " (no target)" }) : dash.forecast.reason === "target_met" ? t({ ar: " (اكتمل المستهدف)", en: " (target met)" }) : ""}</span>}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            {dash.governance.critical_risks !== "unavailable" && dash.governance.critical_risks > 0 && <span className="px-2 py-0.5 rounded border border-red-900/60 text-red-400">{t({ ar: "مخاطر حرجة", en: "Critical risks" })}: {dash.governance.critical_risks}</span>}
            {dash.governance.critical_issues !== "unavailable" && dash.governance.critical_issues > 0 && <span className="px-2 py-0.5 rounded border border-red-900/60 text-red-400">{t({ ar: "مشكلات حرجة", en: "Critical issues" })}: {dash.governance.critical_issues}</span>}
            {dash.governance.overdue_approvals !== "unavailable" && dash.governance.overdue_approvals > 0 && <span className="px-2 py-0.5 rounded border border-amber-900/60 text-amber-400">{t({ ar: "اعتمادات متأخرة", en: "Overdue approvals" })}: {dash.governance.overdue_approvals}</span>}
            {dash.governance.change_requests_pending !== "unavailable" && dash.governance.change_requests_pending > 0 && <span className="px-2 py-0.5 rounded border border-stone-800 text-stone-400">{t({ ar: "طلبات تغيير", en: "Changes" })}: {dash.governance.change_requests_pending}</span>}

          </div>

          {dash.warnings.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {dash.warnings.map((w) => (
                <span key={w.code} className="text-[10px] px-2 py-0.5 rounded border border-amber-900/60 bg-amber-950/20 text-amber-300">{w.ar}: {w.count}</span>
              ))}
            </div>
          )}

          {dash.milestones.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-stone-400 mb-1">{t({ ar: "محطات البرنامج", en: "Program milestones" })}</h5>
              <div className="space-y-1">
                {dash.milestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-[11px] border border-stone-800 rounded px-2 py-1">
                    <span className="text-stone-200 truncate flex-1" dir="auto">{m.title}</span>
                    <span className="text-stone-500" dir="ltr">{m.at.slice(0, 10)}</span>
                    {m.overdue && <span className="text-red-400">{t({ ar: "متأخر", en: "late" })}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[9px] text-stone-600">{t({ ar: "كل الأرقام مشتقّة من محرّك التقدّم والهرمية القائمين — لا تُخزَّن على البرنامج.", en: "All figures derive from the existing progress/hierarchy engines." })}</p>
      </section>

      <UnitRegister projectId={projectId} unitWord={ul} canManage={canManage} onChanged={() => setRev((v) => v + 1)} />

      {showSettings && s !== undefined && (
        <SettingsModal projectId={projectId} current={dash.settings} onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); setRev((v) => v + 1); flash(t({ ar: "حُفظت إعدادات البرنامج.", en: "Program settings saved." })); }} />
      )}
    </div>
  );
}

function M({ n, ar, danger }: { n: number | string; ar: string; danger?: boolean }) {
  const red = danger && typeof n === "number" && n > 0;
  return (
    <div className="border border-stone-800 rounded-lg p-2">
      <div className="text-base font-bold" style={{ color: red ? "#dc2626" : "#e7e5e4" }}>{n}</div>
      <div className="text-[9px] text-stone-500 leading-tight">{ar}</div>
    </div>
  );
}

// ─── سجلّ الوحدات ───
function UnitRegister({ projectId, unitWord, canManage, onChanged }:
  { projectId: string; unitWord: string; canManage: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<ProgramUnit | null>(null);
  const [data, setData] = useState<ProgramUnits | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [f, setF] = useState<UnitFilters>({});
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const seq = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    const r = await projectProgramUnits(projectId, { ...f, limit: 50, offset });
    if (!mounted.current || my !== seq.current) return;
    if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[program-units]", r.error); setErr(programErr(r.error)); setPhase("error"); return; }
    setData(r.data); setPhase("ready");
  }, [projectId, f, offset]);
  useEffect(() => { void load(); }, [load]);

  const set = (k: keyof UnitFilters, v: unknown) => { setOffset(0); setF((p) => ({ ...p, [k]: v === "" || v === false ? undefined : v })); };
  const sel = "bg-stone-900 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200";

  function exportCsv() {
    if (!data) return;
    csvDownload(`program-units`, [
      ["الرقم", "الكود", "الاسم", "النوع", "المرحلة", "الإنجاز", "المدير", "البداية", "النهاية", "النشر", "الصحة", "مهام متأخرة", "مخاطر حرجة", "مشكلات حرجة", "اعتمادات معلقة", "الإغلاق"],
      ...data.units.map((u) => [
        u.unit_number ?? "", u.unit_code ?? "", u.project_name, u.unit_type ? UNIT_TYPE_AR[u.unit_type] : "",
        t(PC_STAGE_LABELS[u.core_stage as PcStage] ?? { ar: u.core_stage, en: u.core_stage }),
        u.progress_pct ?? "", u.manager_name ?? "", u.start_date ?? "", u.due_date ?? "",
        u.planned_release_date ?? "",
        u.health ? t(HEALTH_LABELS[u.health as PcHealth] ?? { ar: u.health, en: u.health }) : "", u.overdue_tasks, u.critical_risks, u.critical_issues,
        u.pending_approvals, u.closure_status ?? "",
      ]),
    ]);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: `سجلّ ${unitWord}`, en: "Unit register" })} {data ? `(${data.total})` : ""}</h4>
        <button onClick={exportCsv} className="text-[11px] text-stone-300 border border-stone-700 rounded-lg px-2.5 py-1">{t({ ar: "تصدير الصفحة الحالية CSV", en: "Export current page (CSV)" })}</button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") set("search", search.trim()); }}
          aria-label={t({ ar: "بحث بالاسم أو الكود أو الرقم", en: "Search by name, code or number" })}
          placeholder={t({ ar: "بحث بالاسم/الكود/الرقم…", en: "Search…" })}
          className="flex-1 min-w-[140px] bg-stone-900 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200" />
        <select aria-label={t({ ar: "النوع", en: "Type" })} value={String(f.unit_type ?? "")} onChange={(e) => set("unit_type", e.target.value)} className={sel}>
          <option value="">{t({ ar: "كل الأنواع", en: "All types" })}</option>
          {(Object.keys(UNIT_TYPE_AR) as UnitType[]).map((k) => <option key={k} value={k}>{UNIT_TYPE_AR[k]}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={!!f.overdue_only} onChange={(e) => set("overdue_only", e.target.checked)} />{t({ ar: "المتأخر", en: "Overdue" })}</label>
        <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={!!f.critical_only} onChange={(e) => set("critical_only", e.target.checked)} />{t({ ar: "الحرج", en: "Critical" })}</label>
        <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={!!f.awaiting_client} onChange={(e) => set("awaiting_client", e.target.checked)} />{t({ ar: "ينتظر العميل", en: "Awaiting client" })}</label>
        <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={!!f.not_started} onChange={(e) => set("not_started", e.target.checked)} />{t({ ar: "لم يبدأ", en: "Not started" })}</label>
        <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={!!f.closed_only} onChange={(e) => set("closed_only", e.target.checked)} />{t({ ar: "مغلق", en: "Closed" })}</label>
      </div>

      {phase === "loading" && <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {phase === "error" && (
        <div className="py-6 text-center space-y-2" role="alert">
          <p className="text-sm text-red-300">{err}</p>
          <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
        </div>
      )}
      {phase === "ready" && data?.units.length === 0 && (
        <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "لا وحدات مطابقة.", en: "No matching units." })}</p>
      )}

      {phase === "ready" && (data?.units.length ?? 0) > 0 && (
        <div className="space-y-1">
          {data!.units.map((u) => (
            <div key={u.project_id} className={`${card} p-2`}>
              <div className="flex items-center gap-2 flex-wrap">
                {u.unit_number != null && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-300" dir="ltr">#{u.unit_number}</span>}
                {u.unit_code && <span className="text-[10px] text-stone-600" dir="ltr">{u.unit_code}</span>}
                <Link href={`/client-portal/project-core/${u.project_id}`} className="text-xs text-stone-100 hover:text-sky-300 truncate flex-1 min-w-0" dir="auto">{u.project_name}</Link>
                {u.unit_type && <span className="text-[10px] text-stone-500">{UNIT_TYPE_AR[u.unit_type]}</span>}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{t(PC_STAGE_LABELS[u.core_stage as PcStage] ?? { ar: u.core_stage, en: u.core_stage })}</span>
                {u.health && <span className="text-[10px]" style={{ color: HEALTH_CLR[u.health] ?? "#78716c" }}>● {t(HEALTH_LABELS[u.health as PcHealth] ?? { ar: u.health, en: u.health })}</span>}
                <span className="text-[10px] text-stone-400" dir="ltr">{u.progress_pct ?? 0}%</span>
                {canManage && (
                  <button onClick={() => setEditing(u)} className="text-[10px] text-stone-400 border border-stone-700 rounded px-2 py-0.5 hover:text-white"
                    aria-label={t({ ar: `تعديل بيانات ${unitWord}`, en: "Edit unit metadata" })}>
                    {t({ ar: "بيانات الوحدة", en: "Unit data" })}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-stone-500 mt-0.5">
                {u.manager_name && <span>{t({ ar: "مدير", en: "PM" })}: {u.manager_name}</span>}
                {u.due_date && <span dir="ltr">⏱ {u.due_date}</span>}
                {u.planned_release_date && <span dir="ltr">📅 {u.planned_release_date}</span>}
                {u.overdue_tasks > 0 && <span className="text-red-400">{u.overdue_tasks} {t({ ar: "مهمة متأخرة", en: "late tasks" })}</span>}
                {u.critical_risks > 0 && <span className="text-red-400">{u.critical_risks} {t({ ar: "مخاطرة", en: "risks" })}</span>}
                {u.critical_issues > 0 && <span className="text-red-400">{u.critical_issues} {t({ ar: "مشكلة", en: "issues" })}</span>}
                {u.pending_approvals > 0 && <span className="text-amber-400">{u.pending_approvals} {t({ ar: "اعتماد", en: "approvals" })}</span>}
              </div>
            </div>
          ))}
          {(offset > 0 || data!.has_more) && (
            <div className="flex items-center justify-between pt-1">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "السابق", en: "Prev" })}</button>
              <span className="text-[10px] text-stone-600">{data!.total}</span>
              <button disabled={!data!.has_more} onClick={() => setOffset(offset + 50)} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "التالي", en: "Next" })}</button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <UnitMetaModal unit={editing} unitWord={unitWord} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); onChanged(); }} />
      )}
    </section>
  );
}

// ─── تحرير بيانات الوحدة (يُغلق الحلقة: بدونه لا يمكن ضبط رقم/كود/نوع الوحدة إطلاقًا) ───
function UnitMetaModal({ unit, unitWord, onClose, onSaved }:
  { unit: ProgramUnit; unitWord: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    unit_number: unit.unit_number == null ? "" : String(unit.unit_number),
    unit_code: unit.unit_code ?? "",
    unit_type: unit.unit_type ?? "",
    season_number: unit.season_number == null ? "" : String(unit.season_number),
    batch_number: unit.batch_number == null ? "" : String(unit.batch_number),
    workstream: unit.workstream ?? "",
    planned_release_date: unit.planned_release_date ?? "",
    actual_release_date: unit.actual_release_date ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const renumbering = String(unit.unit_number ?? "") !== f.unit_number && unit.unit_number != null;

  async function save() {
    if (busy) return;
    let reason: string | undefined;
    if (renumbering) {
      const r = window.prompt(t({ ar: "سبب تغيير رقم الوحدة (إلزامي):", en: "Reason for renumbering (required):" }));
      if (!r || !r.trim()) return;                 // إلغاء أو فراغ ⇒ لا نداء
      reason = r.trim();
    }
    setBusy(true); setErr("");
    const res = await projectUnitMetadataUpsert(unit.project_id, {
      unit_number: f.unit_number.trim() || null,
      unit_code: f.unit_code.trim() || null,
      unit_type: f.unit_type || null,
      season_number: f.season_number.trim() || null,
      batch_number: f.batch_number.trim() || null,
      workstream: f.workstream.trim() || null,
      planned_release_date: f.planned_release_date || null,
      actual_release_date: f.actual_release_date || null,
    }, reason);
    setBusy(false);
    if (!res.ok) { setErr(programErr(res.error)); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-start justify-center overflow-auto p-3"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md bg-stone-950 border border-stone-800 rounded-2xl my-4 p-4 space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t({ ar: `بيانات ${unitWord}`, en: "Unit metadata" })}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>
        <p className="text-[11px] text-stone-500 truncate" dir="auto">{unit.project_name}</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={lbl} htmlFor="um-num">{t({ ar: "الرقم", en: "Number" })}</label>
            <input id="um-num" type="number" min={0} value={f.unit_number} onChange={(e) => set("unit_number", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="um-code">{t({ ar: "الكود", en: "Code" })}</label>
            <input id="um-code" value={f.unit_code} onChange={(e) => set("unit_code", e.target.value)} className={inp} dir="ltr" />
          </div>
          <div className="col-span-2">
            <label className={lbl} htmlFor="um-type">{t({ ar: "النوع", en: "Type" })}</label>
            <select id="um-type" value={f.unit_type} onChange={(e) => set("unit_type", e.target.value)} className={inp}>
              <option value="">{t({ ar: "— بلا نوع —", en: "— none —" })}</option>
              {(Object.keys(UNIT_TYPE_AR) as UnitType[]).map((k) => <option key={k} value={k}>{UNIT_TYPE_AR[k]}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="um-season">{t({ ar: "الموسم", en: "Season" })}</label>
            <input id="um-season" type="number" min={0} value={f.season_number} onChange={(e) => set("season_number", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="um-batch">{t({ ar: "الدفعة", en: "Batch" })}</label>
            <input id="um-batch" type="number" min={0} value={f.batch_number} onChange={(e) => set("batch_number", e.target.value)} className={inp} />
          </div>
          <div className="col-span-2">
            <label className={lbl} htmlFor="um-ws">{t({ ar: "مسار العمل", en: "Workstream" })}</label>
            <input id="um-ws" value={f.workstream} onChange={(e) => set("workstream", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="um-pr">{t({ ar: "نشر مخطط", en: "Planned release" })}</label>
            <input id="um-pr" type="date" value={f.planned_release_date} onChange={(e) => set("planned_release_date", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="um-ar">{t({ ar: "نشر فعلي", en: "Actual release" })}</label>
            <input id="um-ar" type="date" value={f.actual_release_date} onChange={(e) => set("actual_release_date", e.target.value)} className={inp} />
          </div>
        </div>
        {renumbering && <p className="text-[10px] text-amber-400">{t({ ar: "تغيير الرقم يتطلّب سببًا وسيُسجَّل في سجلّ التدقيق.", en: "Renumbering requires a reason and is audited." })}</p>}
        {err && <p className="text-[11px] text-red-300" role="alert">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs text-stone-400 px-3 py-2">{t({ ar: "إلغاء", en: "Cancel" })}</button>
          <button disabled={busy} onClick={() => void save()} className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm px-4 py-2">
            {busy ? t({ ar: "جارٍ الحفظ…", en: "Saving…" }) : t({ ar: "حفظ", en: "Save" })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── إعدادات البرنامج ───
function SettingsModal({ projectId, current, onClose, onSaved }:
  { projectId: string; current: ProgramDashboard["settings"]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    operating_model: (current?.operating_model ?? "phased_program") as OperatingModel,
    unit_label_ar: current?.unit_label_ar ?? "",
    numbering_prefix: current?.numbering_prefix ?? "",
    numbering_start: String(current?.numbering_start ?? 1),
    target_units: current?.target_units == null ? "" : String(current.target_units),
    planned_start_date: current?.planned_start_date ?? "",
    planned_end_date: current?.planned_end_date ?? "",
    cadence_type: (current?.cadence_type ?? "none") as CadenceType,
    cadence_interval: String(current?.cadence_interval ?? 1),
    default_child_duration_days: current?.default_child_duration_days == null ? "" : String(current.default_child_duration_days),
    default_manager_inheritance: current?.default_manager_inheritance ?? true,
    default_team_inheritance: current?.default_team_inheritance ?? false,
    require_all_units_closed_before_program_close: current?.require_all_units_closed_before_program_close ?? true,
    client_program_view_enabled: current?.client_program_view_enabled ?? false,
  });
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (busy) return;                                     // منع الإرسال المزدوج
    setBusy(true); setErr("");
    const r = await projectProgramSettingsUpsert(projectId, {
      operating_model: f.operating_model,
      unit_label_ar: f.unit_label_ar.trim() || null,
      numbering_prefix: f.numbering_prefix.trim() || null,
      numbering_start: f.numbering_start.trim() || null,
      target_units: f.target_units.trim() || null,
      planned_start_date: f.planned_start_date || null,
      planned_end_date: f.planned_end_date || null,
      cadence_type: f.cadence_type,
      cadence_interval: f.cadence_interval.trim() || null,
      default_child_duration_days: f.default_child_duration_days.trim() || null,
      default_manager_inheritance: f.default_manager_inheritance,
      default_team_inheritance: f.default_team_inheritance,
      require_all_units_closed_before_program_close: f.require_all_units_closed_before_program_close,
      client_program_view_enabled: f.client_program_view_enabled,
    }, current?.version);
    setBusy(false);
    if (!r.ok) { setErr(programErr(r.error)); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-start justify-center overflow-auto p-3"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-stone-950 border border-stone-800 rounded-2xl my-4 p-4 space-y-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "إعدادات البرنامج", en: "Program settings" })}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className={lbl} htmlFor="pg-model">{t({ ar: "نموذج التشغيل", en: "Operating model" })}</label>
            <select id="pg-model" value={f.operating_model} onChange={(e) => set("operating_model", e.target.value)} className={inp}>
              {(Object.keys(OPERATING_MODEL_AR) as OperatingModel[]).map((k) => <option key={k} value={k}>{OPERATING_MODEL_AR[k]}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="pg-unit">{t({ ar: "تسمية الوحدة", en: "Unit label" })}</label>
            <input id="pg-unit" value={f.unit_label_ar} onChange={(e) => set("unit_label_ar", e.target.value)} placeholder={t({ ar: "حلقة / مرحلة / شهر", en: "Episode / Phase" })} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="pg-target">{t({ ar: "عدد الوحدات المستهدف", en: "Target units" })}</label>
            <input id="pg-target" type="number" min={0} value={f.target_units} onChange={(e) => set("target_units", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="pg-prefix">{t({ ar: "بادئة الترقيم", en: "Numbering prefix" })}</label>
            <input id="pg-prefix" value={f.numbering_prefix} onChange={(e) => set("numbering_prefix", e.target.value)} className={inp} dir="ltr" />
          </div>
          <div>
            <label className={lbl} htmlFor="pg-start">{t({ ar: "بداية الترقيم", en: "Numbering start" })}</label>
            <input id="pg-start" type="number" min={0} value={f.numbering_start} onChange={(e) => set("numbering_start", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="pg-cad">{t({ ar: "التواتر", en: "Cadence" })}</label>
            <select id="pg-cad" value={f.cadence_type} onChange={(e) => set("cadence_type", e.target.value)} className={inp}>
              {(Object.keys(CADENCE_AR) as CadenceType[]).map((k) => <option key={k} value={k}>{CADENCE_AR[k]}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="pg-cadi">{t({ ar: "مضاعف التواتر", en: "Cadence interval" })}</label>
            <input id="pg-cadi" type="number" min={1} value={f.cadence_interval} onChange={(e) => set("cadence_interval", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="pg-ps">{t({ ar: "بداية مخططة", en: "Planned start" })}</label>
            <input id="pg-ps" type="date" value={f.planned_start_date} onChange={(e) => set("planned_start_date", e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl} htmlFor="pg-pe">{t({ ar: "نهاية مخططة", en: "Planned end" })}</label>
            <input id="pg-pe" type="date" value={f.planned_end_date} onChange={(e) => set("planned_end_date", e.target.value)} className={inp} />
          </div>
          <div className="col-span-2">
            <label className={lbl} htmlFor="pg-dur">{t({ ar: "مدة الوحدة الافتراضية (أيام)", en: "Default unit duration (days)" })}</label>
            <input id="pg-dur" type="number" min={0} value={f.default_child_duration_days} onChange={(e) => set("default_child_duration_days", e.target.value)} className={inp} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-[11px] text-stone-400"><input type="checkbox" checked={f.default_manager_inheritance} onChange={(e) => set("default_manager_inheritance", e.target.checked)} />{t({ ar: "توريث مدير المشروع للوحدات الجديدة", en: "Inherit manager" })}</label>
          <label className="flex items-center gap-2 text-[11px] text-stone-400"><input type="checkbox" checked={f.default_team_inheritance} onChange={(e) => set("default_team_inheritance", e.target.checked)} />{t({ ar: "توريث الفريق", en: "Inherit team" })}</label>
          <label className="flex items-center gap-2 text-[11px] text-stone-400"><input type="checkbox" checked={f.require_all_units_closed_before_program_close} onChange={(e) => set("require_all_units_closed_before_program_close", e.target.checked)} />{t({ ar: "اشترط إغلاق كل الوحدات قبل إغلاق البرنامج", en: "Require all units closed first" })}</label>
          <label className="flex items-center gap-2 text-[11px] text-stone-400"><input type="checkbox" checked={f.client_program_view_enabled} onChange={(e) => set("client_program_view_enabled", e.target.checked)} />{t({ ar: "تمكين ملخّص البرنامج للعميل (ضمن صلاحيته فقط)", en: "Enable client program summary" })}</label>
        </div>

        {err && <p className="text-[11px] text-red-300" role="alert">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs text-stone-400 px-3 py-2">{t({ ar: "إلغاء", en: "Cancel" })}</button>
          <button disabled={busy} onClick={() => void save()} className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm px-4 py-2">
            {busy ? t({ ar: "جارٍ الحفظ…", en: "Saving…" }) : t({ ar: "حفظ", en: "Save" })}
          </button>
        </div>
      </div>
    </div>
  );
}

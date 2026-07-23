"use client";
// ════════════════════════════════════════════════════════════════════════════
// ProgramPlanner — Batch 8B. معالج «إنشاء دفعة وحدات» بثلاث خطوات:
// إعداد ← معاينة (بلا كتابة) ← تطبيق ذرّي. الإنشاء يمرّ حصرًا عبر المسار الرسميّ
// (project_core_create_project + apply_template_v2) داخل معاملة واحدة.
// الموجة المتدرّجة: يكفي إنشاء دفعة الآن وأخرى لاحقًا — الترقيم يُكمل ولا يتصادم.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { pcListTemplates, type ProjectTemplate } from "@/lib/portal/projectCore";
import {
  programPlanPreview, programPlanApply, NAME_PATTERNS, CADENCE_AR, UNIT_TYPE_AR, planErr,
  type PlanPreview, type PlanPayload, type CadenceType, type UnitType,
} from "@/lib/portal/programs";

const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const lbl = "text-[11px] text-stone-500 mb-1 block";
const card = "bg-stone-900 border border-stone-800 rounded-xl";

export default function ProgramPlanner({ projectId, unitWord, onClose, onCreated }:
  { projectId: string; unitWord: string; onClose: () => void; onCreated: (n: number) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2>(1);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // مفتاح ثابت لهذا المعالج: إعادة الضغط لا تُنشئ دفعة ثانية (يُعاد نفس الناتج).
  const idemRef = useRef<string>(`plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  // الحمولة التي عوينت فعلًا: التطبيق يرسلها هي، لا حالة النموذج الحالية.
  const previewedRef = useRef<PlanPayload | null>(null);
  const mounted = useRef(true); const seq = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [f, setF] = useState({
    count: "5", start_number: "", name_pattern: NAME_PATTERNS[0].pattern, numbering_prefix: "",
    cadence: "" as "" | CadenceType, cadence_interval: "1", first_start_date: "",
    unit_duration_days: "", gap_days: "0",
    unit_type: "" as "" | UnitType, season_number: "", batch_number: "", workstream: "",
    template_id: "", inherit_manager: true, inherit_team: false,
  });
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { let on = true; void (async () => { const r = await pcListTemplates(); if (on && r.ok) setTemplates(r.data); })(); return () => { on = false; }; }, []);
  // تعديل أيّ حقل بعد المعاينة يُبطلها (لا «عاينتُ ٥ وطبّقتُ ٥٠»).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    seq.current += 1;                                   // يُبطل أيّ معاينة جارية (ردّ متأخّر لا يعيد الخطوة ٢)
    previewedRef.current = null; setPreview(null); setStep(1);
  }, [f]);

  const payload = useCallback((): PlanPayload => ({
    count: Math.min(Math.max(Number(f.count) || 0, 0), 100),   // نفس سقف الخادم
    start_number: f.start_number.trim() ? Number(f.start_number) : undefined,
    name_pattern: f.name_pattern,
    numbering_prefix: f.numbering_prefix.trim() || undefined,
    // "" ⇒ لا نرسل المفتاح فيبقى إعداد البرنامج هو المرجع (كان يُداس دائمًا بـnone/1).
    cadence: f.cadence || undefined,
    cadence_interval: f.cadence ? (Number(f.cadence_interval) || 1) : undefined,
    first_start_date: f.first_start_date || undefined,
    unit_duration_days: f.unit_duration_days.trim() ? Number(f.unit_duration_days) : undefined,
    gap_days: Number(f.gap_days) || 0,
    unit_type: f.unit_type || undefined,
    season_number: f.season_number.trim() ? Number(f.season_number) : undefined,
    batch_number: f.batch_number.trim() ? Number(f.batch_number) : undefined,
    workstream: f.workstream.trim() || undefined,
    template_id: f.template_id || undefined,
    inherit_manager: f.inherit_manager,
    inherit_team: f.inherit_team,
    // بدونه يبقى already_applied فارغًا دائمًا فلا تُكشف إعادة التطبيق قبل الضغط.
    idempotency_key: idemRef.current,
  }), [f]);

  async function doPreview() {
    if (busy) return;
    const my = ++seq.current; setBusy(true); setErr("");
    const p = payload();
    const r = await programPlanPreview(projectId, p);
    if (!mounted.current || my !== seq.current) return;
    setBusy(false);
    if (!r.ok) { setErr(planErr(r.error)); return; }
    previewedRef.current = p; setPreview(r.data); setStep(2);
  }

  async function doApply() {
    if (busy || !preview?.can_apply) return;          // لا تطبيق قبل معاينة صالحة
    setBusy(true); setErr("");
    // نرسل حمولة المعاينة نفسها: تعديل الحقول بعد المعاينة كان سيطبّق خطّة أخرى.
    const r = await programPlanApply(projectId, previewedRef.current ?? payload(), idemRef.current);
    if (!mounted.current) return;
    setBusy(false);
    if (!r.ok) { setErr(planErr(r.error)); return; }
    // replayed=true ⇒ لم يُنشأ شيء جديد؛ الإبلاغ عنه كإنشاء ناجح كذب على المستخدم.
    onCreated(r.data.replayed ? 0 : r.data.created_count);
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-start justify-center overflow-auto p-3"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-2xl bg-stone-950 border border-stone-800 rounded-2xl my-4 p-4 space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {t({ ar: `إنشاء دفعة ${unitWord}`, en: "Create unit batch" })}
            <span className="text-[10px] text-stone-500 me-2"> — {t({ ar: step === 1 ? "الإعداد" : "المعاينة", en: step === 1 ? "Setup" : "Preview" })}</span>
          </h3>
          <button onClick={onClose} disabled={busy} className="text-stone-400 text-sm disabled:opacity-40" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>

        {step === 1 && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lbl} htmlFor="pl-count">{t({ ar: "عدد الوحدات *", en: "How many *" })}</label>
                <input id="pl-count" type="number" min={1} max={100} value={f.count} onChange={(e) => set("count", e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl} htmlFor="pl-start">{t({ ar: "بداية الترقيم (تلقائي)", en: "Start number (auto)" })}</label>
                <input id="pl-start" type="number" min={0} value={f.start_number} onChange={(e) => set("start_number", e.target.value)}
                  placeholder={t({ ar: "يُكمل بعد آخر رقم", en: "continues after last" })} className={inp} />
              </div>
              <div className="col-span-2">
                <label className={lbl} htmlFor="pl-pattern">{t({ ar: "نمط التسمية", en: "Name pattern" })}</label>
                <select id="pl-pattern" value={f.name_pattern} onChange={(e) => set("name_pattern", e.target.value)} className={inp}>
                  {NAME_PATTERNS.map((p) => <option key={p.pattern} value={p.pattern}>{p.pattern} — {p.ar}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} htmlFor="pl-prefix">{t({ ar: "بادئة الكود", en: "Code prefix" })}</label>
                <input id="pl-prefix" value={f.numbering_prefix} onChange={(e) => set("numbering_prefix", e.target.value)} className={inp} dir="ltr" />
              </div>
              <div>
                <label className={lbl} htmlFor="pl-type">{t({ ar: "نوع الوحدة", en: "Unit type" })}</label>
                <select id="pl-type" value={f.unit_type} onChange={(e) => set("unit_type", e.target.value)} className={inp}>
                  <option value="">{t({ ar: "— بلا نوع —", en: "— none —" })}</option>
                  {(Object.keys(UNIT_TYPE_AR) as UnitType[]).map((k) => <option key={k} value={k}>{UNIT_TYPE_AR[k]}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl} htmlFor="pl-first">{t({ ar: "تاريخ بداية أول وحدة", en: "First start date" })}</label>
                <input id="pl-first" type="date" value={f.first_start_date} onChange={(e) => set("first_start_date", e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl} htmlFor="pl-cad">{t({ ar: "التواتر", en: "Cadence" })}</label>
                <select id="pl-cad" value={f.cadence} onChange={(e) => set("cadence", e.target.value)} className={inp}>
                  <option value="">{t({ ar: "من إعداد البرنامج", en: "Use program setting" })}</option>
                  {(Object.keys(CADENCE_AR) as CadenceType[]).map((k) => <option key={k} value={k}>{CADENCE_AR[k]}</option>)}
                </select>
              </div>
              {f.cadence && f.cadence !== "none" && (
                <div>
                  <label className={lbl} htmlFor="pl-cadi">{t({ ar: "مضاعف التواتر", en: "Cadence interval" })}</label>
                  <input id="pl-cadi" type="number" min={1} value={f.cadence_interval} onChange={(e) => set("cadence_interval", e.target.value)} className={inp} />
                </div>
              )}
              <div>
                <label className={lbl} htmlFor="pl-dur">{t({ ar: "مدة الوحدة (أيام)", en: "Unit duration (days)" })}</label>
                <input id="pl-dur" type="number" min={0} value={f.unit_duration_days} onChange={(e) => set("unit_duration_days", e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl} htmlFor="pl-gap">{t({ ar: "فجوة بين الوحدات (أيام)", en: "Gap (days)" })}</label>
                <input id="pl-gap" type="number" min={0} value={f.gap_days} onChange={(e) => set("gap_days", e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl} htmlFor="pl-season">{t({ ar: "الموسم", en: "Season" })}</label>
                <input id="pl-season" type="number" min={0} value={f.season_number} onChange={(e) => set("season_number", e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl} htmlFor="pl-batch">{t({ ar: "الدفعة", en: "Batch" })}</label>
                <input id="pl-batch" type="number" min={0} value={f.batch_number} onChange={(e) => set("batch_number", e.target.value)} className={inp} />
              </div>
              <div className="col-span-2">
                <label className={lbl} htmlFor="pl-tpl">{t({ ar: "القالب (اختياري)", en: "Template (optional)" })}</label>
                <select id="pl-tpl" value={f.template_id} onChange={(e) => set("template_id", e.target.value)} className={inp}>
                  <option value="">{t({ ar: "— بلا قالب —", en: "— none —" })}</option>
                  {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap">
              <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={f.inherit_manager} onChange={(e) => set("inherit_manager", e.target.checked)} />{t({ ar: "توريث المدير", en: "Inherit manager" })}</label>
              <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={f.inherit_team} onChange={(e) => set("inherit_team", e.target.checked)} />{t({ ar: "توريث الفريق", en: "Inherit team" })}</label>
            </div>
          </>
        )}

        {step === 2 && preview && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="text-stone-400">{t({ ar: "قائمة الآن", en: "Existing" })}: {preview.existing_units}</span>
              <span className="text-stone-400">{t({ ar: "ستُنشأ", en: "To create" })}: {preview.plan.count}</span>
              {preview.target_units != null && <span className="text-stone-400">{t({ ar: "المستهدف", en: "Target" })}: {preview.target_units}</span>}
              {preview.remaining_after != null && <span className="text-stone-400">{t({ ar: "المتبقّي بعدها", en: "Remaining after" })}: {preview.remaining_after}</span>}
            </div>

            {preview.already_applied && (
              <p className="text-[11px] text-amber-300 border border-amber-900/60 rounded-lg px-2 py-1">
                {t({ ar: `سبق تطبيق هذه الدفعة (${preview.already_applied.created_count} وحدة) — لن تُنشأ مرّة أخرى.`,
                     en: "This batch was already applied — it will not be created again." })}
              </p>
            )}
            {preview.errors.map((e) => (
              <p key={e.code} className="text-[11px] text-red-300 border border-red-900/60 rounded-lg px-2 py-1" role="alert">{e.ar}</p>
            ))}
            {preview.warnings.map((w) => (
              <p key={w.code} className="text-[11px] text-amber-300 border border-amber-900/50 rounded-lg px-2 py-1">{w.ar}</p>
            ))}

            <div className={`${card} p-2 max-h-64 overflow-auto space-y-1`}>
              {preview.plan.rows.map((r) => (
                <div key={r.index} className="flex items-center gap-2 flex-wrap text-[11px] border-b border-stone-800/60 pb-1">
                  <span className="text-stone-500" dir="ltr">#{r.unit_number}</span>
                  {r.unit_code && <span className="text-stone-600" dir="ltr">{r.unit_code}</span>}
                  <span className="text-stone-200 truncate flex-1 min-w-0" dir="auto">{r.project_name}</span>
                  {r.start_date && <span className="text-stone-500" dir="ltr">{r.start_date}</span>}
                  {r.due_date && <span className="text-stone-600" dir="ltr">→ {r.due_date}</span>}
                  {r.duplicate_number && <span className="text-red-400">{t({ ar: "رقم مكرّر", en: "dup" })}</span>}
                </div>
              ))}
              {preview.plan.rows.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا وحدات في الخطة.", en: "No units planned." })}</p>}
            </div>
            <p className="text-[9px] text-stone-600">{t({ ar: "المعاينة لا تكتب شيئًا. التطبيق ذرّي: إمّا كل الوحدات أو لا شيء.", en: "Preview writes nothing. Apply is atomic: all or nothing." })}</p>
          </div>
        )}

        {err && <p className="text-[11px] text-red-300" role="alert">{err}</p>}

        <div className="flex gap-2 justify-end">
          {step === 2 && <button onClick={() => setStep(1)} disabled={busy} className="text-xs text-stone-400 px-3 py-2 disabled:opacity-40">{t({ ar: "رجوع", en: "Back" })}</button>}
          <button onClick={onClose} disabled={busy} className="text-xs text-stone-400 px-3 py-2 disabled:opacity-40">{t({ ar: "إلغاء", en: "Cancel" })}</button>
          {step === 1 && (
            <button disabled={busy} onClick={() => void doPreview()} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-100 text-sm px-4 py-2 disabled:opacity-40">
              {busy ? t({ ar: "جارٍ…", en: "…" }) : t({ ar: "معاينة", en: "Preview" })}
            </button>
          )}
          {step === 2 && (
            <button disabled={busy || !preview?.can_apply} onClick={() => void doApply()}
              className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm px-4 py-2">
              {busy ? t({ ar: "جارٍ الإنشاء…", en: "Creating…" }) : t({ ar: `إنشاء ${preview?.plan.count ?? 0} وحدة`, en: `Create ${preview?.plan.count ?? 0}` })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

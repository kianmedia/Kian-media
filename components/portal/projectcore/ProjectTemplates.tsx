"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — مدير القوالب الكامل: إنشاء/من مشروع/تعديل/نسخ/معاينة/أرشفة/استعادة
// + تطبيق v2 (اختيار الوحدات + معاينة الأعداد والتواريخ المتوقعة قبل التنفيذ).
// spec: { tasks[], milestones[], deliverables[], risks[], meetings[], shoots[] }
// كل بند يدعم offset_days نسبيًا من تاريخ بداية المشروع.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcListAllTemplates, pcCreateTemplate, pcUpdateTemplate, pcApplyTemplateV2, pcListTasks, pcListRisks, pcListDeliverables,
  pcGetProjectCore, fmtDT, pcErr, type ProjectTemplate,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
type Flash = (m: string) => void;

type SpecRow = { title: string; offset_days?: number | string; [k: string]: unknown };
type Spec = { tasks?: SpecRow[]; milestones?: SpecRow[]; deliverables?: SpecRow[]; risks?: SpecRow[]; meetings?: SpecRow[]; shoots?: SpecRow[] };
const SECTIONS: { k: keyof Spec; ar: string }[] = [
  { k: "tasks", ar: "المهام" }, { k: "milestones", ar: "المعالم" }, { k: "deliverables", ar: "المخرجات" },
  { k: "risks", ar: "المخاطر" }, { k: "meetings", ar: "الاجتماعات" }, { k: "shoots", ar: "جلسات التصوير" },
];
const secArr = (s: Spec, k: keyof Spec): SpecRow[] => Array.isArray(s[k]) ? (s[k] as SpecRow[]) : [];

export function TemplateManagerButton({ projectId, flash, onApplied }: { projectId: string; flash: Flash; onApplied: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "القوالب", en: "Templates" })}</button>
      {open && <TemplateManager projectId={projectId} flash={flash} onApplied={onApplied} onClose={() => setOpen(false)} />}
    </>
  );
}

function TemplateManager({ projectId, flash, onApplied, onClose }: { projectId: string; flash: Flash; onApplied: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [tpls, setTpls] = useState<ProjectTemplate[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<ProjectTemplate | "new" | null>(null);
  const [applyFor, setApplyFor] = useState<ProjectTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListAllTemplates(); if (r.ok) setTpls(r.data); }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = (tpl: ProjectTemplate) => {
    const s = (tpl.spec ?? {}) as Spec;
    return SECTIONS.map(({ k, ar }) => ({ ar, n: secArr(s, k).length })).filter((x) => x.n > 0);
  };
  async function copy(tpl: ProjectTemplate) {
    if (busy) return; setBusy(true);
    const r = await pcCreateTemplate({ name: `${tpl.name} (نسخة)`, description: tpl.description ?? undefined, spec: tpl.spec });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "نُسخ القالب.", en: "Copied." })); void load();
  }
  async function setActive(tpl: ProjectTemplate, active: boolean) {
    if (busy) return; setBusy(true);
    const r = await pcUpdateTemplate(tpl.id, { is_active: active });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t(active ? { ar: "استُعيد القالب.", en: "Restored." } : { ar: "أُرشف القالب.", en: "Archived." })); void load();
  }
  // 7A: أُزيل التقاط «من هذا المشروع» من هنا — كان يُجمَّع spec في المتصفّح فينتج قالبًا
  // ناقصًا صامتًا لمن لا يقرأ كل الصفوف، وبلا ذرّية، وبلا قوائم تحقّق/اعتماديات.
  // البديل الوحيد الآن: زرّ «حفظ كقالب» في شريط أدوات المشروع (project_save_as_template).
  const list = tpls.filter((x) => showArchived ? !x.is_active : x.is_active);

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/80 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl my-4 bg-stone-950 border border-stone-800 rounded-2xl p-4 space-y-3" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "قوالب المشاريع", en: "Project Templates" })}</h3>
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{t({ ar: "المؤرشفة", en: "Archived" })}</label>
            <button onClick={() => setEditor("new")} className={`${btnRed} px-2.5 py-1 text-[11px]`}>+ {t({ ar: "قالب جديد", en: "New" })}</button>
            <button onClick={onClose} className="text-stone-400 text-sm">✕</button>
          </div>
        </div>
        {list.length === 0 && <p className="text-xs text-stone-500">{t({ ar: showArchived ? "لا قوالب مؤرشفة." : "لا قوالب بعد — أنشئ الأول.", en: "None." })}</p>}
        {list.map((tpl) => (
          <div key={tpl.id} className={`${card} p-3 text-xs`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-stone-200">{tpl.name}</div>
                <div className="text-[11px] text-stone-500">
                  {counts(tpl).map((c) => `${c.n} ${c.ar}`).join(" · ") || t({ ar: "قالب فارغ", en: "Empty" })}
                  {(tpl as { service_type?: string }).service_type ? ` · ${(tpl as { service_type?: string }).service_type}` : ""}
                </div>
                {tpl.description && <div className="text-[11px] text-stone-600">{tpl.description}</div>}
              </div>
              <div className="flex gap-2 shrink-0 text-[11px] flex-wrap">
                {tpl.is_active && <button onClick={() => setApplyFor(tpl)} className={`${btnRed} px-2.5 py-1`}>{t({ ar: "تطبيق", en: "Apply" })}</button>}
                <button onClick={() => setEditor(tpl)} className="text-sky-400">{t({ ar: "تعديل", en: "Edit" })}</button>
                <button disabled={busy} onClick={() => void copy(tpl)} className="text-stone-400">{t({ ar: "نسخ", en: "Copy" })}</button>
                {tpl.is_active
                  ? <button disabled={busy} onClick={() => void setActive(tpl, false)} className="text-stone-500">{t({ ar: "أرشفة", en: "Archive" })}</button>
                  : <button disabled={busy} onClick={() => void setActive(tpl, true)} className="text-emerald-400">{t({ ar: "استعادة", en: "Restore" })}</button>}
              </div>
            </div>
          </div>
        ))}
        {editor && <TemplateEditor existing={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(); }} flash={flash} />}
        {applyFor && <TemplateApply projectId={projectId} tpl={applyFor} onClose={() => setApplyFor(null)} onApplied={() => { setApplyFor(null); onApplied(); onClose(); }} flash={flash} />}
      </div>
    </div>
  );
}

// محرّر قالب: بيانات وصفية + أقسام قابلة للتحرير صفًا صفًا.
function TemplateEditor({ existing, onClose, onSaved, flash }: { existing: ProjectTemplate | null; onClose: () => void; onSaved: () => void; flash: Flash }) {
  const { t } = useI18n();
  const seeded = existing && !existing.id ? existing : null;   // «من مشروع» يمرَّر بلا id
  const real = existing && existing.id ? existing : null;
  const [name, setName] = useState(real?.name ?? "");
  const [desc, setDesc] = useState(real?.description ?? "");
  const [service, setService] = useState((real as { service_type?: string } | null)?.service_type ?? "");
  const [duration, setDuration] = useState(String((real as { default_duration_days?: number } | null)?.default_duration_days ?? ""));
  const [spec, setSpec] = useState<Spec>(() => ((real ?? seeded)?.spec ?? {}) as Spec);
  const [sec, setSec] = useState<keyof Spec>("tasks");
  const [busy, setBusy] = useState(false);

  const rows = secArr(spec, sec);
  const setRows = (r: SpecRow[]) => setSpec((p) => ({ ...p, [sec]: r }));
  const upRow = (i: number, patch: Partial<SpecRow>) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const lines = (v: unknown): string => Array.isArray(v) ? v.map((x) => typeof x === "string" ? x : (x as { title?: string; label?: string })?.title ?? (x as { label?: string })?.label ?? "").join("\n") : "";
  const toLines = (s: string, key: "title" | "label") => s.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => ({ [key]: x }));

  async function save() {
    if (busy || !name.trim()) { if (!name.trim()) flash(t({ ar: "اسم القالب إلزامي.", en: "Name required." })); return; }
    setBusy(true);
    const meta = { name: name.trim(), description: desc.trim() || null, service_type: service.trim() || null,
      default_duration_days: duration.trim() ? Number(duration) : null, spec: spec as Record<string, unknown> };
    const r = real
      ? await pcUpdateTemplate(real.id, meta)
      : await pcCreateTemplate({ name: meta.name, description: meta.description ?? undefined, spec: meta.spec });
    // service/duration لقالب جديد: تحديث لاحق (الإنشاء عبر ppost بالأعمدة الأساسية).
    if (!real && r.ok && Array.isArray(r.data) && r.data[0]) {
      await pcUpdateTemplate((r.data[0] as ProjectTemplate).id, { service_type: meta.service_type, default_duration_days: meta.default_duration_days });
    }
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "حُفظ القالب.", en: "Saved." })); onSaved();
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-black/80 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl my-4 bg-stone-950 border border-stone-800 rounded-2xl p-4 space-y-3" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t(real ? { ar: "تعديل القالب", en: "Edit template" } : { ar: "قالب جديد", en: "New template" })}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t({ ar: "اسم القالب *", en: "Name *" })} className={`${inp} col-span-2`} />
          <input value={desc ?? ""} onChange={(e) => setDesc(e.target.value)} placeholder={t({ ar: "الوصف", en: "Description" })} className={inp} />
          <div className="flex gap-2">
            <input value={service} onChange={(e) => setService(e.target.value)} placeholder={t({ ar: "نوع الخدمة", en: "Service" })} className={`${inp} flex-1`} />
            <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t({ ar: "المدة (يوم)", en: "Days" })} className={`${inp} w-24`} dir="ltr" />
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {SECTIONS.map(({ k, ar }) => (
            <button key={k} onClick={() => setSec(k)} className={`px-2 py-1 rounded text-[11px] ${sec === k ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>
              {ar} ({secArr(spec, k).length})
            </button>
          ))}
        </div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="bg-stone-900 border border-stone-800 rounded p-2 space-y-1 text-xs">
              <div className="flex gap-1.5 items-center">
                <input value={String(r.title ?? "")} onChange={(e) => upRow(i, { title: e.target.value })} placeholder={t({ ar: "العنوان", en: "Title" })} className={`${inp} flex-1 py-1`} />
                <input type="number" value={String(r.offset_days ?? "")} onChange={(e) => upRow(i, { offset_days: e.target.value })} placeholder="+يوم" title={t({ ar: "الإزاحة بالأيام من بداية المشروع", en: "Offset days" })} className={`${inp} w-20 py-1`} dir="ltr" />
                {sec === "tasks" && <input type="number" value={String((r as { due_offset_days?: number }).due_offset_days ?? "")} onChange={(e) => upRow(i, { due_offset_days: e.target.value })} placeholder={t({ ar: "استحقاق", en: "due" })} className={`${inp} w-20 py-1`} dir="ltr" />}
                {sec === "tasks" && (
                  <select value={String(r.priority ?? "normal")} onChange={(e) => upRow(i, { priority: e.target.value })} className={`${inp} py-1 text-[10px]`} style={{ colorScheme: "dark" }}>
                    {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                {sec === "tasks" && (
                  <select value={String((r as { depends_on?: number }).depends_on ?? "")} onChange={(e) => upRow(i, { depends_on: e.target.value === "" ? undefined : Number(e.target.value) })} className={`${inp} py-1 text-[10px]`} style={{ colorScheme: "dark" }} title={t({ ar: "يعتمد على مهمة سابقة", en: "Depends on" })}>
                    <option value="">{t({ ar: "— اعتماد —", en: "dep" })}</option>
                    {rows.slice(0, i).map((p, j) => <option key={j} value={j}>{j + 1}. {String(p.title ?? "").slice(0, 18)}</option>)}
                  </select>
                )}
                {sec === "deliverables" && (
                  <select value={String(r.type ?? "video")} onChange={(e) => upRow(i, { type: e.target.value })} className={`${inp} py-1 text-[10px]`} style={{ colorScheme: "dark" }}>
                    {["video", "photo", "other"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                {sec === "risks" && (
                  <select value={String(r.severity ?? "medium")} onChange={(e) => upRow(i, { severity: e.target.value })} className={`${inp} py-1 text-[10px]`} style={{ colorScheme: "dark" }}>
                    {["low", "medium", "high", "critical"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-stone-600 hover:text-red-400">✕</button>
              </div>
              {sec === "tasks" && (
                <div className="grid grid-cols-2 gap-1.5">
                  <textarea value={lines((r as { checklist?: unknown }).checklist)} onChange={(e) => upRow(i, { checklist: toLines(e.target.value, "label") })} placeholder={t({ ar: "قائمة تحقق (سطر لكل بند)", en: "Checklist" })} className={`${inp} py-1 min-h-[36px] text-[10px]`} />
                  <textarea value={lines((r as { subtasks?: unknown }).subtasks)} onChange={(e) => upRow(i, { subtasks: toLines(e.target.value, "title") })} placeholder={t({ ar: "مهام فرعية (سطر لكل مهمة)", en: "Subtasks" })} className={`${inp} py-1 min-h-[36px] text-[10px]`} />
                </div>
              )}
            </div>
          ))}
          <button onClick={() => setRows([...rows, { title: "" }])} className={`${btnGhost} w-full py-1.5 text-[11px]`}>+ {t({ ar: "إضافة بند", en: "Add row" })}</button>
        </div>
        <button disabled={busy || !name.trim()} onClick={() => void save()} className={`${btnRed} w-full py-2.5`}>{busy ? "…" : t({ ar: "حفظ القالب", en: "Save" })}</button>
      </div>
    </div>
  );
}

// تطبيق v2: اختيار الوحدات + معاينة الأعداد والتواريخ المتوقعة.
function TemplateApply({ projectId, tpl, onClose, onApplied, flash }: { projectId: string; tpl: ProjectTemplate; onClose: () => void; onApplied: () => void; flash: Flash }) {
  const { t } = useI18n();
  const spec = (tpl.spec ?? {}) as Spec;
  const [mods, setMods] = useState<Set<string>>(new Set(SECTIONS.filter(({ k }) => secArr(spec, k).length > 0).map(({ k }) => k)));
  const [start, setStart] = useState("");
  const [baseDate, setBaseDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pcGetProjectCore(projectId).then((r) => { if (r.ok) setBaseDate(r.data?.start_date ?? null); }); }, [projectId]);
  const base = start || baseDate || new Date().toISOString().slice(0, 10);
  const expDate = (o?: number | string) => {
    const n = Number(o); if (!Number.isFinite(n)) return null;
    const d = new Date(base); d.setDate(d.getDate() + n);
    return fmtDT(d.toISOString()).slice(0, 10);
  };
  const toggle = (k: string) => setMods((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  async function apply() {
    if (busy || mods.size === 0) return; setBusy(true);
    const r = await pcApplyTemplateV2(projectId, tpl.id, Array.from(mods), start || undefined);
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: `طُبِّق القالب: ${r.data.tasks} مهمة، ${r.data.milestones} معلَم، ${r.data.deliverables} مخرَج، ${r.data.risks} خطر، ${r.data.meetings} اجتماع، ${r.data.shoots} جلسة.`, en: "Applied." }));
    onApplied();
  }
  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-black/80 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md my-4 bg-stone-950 border border-stone-800 rounded-2xl p-4 space-y-3" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "تطبيق", en: "Apply" })} «{tpl.name}»</h3>
          <button onClick={onClose} className="text-stone-400 text-sm">✕</button>
        </div>
        <label className="block text-xs"><span className="text-stone-500">{t({ ar: "تاريخ الأساس (افتراضي: بداية المشروع)", en: "Base date" })}</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${inp} w-full mt-0.5`} style={{ colorScheme: "dark" }} /></label>
        <div className="space-y-1.5">
          {SECTIONS.map(({ k, ar }) => {
            const arr = secArr(spec, k);
            if (arr.length === 0) return null;
            const first = arr.find((x) => Number.isFinite(Number(x.offset_days)));
            return (
              <label key={k} className={`${card} p-2.5 flex items-center gap-2 text-xs cursor-pointer`}>
                <input type="checkbox" checked={mods.has(k)} onChange={() => toggle(k)} />
                <span className="text-stone-200 flex-1">{ar}</span>
                <span className="text-stone-500" dir="ltr">{arr.length}</span>
                {first && <span className="text-[10px] text-stone-600" dir="ltr">{t({ ar: "أول تاريخ", en: "first" })}: {expDate(first.offset_days)}</span>}
              </label>
            );
          })}
        </div>
        <p className="text-[10px] text-stone-600">{t({ ar: "منع التطبيق المزدوج مفروض خادميًا (معرّف تطبيق فريد + Audit).", en: "Double-apply prevented server-side." })}</p>
        <button disabled={busy || mods.size === 0} onClick={() => void apply()} className={`${btnRed} w-full py-2.5`}>{busy ? "…" : t({ ar: "تطبيق القالب على المشروع", en: "Apply" })}</button>
      </div>
    </div>
  );
}

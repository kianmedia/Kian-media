"use client";
// ════════════════════════════════════════════════════════════════════════════
// ClosurePolicyPanel — V1 CLOSURE.
//
// WHY THIS EXISTS: pc_closure_settings_upsert has been deployed and granted the whole
// time, but NOTHING in the product called it. Every project therefore ran on table
// defaults, which meant the requirement "a master project must not close while a
// mandatory subproject is still open" COULD NOT BE ENABLED AT ALL —
// require_child_projects_closed had no way to be turned on.
//
// This panel is the missing surface. It writes the EXISTING settings row through the
// EXISTING RPC — no new table, no new RPC, no parallel policy store. The readiness
// engine already reads these flags; turning one on makes its blocker appear.
//
// Authorization: management only (the caller is gated here AND server-side inside
// pc_closure_settings_upsert). Every change is written by the RPC, which audit-logs it.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { pcClosureSettingsUpsert, closureErr } from "@/lib/portal/projectClosure";

/** Flags exactly as pc_closure_settings_upsert accepts them (verified against the RPC). */
const FLAGS: { key: string; ar: string; en: string; hint?: { ar: string; en: string } }[] = [
  { key: "require_child_projects_closed", ar: "إغلاق المشاريع الفرعية أولًا", en: "Subprojects must be closed first",
    hint: { ar: "يمنع إغلاق المشروع الرئيسي قبل اكتمال فروعه — يبقى التجاوز ممكنًا للمالك بسبب مسجَّل.",
            en: "Blocks closing a master before its children. Owner override with a recorded reason stays possible." } },
  { key: "require_deliverables_approved_before_close", ar: "اعتماد كل المخرجات", en: "All deliverables approved" },
  { key: "require_final_files_available", ar: "توفّر الملفات النهائية", en: "Final files available" },
  { key: "require_client_approval", ar: "قبول العميل النهائي", en: "Client final acceptance" },
  { key: "require_tasks_complete_before_close", ar: "اكتمال المهام", en: "Tasks complete" },
  { key: "require_risks_closed_before_close", ar: "إغلاق المخاطر الحرجة", en: "Critical risks closed" },
  { key: "require_issues_closed_before_close", ar: "إغلاق المشكلات الحرجة", en: "Critical issues closed" },
  { key: "require_change_requests_closed_before_close", ar: "حسم طلبات التغيير", en: "Change requests settled" },
  { key: "require_resource_bookings_closed_before_close", ar: "إقفال حجوزات الموارد", en: "Resource bookings closed" },
  { key: "require_time_logs_submitted", ar: "تسليم سجلات الوقت", en: "Time logs submitted" },
  { key: "require_lessons_learned", ar: "تسجيل الدروس المستفادة", en: "Lessons learned recorded" },
  { key: "require_closure_report", ar: "إصدار تقرير الإقفال", en: "Closure report issued" },
  { key: "require_internal_approval", ar: "اعتماد داخلي", en: "Internal approval" },
  { key: "require_financial_clearance_before_close", ar: "الإخلاء المالي", en: "Financial clearance" },
  { key: "require_final_payment_before_close", ar: "سداد الدفعة النهائية", en: "Final payment settled" },
];

const APPROVAL_MODES = [
  { k: "single", ar: "اعتماد واحد", en: "Single approver" },
  { k: "dual", ar: "اعتمادان", en: "Dual approval" },
  { k: "owner_only", ar: "المالك فقط", en: "Owner only" },
];

export default function ClosurePolicyPanel({
  projectId, settings, canManage, flash, onSaved,
}: {
  projectId: string;
  settings: Record<string, unknown> | null | undefined;
  canManage: boolean;
  flash: (m: string) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...(settings ?? {}) }));
  const on = (k: string) => draft[k] === true;
  const toggle = (k: string) => setDraft((p) => ({ ...p, [k]: !(p[k] === true) }));

  async function save() {
    if (busy || !canManage) return;
    setBusy(true);
    const r = await pcClosureSettingsUpsert(projectId, draft);
    setBusy(false);
    if (!r.ok) { flash(closureErr(r.error)); return; }
    flash(t({ ar: "حُفظت سياسة الإقفال.", en: "Closure policy saved." }));
    onSaved();
  }

  const activeCount = FLAGS.filter((f) => on(f.key)).length;

  return (
    <section className="border border-stone-800 rounded-xl p-3 bg-stone-950 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-semibold text-stone-200">{t({ ar: "سياسة الإقفال", en: "Closure policy" })}</h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-stone-500">{activeCount}/{FLAGS.length} {t({ ar: "شرطًا مفعّلًا", en: "rules on" })}</span>
          <button onClick={() => setOpen((v) => !v)} className="text-[10px] text-sky-400 hover:text-sky-300">
            {open ? t({ ar: "إخفاء", en: "Hide" }) : t({ ar: "إعداد", en: "Configure" })}
          </button>
        </div>
      </div>

      {!open && (
        <p className="text-[10px] text-stone-500">
          {on("require_child_projects_closed")
            ? t({ ar: "✔ المشروع الرئيسي لن يُغلق قبل اكتمال فروعه.", en: "✔ A master cannot close before its subprojects." })
            : t({ ar: "⚠️ شرط «إغلاق الفروع أولًا» غير مفعّل لهذا المشروع.", en: "⚠️ The 'subprojects closed first' rule is OFF for this project." })}
        </p>
      )}

      {open && (
        <div className="space-y-1.5">
          {FLAGS.map((f) => (
            <label key={f.key} className="flex items-start gap-2 text-[10px] text-stone-300 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={on(f.key)} disabled={!canManage}
                onChange={() => toggle(f.key)} aria-label={t({ ar: f.ar, en: f.en })} />
              <span className="flex-1">
                <span className="block">{t({ ar: f.ar, en: f.en })}</span>
                {f.hint && <span className="block text-stone-600 text-[9px]">{t(f.hint)}</span>}
              </span>
            </label>
          ))}

          <label className="block text-[10px] text-stone-500 pt-1">
            {t({ ar: "نمط اعتماد الإقفال", en: "Closure approval mode" })}
            <select
              className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-[11px] text-stone-200"
              value={typeof draft.closure_approval_mode === "string" ? draft.closure_approval_mode : "single"}
              disabled={!canManage}
              onChange={(e) => setDraft((p) => ({ ...p, closure_approval_mode: e.target.value }))}
            >
              {APPROVAL_MODES.map((m) => <option key={m.k} value={m.k}>{t({ ar: m.ar, en: m.en })}</option>)}
            </select>
          </label>

          <label className="block text-[10px] text-stone-500">
            {t({ ar: "الأرشفة بعد (يوم)", en: "Archive after (days)" })}
            <input type="number" min={0}
              className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-[11px] text-stone-200"
              value={typeof draft.archive_after_days === "number" ? draft.archive_after_days : ""}
              disabled={!canManage}
              onChange={(e) => setDraft((p) => ({ ...p, archive_after_days: e.target.value === "" ? null : Number(e.target.value) }))} />
          </label>

          <div className="flex items-center gap-2 pt-1">
            <button disabled={busy || !canManage} onClick={() => void save()}
              className="text-[10px] rounded px-3 py-1 border border-sky-700 text-sky-300 hover:bg-sky-950 disabled:opacity-50">
              {busy ? t({ ar: "جارٍ الحفظ…", en: "Saving…" }) : t({ ar: "حفظ السياسة", en: "Save policy" })}
            </button>
            {!canManage && <span className="text-[9px] text-amber-500">{t({ ar: "عرض فقط — الإعداد لإدارة المشاريع.", en: "Read-only — management configures this." })}</span>}
          </div>
          <p className="text-[9px] text-stone-600">
            {t({ ar: "تُحفظ في إعدادات المشروع القائمة ويقرأها محرّك الجاهزية مباشرة. كل تغيير يُسجَّل.",
                 en: "Saved to the existing project settings and read directly by the readiness engine. Every change is logged." })}
          </p>
        </div>
      )}
    </section>
  );
}

"use client";
// ════════════════════════════════════════════════════════════════════════
// إعدادات الموارد البشرية المركزية (owner/manager/hr) — toggles وحقول واضحة.
// كل حفظ يمرّ عبر hr_admin_update_settings (patch جزئي) ويُشعر مجموعة الإدارة
// بوابةً وإيميلًا (hr_settings_updated). لا يُرسل شيء للموظفين من هنا.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { hrAdminUpdateSettings, emitHrEvent, type HrSettings } from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on}
      className={`relative shrink-0 rounded-full transition-colors ${on ? "bg-red-600" : "bg-stone-700"} disabled:opacity-50`}
      style={{ width: 48, height: 26 }}>
      <span className="absolute rounded-full bg-white transition-all"
        style={{ width: 22, height: 22, top: 2, insetInlineStart: on ? 24 : 2 }} />
    </button>
  );
}

export default function HrSettingsPanel({ settings, busy, setBusy, flash, onSaved }: {
  settings: HrSettings; busy: boolean; setBusy: (b: boolean) => void;
  flash: (m: string) => void; onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<HrSettings>(settings);
  // dirty = تعديلات دوام غير محفوظة — تمنع مزامنة props/حفظ toggle من الكتابة فوقها.
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setF(settings); }, [settings, dirty]);

  async function save(patch: Partial<HrSettings>, changedLabel: string) {
    if (busy) return;
    setBusy(true);
    const r = await hrAdminUpdateSettings(patch);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر حفظ الإعداد: ", en: "Couldn't save: " }) + r.error); return; }
    const savedWorkHours = "late_grace_minutes" in patch;
    if (savedWorkHours) setDirty(false);
    setF((prev) => (dirty && !savedWorkHours
      ? { ...r.data, late_grace_minutes: prev.late_grace_minutes,
          default_work_start_time: prev.default_work_start_time,
          default_work_end_time: prev.default_work_end_time }
      : r.data));
    emitHrEvent({ event: "hr_settings_updated", entity_id: "hr-settings-1", title: "تحديث إعدادات HR: " + changedLabel });
    await onSaved();
    flash(t({ ar: "حُفظ الإعداد: ", en: "Saved: " }) + changedLabel);
  }

  const TOGGLES: { key: keyof HrSettings; ar: string; desc: string }[] = [
    { key: "employee_leave_requests_enabled", ar: "إظهار طلبات الإجازة/الإذن للموظفين",
      desc: "موقوف: القسم مخفي وأي إرسال يُرفض (leave_requests_disabled)." },
    { key: "multiple_attendance_sessions_enabled", ar: "السماح بتعدد جلسات الحضور في اليوم",
      desc: "موقوف: جلسة واحدة فقط لكل يوم (حضور ← انصراف)." },
    { key: "task_completion_photo_required", ar: "إلزام صورة عند إنهاء المهمة",
      desc: "مفعّل: لا يمكن تسليم المهمة بدون صورة واحدة على الأقل." },
    { key: "show_performance_reviews_enabled", ar: "إظهار تقييم الأداء للموظف",
      desc: "موقوف (الافتراضي): التقييم داخلي للإدارة فقط." },
    { key: "device_attendance_enabled", ar: "تفعيل أجهزة الحضور (تحويل الأحداث إلى حضور/انصراف)",
      desc: "موقوف: أحداث الأجهزة تُوثَّق فقط دون تعديل سجلات الحضور." },
    { key: "manual_device_import_enabled", ar: "السماح باستيراد سجلات الأجهزة يدويًا",
      desc: "مفعّل: يمكن إدخال أحداث الجهاز من تبويب الأجهزة." },
  ];

  return (
    <div className="space-y-4">
      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">{t({ ar: "مفاتيح التشغيل", en: "Feature toggles" })}</h3>
        <div className="space-y-3">
          {TOGGLES.map((tg) => (
            <div key={tg.key} className="flex items-start gap-3 flex-wrap border-b border-stone-800 pb-3 last:border-0 last:pb-0">
              <Toggle on={f[tg.key] === true} disabled={busy}
                onClick={() => void save({ [tg.key]: !(f[tg.key] === true) } as Partial<HrSettings>, tg.ar)} />
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm text-stone-200">{tg.ar}</div>
                <div className="text-[11px] text-stone-500 mt-0.5">{tg.desc}</div>
              </div>
              <span className={`inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${
                f[tg.key] === true ? "bg-emerald-950 text-emerald-300 border-emerald-800" : "bg-stone-800 text-stone-400 border-stone-700"}`}>
                {f[tg.key] === true ? t({ ar: "مفعّل", en: "On" }) : t({ ar: "موقوف", en: "Off" })}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">{t({ ar: "الدوام والتأخير", en: "Work hours & lateness" })}</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "سماحية التأخير (دقائق)", en: "Late grace (minutes)" })}</label>
            <input type="number" min={0} max={240} value={f.late_grace_minutes}
              onChange={(e) => { setDirty(true); setF({ ...f, late_grace_minutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) }); }}
              className={inp} dir="ltr" />
          </div>
          <div>
            <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "بداية الدوام الافتراضية", en: "Default work start" })}</label>
            <input type="time" value={f.default_work_start_time ?? ""}
              onChange={(e) => { setDirty(true); setF({ ...f, default_work_start_time: e.target.value || null }); }} className={inp} dir="ltr" />
          </div>
          <div>
            <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "نهاية الدوام الافتراضية", en: "Default work end" })}</label>
            <input type="time" value={f.default_work_end_time ?? ""}
              onChange={(e) => { setDirty(true); setF({ ...f, default_work_end_time: e.target.value || null }); }} className={inp} dir="ltr" />
          </div>
        </div>
        <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">
          {t({ ar: "يُستخدم وقت البداية + السماحية لحساب التأخير في التقرير الشهري (بتوقيت الرياض). اتركه فارغًا لتعطيل حساب التأخير.",
               en: "Start time + grace compute lateness in the monthly report (Riyadh time). Leave empty to disable." })}
        </p>
        <button type="button" disabled={busy}
          onClick={() => void save({
            late_grace_minutes: f.late_grace_minutes,
            default_work_start_time: f.default_work_start_time ?? "",
            default_work_end_time: f.default_work_end_time ?? "",
          } as unknown as Partial<HrSettings>, t({ ar: "الدوام والتأخير", en: "work hours" }))}
          className={`${btnRed} mt-3 px-5 py-2`}>
          {busy ? "…" : t({ ar: "حفظ إعدادات الدوام", en: "Save work hours" })}
        </button>
      </section>
    </div>
  );
}

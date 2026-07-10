"use client";
// ════════════════════════════════════════════════════════════════════════
// تقويم الموارد البشرية (owner/manager/hr) — أيام العطلة الأسبوعية + العطل
// الرسمية/أيام العمل الخاصة. يُستخدم في احتساب أيام العمل بالتقارير. حذف soft
// بسبب إلزامي. كل تحديث يُشعر الإدارة (hr_calendar_updated).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  hrGetCalendar, hrAdminSetWeekendDays, hrListHolidays, hrAdminUpsertHoliday, hrAdminDeleteHoliday,
  emitHrEvent, HOLIDAY_TYPE_LABELS, type HrHoliday, type HolidayType,
} from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const chip = (cls: string) => `inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${cls}`;

const DOW = [
  { n: 0, ar: "الأحد" }, { n: 1, ar: "الاثنين" }, { n: 2, ar: "الثلاثاء" }, { n: 3, ar: "الأربعاء" },
  { n: 4, ar: "الخميس" }, { n: 5, ar: "الجمعة" }, { n: 6, ar: "السبت" },
];

export default function HrCalendar({ busy, setBusy, flash, onChanged }: {
  busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void; onChanged: () => void;
}) {
  const { t } = useI18n();
  const [weekend, setWeekend] = useState<number[]>([5, 6]);
  const [holidays, setHolidays] = useState<HrHoliday[]>([]);
  const emptyH = { id: "", title: "", date: "", type: "public_holiday" as HolidayType, description: "" };
  const [hf, setHf] = useState(emptyH);
  const [del, setDel] = useState<{ id: string; reason: string } | null>(null);

  const reload = useCallback(async () => {
    const [c, h] = await Promise.all([hrGetCalendar(), hrListHolidays()]);
    if (c.ok) setWeekend(c.data.weekend_days ?? [5, 6]);
    if (h.ok) setHolidays(h.data);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function toggleDay(n: number) {
    if (busy) return;
    const next = weekend.includes(n) ? weekend.filter((x) => x !== n) : [...weekend, n].sort((a, b) => a - b);
    setBusy(true);
    const r = await hrAdminSetWeekendDays(next);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر الحفظ: ", en: "Failed: " }) + r.error); return; }
    setWeekend(r.data.weekend_days ?? next);
    emitHrEvent({ event: "hr_calendar_updated", entity_id: "hr-weekend", title: "تحديث أيام العطلة الأسبوعية" });
    onChanged();
    flash(t({ ar: "حُفظت أيام العطلة الأسبوعية.", en: "Weekend days saved." }));
  }

  async function saveHoliday() {
    if (!hf.title.trim() || !hf.date) { flash(t({ ar: "العنوان والتاريخ مطلوبان.", en: "Title & date required." })); return; }
    setBusy(true);
    const r = await hrAdminUpsertHoliday({ id: hf.id || null, title: hf.title.trim(), date: hf.date, type: hf.type, description: hf.description.trim() || undefined });
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر الحفظ: ", en: "Failed: " }) + r.error); return; }
    emitHrEvent({ event: "hr_calendar_updated", entity_id: r.data.id, title: "تحديث تقويم: " + hf.title.trim() });
    setHf(emptyH);
    await reload();
    onChanged();
    flash(t({ ar: "حُفظت العطلة.", en: "Holiday saved." }));
  }

  async function doDelete(h: HrHoliday) {
    const reason = (del?.reason || "").trim();
    if (!reason) { flash(t({ ar: "سبب الحذف إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await hrAdminDeleteHoliday(h.id, reason);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر الحذف: ", en: "Delete failed: " }) + r.error); return; }
    emitHrEvent({ event: "hr_calendar_updated", entity_id: h.id, title: "حذف عطلة: " + h.title });
    setDel(null);
    await reload();
    onChanged();
    flash(t({ ar: "حُذفت العطلة (حذف آمن).", en: "Holiday removed." }));
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-2">{t({ ar: "أيام العطلة الأسبوعية", en: "Weekend days" })}</h3>
        <p className="text-[11px] text-stone-500 mb-3">{t({ ar: "الأيام المحددة لا تُحتسب أيام عمل في التقارير (ما لم تُضف كيوم عمل خاص).", en: "Selected days are not counted as workdays." })}</p>
        <div className="flex gap-1.5 flex-wrap">
          {DOW.map((d) => {
            const on = weekend.includes(d.n);
            return (
              <button key={d.n} type="button" disabled={busy} onClick={() => void toggleDay(d.n)}
                className={`rounded-full border px-3 py-1.5 text-xs ${on ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"} disabled:opacity-50`}>
                {d.ar}
              </button>
            );
          })}
        </div>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">{hf.id ? t({ ar: "تعديل عطلة", en: "Edit holiday" }) : t({ ar: "إضافة عطلة / يوم خاص", en: "Add holiday / special day" })}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={hf.title} onChange={(e) => setHf({ ...hf, title: e.target.value })} placeholder={t({ ar: "العنوان *", en: "Title *" })} className={inp} />
          <input type="date" value={hf.date} onChange={(e) => setHf({ ...hf, date: e.target.value })} className={inp} dir="ltr" />
          <select value={hf.type} onChange={(e) => setHf({ ...hf, type: e.target.value as HolidayType })} className={inp}>
            {(Object.keys(HOLIDAY_TYPE_LABELS) as HolidayType[]).map((k) => <option key={k} value={k}>{t(HOLIDAY_TYPE_LABELS[k])}</option>)}
          </select>
          <input value={hf.description} onChange={(e) => setHf({ ...hf, description: e.target.value })} placeholder={t({ ar: "وصف (اختياري)", en: "Description" })} className={inp} />
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" disabled={busy} onClick={() => void saveHoliday()} className={`${btnRed} px-5 py-2`}>{t({ ar: "حفظ", en: "Save" })}</button>
          {hf.id && <button type="button" onClick={() => setHf(emptyH)} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>}
        </div>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">{t({ ar: "العطل المسجّلة", en: "Registered holidays" })}</h3>
        {holidays.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا عطل مسجّلة.", en: "No holidays." })}</p>}
        <div className="space-y-1.5">
          {holidays.map((h) => (
            <div key={h.id} className="flex items-center gap-2 flex-wrap bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-xs">
              <span className="font-mono text-stone-500" dir="ltr">{h.holiday_date}</span>
              <span className="text-stone-100">{h.title}</span>
              <span className={chip(h.type === "special_workday" ? "bg-emerald-950 text-emerald-300 border-emerald-800" : "bg-stone-800 text-stone-300 border-stone-700")}>
                {t(HOLIDAY_TYPE_LABELS[h.type] ?? { ar: h.type, en: h.type })}
              </span>
              {h.description && <span className="text-stone-500">{h.description}</span>}
              <button type="button" className="ms-auto text-stone-500 hover:text-red-400 underline text-[11px]"
                onClick={() => setHf({ id: h.id, title: h.title, date: h.holiday_date, type: h.type, description: h.description || "" })}>
                {t({ ar: "تعديل", en: "Edit" })}
              </button>
              <button type="button" className="text-stone-500 hover:text-red-400 underline text-[11px]"
                onClick={() => setDel(del?.id === h.id ? null : { id: h.id, reason: "" })}>
                {t({ ar: "حذف", en: "Delete" })}
              </button>
              {del?.id === h.id && (
                <div className="w-full flex gap-2 flex-wrap items-center mt-1">
                  <input value={del.reason} onChange={(e) => setDel({ id: h.id, reason: e.target.value })}
                    placeholder={t({ ar: "سبب الحذف (إلزامي)", en: "Reason (required)" })} className={inp + " flex-1 min-w-[160px]"} style={{ width: "auto" }} />
                  <button type="button" disabled={busy} onClick={() => void doDelete(h)} className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-[11px] px-3 py-1.5 disabled:opacity-50">
                    {t({ ar: "تأكيد", en: "Confirm" })}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

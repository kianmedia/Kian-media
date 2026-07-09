"use client";
// ════════════════════════════════════════════════════════════════════════
// أجهزة الحضور (owner/manager/hr) — بنية فقط، لا ربط فعلي بأي جهاز/خدمة:
// قائمة الأجهزة (EZVIZ Y2000 pending افتراضيًا)، إضافة/تعديل جهاز، ربط معرف
// كرت/مستخدم بموظف، استيراد حدث يدوي، ومعالجة الأحداث المعلقة. المعالجة تُحوّل
// الحدث إلى حضور/انصراف فقط عند device_attendance_enabled=true — وإلا توثيق فقط.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  hrListDevices, hrListDeviceUsers, hrListDeviceEvents,
  hrAdminUpsertDevice, hrAdminMapDeviceUser, hrAdminImportDeviceEvent, hrAdminProcessDeviceEvent,
  emitHrEvent,
  type HrDevice, type HrDeviceUser, type HrDeviceEvent, type HrEmployee,
  type DeviceType, type DeviceConnectionMode, type DeviceEventType, type DeviceEventStatus,
  type HrSettings,
} from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const chip = (cls: string) => `inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${cls}`;

const TYPE_LABELS: Record<DeviceType, string> = {
  smart_lock: "قفل ذكي", biometric: "بصمة", nfc_reader: "قارئ NFC",
  qr_station: "محطة QR", manual_import: "استيراد يدوي", other: "أخرى",
};
const MODE_LABELS: Record<DeviceConnectionMode, string> = {
  pending: "بانتظار الربط", manual: "يدوي", csv: "CSV", webhook: "Webhook", api: "API",
};
const EVENT_LABELS: Record<DeviceEventType, string> = {
  unlock: "فتح قفل", check_in: "حضور", check_out: "انصراف", unknown: "غير محدد",
};
const STATUS_LABELS: Record<DeviceEventStatus, string> = {
  pending: "معلّق", processed: "مُعالج", ignored: "متجاهَل", failed: "فشل",
};

const fmtDT = (iso: string | null, isAr: boolean) =>
  iso ? new Date(iso).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function HrDevices({ employees, settings, busy, setBusy, flash }: {
  employees: HrEmployee[]; settings: HrSettings;
  busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void;
}) {
  const { t, isAr } = useI18n();
  const [devices, setDevices] = useState<HrDevice[]>([]);
  const [mappings, setMappings] = useState<HrDeviceUser[]>([]);
  const [events, setEvents] = useState<HrDeviceEvent[]>([]);
  const [evFilter, setEvFilter] = useState<DeviceEventStatus | "">("pending");

  const reload = useCallback(async () => {
    const [d, m, ev] = await Promise.all([
      hrListDevices(), hrListDeviceUsers(), hrListDeviceEvents(evFilter || undefined),
    ]);
    if (d.ok) setDevices(d.data);
    if (m.ok) setMappings(m.data);
    if (ev.ok) setEvents(ev.data);
  }, [evFilter]);
  useEffect(() => { void reload(); }, [reload]);

  const empName = (employeeId: string | null) =>
    employees.find((e) => e.id === employeeId)?.full_name || "—";
  const devName = (deviceId: string) => devices.find((d) => d.id === deviceId)?.name || "—";

  // ─── جهاز: إضافة/تعديل ───
  const emptyDev = { id: "", name: "", type: "smart_lock" as DeviceType, brand: "", model: "", location: "", mode: "pending" as DeviceConnectionMode, active: true, notes: "" };
  const [df, setDf] = useState(emptyDev);
  async function saveDevice() {
    if (!df.name.trim()) { flash(t({ ar: "اسم الجهاز مطلوب.", en: "Device name required." })); return; }
    setBusy(true);
    const r = await hrAdminUpsertDevice({
      id: df.id || null, name: df.name.trim(), type: df.type, brand: df.brand.trim() || undefined,
      model: df.model.trim() || undefined, location: df.location.trim() || undefined,
      mode: df.mode, active: df.active, notes: df.notes.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر حفظ الجهاز: ", en: "Couldn't save device: " }) + r.error); return; }
    setDf(emptyDev);
    await reload();
    flash(t({ ar: "حُفظ الجهاز.", en: "Device saved." }));
  }

  // ─── ربط معرف بموظف ───
  const emptyMap = { deviceId: "", employeeId: "", identifier: "", cardId: "" };
  const [mf, setMf] = useState(emptyMap);
  async function saveMapping() {
    if (!mf.deviceId || !mf.employeeId || !mf.identifier.trim()) {
      flash(t({ ar: "اختر الجهاز والموظف واكتب المعرف.", en: "Pick device, employee and identifier." })); return;
    }
    setBusy(true);
    const r = await hrAdminMapDeviceUser({
      deviceId: mf.deviceId, employeeId: mf.employeeId,
      identifier: mf.identifier.trim(), cardId: mf.cardId.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر الربط: ", en: "Couldn't map: " }) + r.error); return; }
    const emp = employees.find((e) => e.id === mf.employeeId);
    emitHrEvent({
      event: "hr_device_user_mapped", entity_id: r.data.id,
      title: `ربط جهاز حضور: ${emp?.full_name || ""} — المعرف ${mf.identifier.trim()}`,
      employee_name: emp?.full_name || "",
    });
    setMf(emptyMap);
    await reload();
    flash(t({ ar: "رُبط المعرف بالموظف.", en: "Mapped." }));
  }

  // ─── استيراد حدث يدوي ───
  const emptyEv = { deviceId: "", identifier: "", eventType: "check_in" as DeviceEventType, time: "", note: "" };
  const [ef, setEf] = useState(emptyEv);
  async function importEvent() {
    if (!ef.deviceId || !ef.identifier.trim() || !ef.time) {
      flash(t({ ar: "اختر الجهاز واكتب المعرف ووقت الحدث.", en: "Device, identifier and time required." })); return;
    }
    setBusy(true);
    const r = await hrAdminImportDeviceEvent({
      deviceId: ef.deviceId, identifier: ef.identifier.trim(),
      eventType: ef.eventType, eventTime: new Date(ef.time).toISOString(),
      note: ef.note.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      const msg = /manual_import_disabled/.test(r.error)
        ? t({ ar: "الاستيراد اليدوي موقوف من الإعدادات.", en: "Manual import is disabled." })
        : /event_time_in_future/.test(r.error)
        ? t({ ar: "وقت الحدث في المستقبل — تحقق منه.", en: "Event time is in the future." })
        : t({ ar: "تعذّر الاستيراد: ", en: "Import failed: " }) + r.error;
      flash(msg); return;
    }
    emitHrEvent({ event: "hr_device_event_imported", entity_id: r.data.id, title: `استيراد حدث جهاز (${EVENT_LABELS[ef.eventType]})` });
    if (!r.data.matched) {
      emitHrEvent({ event: "hr_device_event_unmatched", entity_id: r.data.id, title: `معرف غير مربوط: ${ef.identifier.trim()}` });
    }
    setEf(emptyEv);
    await reload();
    flash(r.data.matched
      ? t({ ar: "أُستورد الحدث وتم التعرف على الموظف — جاهز للمعالجة.", en: "Imported & matched — ready to process." })
      : t({ ar: "أُستورد الحدث لكن المعرف غير مربوط بموظف — اربطه ثم عالج.", en: "Imported but unmatched — map the identifier first." }));
  }

  // ─── معالجة حدث ───
  async function processEvent(ev: HrDeviceEvent) {
    if (busy) return;
    setBusy(true);
    const r = await hrAdminProcessDeviceEvent(ev.id);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّرت المعالجة: ", en: "Processing failed: " }) + r.error); return; }
    if (!r.data.matched) {
      emitHrEvent({ event: "hr_device_event_unmatched", entity_id: ev.id, title: `معرف غير مربوط: ${ev.device_user_identifier || ""}` });
      flash(t({ ar: "لم يُتعرف على الموظف — اربط المعرف أولاً (بقي الحدث معلّقًا).", en: "Unmatched — map the identifier first." }));
    } else {
      emitHrEvent({
        event: "hr_device_event_processed", entity_id: ev.id,
        title: `معالجة حدث جهاز: ${r.data.status}${r.data.action ? " — " + (r.data.action === "check_in" ? "حضور" : "انصراف") : ""}`,
      });
      flash(r.data.status === "processed"
        ? (r.data.action
            ? t({ ar: `عولج الحدث → ${r.data.action === "check_in" ? "تسجيل حضور" : "تسجيل انصراف"}.`, en: "Processed → attendance updated." })
            : t({ ar: "عولج الحدث (توثيق فقط — تحويل الأجهزة للحضور موقوف).", en: "Processed (log only — device attendance disabled)." }))
        : t({ ar: `تُجوهل الحدث: ${r.data.reason || ""}`, en: `Ignored: ${r.data.reason || ""}` }));
    }
    await reload();
  }

  return (
    <div className="space-y-4">
      {!settings.device_attendance_enabled && (
        <p className="text-[11px] text-amber-300/90 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2">
          {t({ ar: "تحويل أحداث الأجهزة إلى حضور/انصراف موقوف حاليًا (الإعدادات) — المعالجة ستوثّق الأحداث فقط.",
               en: "Device→attendance conversion is OFF — processing only logs events." })}
        </p>
      )}

      {/* ═══ الأجهزة ═══ */}
      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">
          {t({ ar: "الأجهزة", en: "Devices" })} ({devices.length})
        </h3>
        <div className="space-y-1.5 mb-4">
          {devices.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا أجهزة بعد — شغّل SQL v3 أولًا.", en: "No devices yet." })}</p>}
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-2 flex-wrap bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-xs">
              <span className="text-stone-100 font-medium">{d.name}</span>
              <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{TYPE_LABELS[d.device_type] ?? d.device_type}</span>
              <span className={chip(d.connection_mode === "pending" ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-stone-800 text-stone-300 border-stone-700")}>
                {MODE_LABELS[d.connection_mode] ?? d.connection_mode}
              </span>
              {!d.is_active && <span className={chip("bg-stone-800 text-stone-500 border-stone-700")}>{t({ ar: "معطّل", en: "Inactive" })}</span>}
              {(d.brand || d.model) && <span className="text-stone-500 font-mono" dir="ltr">{[d.brand, d.model].filter(Boolean).join(" ")}</span>}
              {d.location_name && <span className="text-stone-500">📍 {d.location_name}</span>}
              <button type="button" className="ms-auto text-red-300 underline text-[11px]"
                onClick={() => setDf({ id: d.id, name: d.name, type: d.device_type, brand: d.brand || "", model: d.model || "", location: d.location_name || "", mode: d.connection_mode, active: d.is_active, notes: d.notes || "" })}>
                {t({ ar: "تعديل", en: "Edit" })}
              </button>
            </div>
          ))}
        </div>
        <h4 className="text-xs font-medium text-stone-300 mb-2">{df.id ? t({ ar: "تعديل جهاز", en: "Edit device" }) : t({ ar: "إضافة جهاز", en: "Add device" })}</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <input value={df.name} onChange={(e) => setDf({ ...df, name: e.target.value })} placeholder={t({ ar: "اسم الجهاز *", en: "Name *" })} className={inp} />
          <select value={df.type} onChange={(e) => setDf({ ...df, type: e.target.value as DeviceType })} className={inp}>
            {(Object.keys(TYPE_LABELS) as DeviceType[]).map((k) => <option key={k} value={k}>{TYPE_LABELS[k]}</option>)}
          </select>
          <select value={df.mode} onChange={(e) => setDf({ ...df, mode: e.target.value as DeviceConnectionMode })} className={inp}>
            {(Object.keys(MODE_LABELS) as DeviceConnectionMode[]).map((k) => <option key={k} value={k}>{MODE_LABELS[k]}</option>)}
          </select>
          <input value={df.brand} onChange={(e) => setDf({ ...df, brand: e.target.value })} placeholder={t({ ar: "الماركة (EZVIZ…)", en: "Brand" })} dir="ltr" className={inp} />
          <input value={df.model} onChange={(e) => setDf({ ...df, model: e.target.value })} placeholder={t({ ar: "الموديل (Y2000…)", en: "Model" })} dir="ltr" className={inp} />
          <input value={df.location} onChange={(e) => setDf({ ...df, location: e.target.value })} placeholder={t({ ar: "الموقع (الباب الرئيسي…)", en: "Location" })} className={inp} />
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-2">
          <label className="flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer">
            <input type="checkbox" checked={df.active} onChange={(e) => setDf({ ...df, active: e.target.checked })} className="accent-red-600" />
            {t({ ar: "فعّال", en: "Active" })}
          </label>
          <input value={df.notes} onChange={(e) => setDf({ ...df, notes: e.target.value })} placeholder={t({ ar: "ملاحظات", en: "Notes" })} className={inp + " flex-1 min-w-[180px]"} style={{ width: "auto" }} />
          <button type="button" disabled={busy} onClick={() => void saveDevice()} className={`${btnRed} px-5 py-2`}>{t({ ar: "حفظ", en: "Save" })}</button>
          {df.id && <button type="button" onClick={() => setDf(emptyDev)} className={`${btnGhost} px-3 py-2`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>}
        </div>
      </section>

      {/* ═══ ربط معرف بموظف ═══ */}
      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">{t({ ar: "ربط معرف كرت/جهاز بموظف", en: "Map device user to employee" })}</h3>
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={mf.deviceId} onChange={(e) => setMf({ ...mf, deviceId: e.target.value })} className={inp}>
            <option value="">{t({ ar: "— الجهاز —", en: "— Device —" })}</option>
            {devices.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={mf.employeeId} onChange={(e) => setMf({ ...mf, employeeId: e.target.value })} className={inp}>
            <option value="">{t({ ar: "— الموظف —", en: "— Employee —" })}</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
          <input value={mf.identifier} onChange={(e) => setMf({ ...mf, identifier: e.target.value })} placeholder={t({ ar: "معرف المستخدم في الجهاز *", en: "Device user ID *" })} dir="ltr" className={inp} />
          <input value={mf.cardId} onChange={(e) => setMf({ ...mf, cardId: e.target.value })} placeholder={t({ ar: "رقم الكرت/NFC (اختياري)", en: "Card/NFC (optional)" })} dir="ltr" className={inp} />
        </div>
        <button type="button" disabled={busy} onClick={() => void saveMapping()} className={`${btnRed} mt-2 px-5 py-2`}>{t({ ar: "ربط", en: "Map" })}</button>
        {mappings.length > 0 && (
          <div className="mt-3 space-y-1">
            {mappings.slice(0, 20).map((m) => (
              <div key={m.id} className="text-[11px] text-stone-400 flex gap-2 flex-wrap border-t border-stone-800 pt-1">
                <span className="text-stone-200">{empName(m.employee_id)}</span>
                <span className="font-mono" dir="ltr">{m.device_user_identifier}</span>
                {m.card_id && <span className="font-mono text-stone-500" dir="ltr">💳 {m.card_id}</span>}
                <span className="text-stone-500">{devName(m.device_id)}</span>
                {!m.is_active && <span className="text-stone-600">({t({ ar: "معطّل", en: "inactive" })})</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══ إدخال حدث يدوي ═══ */}
      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">{t({ ar: "إدخال حدث جهاز يدويًا", en: "Manual device event" })}</h3>
        {!settings.manual_device_import_enabled && (
          <p className="text-[11px] text-amber-400 mb-2">{t({ ar: "الاستيراد اليدوي موقوف من الإعدادات.", en: "Manual import is disabled." })}</p>
        )}
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={ef.deviceId} onChange={(e) => setEf({ ...ef, deviceId: e.target.value })} className={inp}>
            <option value="">{t({ ar: "— الجهاز —", en: "— Device —" })}</option>
            {devices.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input value={ef.identifier} onChange={(e) => setEf({ ...ef, identifier: e.target.value })} placeholder={t({ ar: "معرف المستخدم/الكرت *", en: "User/card ID *" })} dir="ltr" className={inp} />
          <select value={ef.eventType} onChange={(e) => setEf({ ...ef, eventType: e.target.value as DeviceEventType })} className={inp}>
            {(Object.keys(EVENT_LABELS) as DeviceEventType[]).map((k) => <option key={k} value={k}>{EVENT_LABELS[k]}</option>)}
          </select>
          <input type="datetime-local" value={ef.time} onChange={(e) => setEf({ ...ef, time: e.target.value })} className={inp} dir="ltr" />
        </div>
        <div className="flex gap-2 mt-2">
          <input value={ef.note} onChange={(e) => setEf({ ...ef, note: e.target.value })} placeholder={t({ ar: "ملاحظة (اختياري)", en: "Note" })} className={inp + " flex-1"} style={{ width: "auto" }} />
          <button type="button" disabled={busy || !settings.manual_device_import_enabled} onClick={() => void importEvent()} className={`${btnRed} px-5 py-2`}>
            {t({ ar: "استيراد", en: "Import" })}
          </button>
        </div>
      </section>

      {/* ═══ أحداث الأجهزة ═══ */}
      <section className={card}>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="text-sm font-medium text-stone-100">{t({ ar: "أحداث الأجهزة", en: "Device events" })}</h3>
          <select value={evFilter} onChange={(e) => setEvFilter(e.target.value as DeviceEventStatus | "")} className={inp + " ms-auto"} style={{ width: "auto" }}>
            <option value="">{t({ ar: "— كل الحالات —", en: "— All —" })}</option>
            {(Object.keys(STATUS_LABELS) as DeviceEventStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABELS[k]}</option>)}
          </select>
        </div>
        {events.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا أحداث.", en: "No events." })}</p>}
        <div className="space-y-1.5">
          {events.map((ev) => (
            <div key={ev.id} className="flex items-center gap-2 flex-wrap bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-xs">
              <span className="text-stone-300">{devName(ev.device_id)}</span>
              <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
              <span className="font-mono text-stone-500" dir="ltr">{ev.device_user_identifier || "—"}</span>
              <span className="text-stone-200">{ev.employee_id ? empName(ev.employee_id) : t({ ar: "غير مربوط", en: "unmatched" })}</span>
              <span className="font-mono text-stone-500" dir="ltr">{fmtDT(ev.event_time, isAr)}</span>
              <span className={chip(
                ev.processed_status === "processed" ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                : ev.processed_status === "pending" ? "bg-amber-950 text-amber-300 border-amber-800"
                : "bg-stone-800 text-stone-400 border-stone-700")}>
                {STATUS_LABELS[ev.processed_status] ?? ev.processed_status}
              </span>
              {ev.error_message && <span className="text-[10px] text-amber-400 font-mono" dir="ltr">{ev.error_message}</span>}
              {ev.processed_status === "pending" && (
                <button type="button" disabled={busy} onClick={() => void processEvent(ev)} className="ms-auto text-red-300 underline">
                  {t({ ar: "معالجة", en: "Process" })}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

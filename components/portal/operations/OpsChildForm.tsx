"use client";
// ════════════════════════════════════════════════════════════════════════════
// OpsChildForm — محرّر عامّ لأبناء المهمّة (طاقم/معدّات/تصاريح/سفر/…).
//
// لماذا محرّر واحد لا أربعة عشر: الحقول تختلف، والسلوك واحد تمامًا — نموذج
// يُرسل الصفّ كاملًا إلى prodops_child_upsert. تكرار المكوّن أربع عشرة مرّة
// كان سينتج أربعة عشر موضعًا يمكن أن يُنسى فيها زرّ «حفظ» أو رسالة خطأ.
//
// المواصفة (FIELDS) تعكس القائمة البيضاء على الخادم؛ حقل غير مذكور هناك لا
// يُكتب مهما أُرسل، فالواجهة لا تفتح بابًا لا يفتحه الخادم.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  opsChildUpsert, opsChildDelete, type OpsChildKind, type OpsLookups,
  CREW_ROLE_AR, CREW_STATUS_AR, PERMIT_STATUS_AR, EQUIP_STATUS_AR, HSE_STATUS_AR,
} from "@/lib/portal/opsCenter";
import { btnGhost, btnPrimary, fieldCls, Flash } from "./OpsAtoms";

type FieldType = "text" | "num" | "date" | "datetime" | "select" | "textarea" | "bool";
interface Field { k: string; ar: string; type: FieldType; opts?: { v: string; ar: string }[]; lookup?: "people" | "assets" | "locations" | "vehicles" | "professions" }

const opt = (m: Record<string, string>) => Object.entries(m).map(([v, ar]) => ({ v, ar }));

export const FIELDS: Record<OpsChildKind, { ar: string; fields: Field[] }> = {
  crew: {
    ar: "فرد طاقم",
    fields: [
      { k: "user_id", ar: "الموظّف", type: "select", lookup: "people" },
      { k: "external_name", ar: "اسم خارجيّ (فريلانس)", type: "text" },
      { k: "external_phone", ar: "جوّال", type: "text" },
      { k: "profession_id", ar: "المهنة", type: "select", lookup: "professions" },
      { k: "crew_role", ar: "الدور", type: "select", opts: opt(CREW_ROLE_AR) },
      { k: "call_time", ar: "وقت الحضور", type: "datetime" },
      { k: "wrap_time", ar: "وقت الانصراف", type: "datetime" },
      { k: "status", ar: "الحالة", type: "select", opts: opt(CREW_STATUS_AR) },
      { k: "notes", ar: "ملاحظات (للإدارة)", type: "textarea" },
    ],
  },
  equipment: {
    ar: "معدّة",
    fields: [
      { k: "asset_id", ar: "الأصل من المخزون", type: "select", lookup: "assets" },
      { k: "asset_label", ar: "اسم حرّ (إن لم يكن في المخزون)", type: "text" },
      { k: "quantity", ar: "الكمية", type: "num" },
      { k: "needed_from", ar: "مطلوبة من", type: "datetime" },
      { k: "needed_to", ar: "حتى", type: "datetime" },
      { k: "status", ar: "الحالة", type: "select", opts: opt(EQUIP_STATUS_AR) },
      { k: "custody_reservation_id", ar: "رقم حجز المخزون (مرجع)", type: "text" },
      { k: "custody_assignment_id", ar: "رقم تسليم العهدة (مرجع)", type: "text" },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  permit: {
    ar: "تصريح",
    fields: [
      { k: "permit_type", ar: "النوع", type: "select", opts: [
        { v: "municipality", ar: "أمانة/بلدية" }, { v: "police", ar: "شرطة" },
        { v: "property_owner", ar: "مالك العقار" }, { v: "airspace_drone", ar: "مجال جوّي (درون)" },
        { v: "client_site", ar: "موقع العميل" }, { v: "venue", ar: "قاعة/مكان" }, { v: "other", ar: "أخرى" }] },
      { k: "authority_name", ar: "الجهة", type: "text" },
      { k: "reference_no", ar: "رقم المرجع", type: "text" },
      { k: "status", ar: "الحالة", type: "select", opts: opt(PERMIT_STATUS_AR) },
      { k: "requested_at", ar: "تاريخ الطلب", type: "date" },
      { k: "issued_at", ar: "تاريخ الإصدار", type: "date" },
      { k: "expires_at", ar: "تاريخ الانتهاء", type: "date" },
      { k: "document_url", ar: "رابط المستند", type: "text" },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  travel: {
    ar: "سفر",
    fields: [
      { k: "mode", ar: "الوسيلة", type: "select", opts: [
        { v: "car", ar: "سيارة" }, { v: "plane", ar: "طائرة" }, { v: "bus", ar: "حافلة" },
        { v: "train", ar: "قطار" }, { v: "boat", ar: "قارب" }, { v: "other", ar: "أخرى" }] },
      { k: "from_place", ar: "من", type: "text" },
      { k: "to_place", ar: "إلى", type: "text" },
      { k: "depart_at", ar: "المغادرة", type: "datetime" },
      { k: "arrive_at", ar: "الوصول", type: "datetime" },
      { k: "traveller_user_id", ar: "المسافر", type: "select", lookup: "people" },
      { k: "traveller_name", ar: "اسم المسافر (حرّ)", type: "text" },
      { k: "booking_ref", ar: "رقم الحجز", type: "text" },
      { k: "status", ar: "الحالة", type: "select", opts: [
        { v: "planned", ar: "مخطّط" }, { v: "booked", ar: "محجوز" },
        { v: "completed", ar: "منتهٍ" }, { v: "cancelled", ar: "ملغى" }] },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  accommodation: {
    ar: "سكن",
    fields: [
      { k: "hotel_name", ar: "الفندق", type: "text" },
      { k: "city", ar: "المدينة", type: "text" },
      { k: "check_in", ar: "الدخول", type: "date" },
      { k: "check_out", ar: "الخروج", type: "date" },
      { k: "rooms", ar: "عدد الغرف", type: "num" },
      { k: "booking_ref", ar: "رقم الحجز", type: "text" },
      { k: "status", ar: "الحالة", type: "select", opts: [
        { v: "planned", ar: "مخطّط" }, { v: "booked", ar: "محجوز" },
        { v: "completed", ar: "منتهٍ" }, { v: "cancelled", ar: "ملغى" }] },
      { k: "guest_note", ar: "النزلاء", type: "textarea" },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  vehicle_assignment: {
    ar: "مركبة",
    fields: [
      { k: "vehicle_id", ar: "المركبة", type: "select", lookup: "vehicles" },
      { k: "vehicle_label", ar: "اسم حرّ", type: "text" },
      { k: "driver_user_id", ar: "السائق (موظّف)", type: "select", lookup: "people" },
      { k: "driver_name", ar: "اسم السائق (حرّ)", type: "text" },
      { k: "depart_at", ar: "المغادرة", type: "datetime" },
      { k: "return_at", ar: "العودة", type: "datetime" },
      { k: "status", ar: "الحالة", type: "select", opts: [
        { v: "planned", ar: "مخطّط" }, { v: "assigned", ar: "مُسنَد" },
        { v: "completed", ar: "منتهٍ" }, { v: "cancelled", ar: "ملغى" }] },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  hse: {
    ar: "بند سلامة",
    fields: [
      { k: "item_key", ar: "المفتاح", type: "text" },
      { k: "item_ar", ar: "البند", type: "text" },
      { k: "is_required", ar: "إلزاميّ", type: "bool" },
      { k: "status", ar: "الحالة", type: "select", opts: opt(HSE_STATUS_AR) },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  weather: {
    ar: "طقس (إدخال يدويّ)",
    fields: [
      { k: "for_date", ar: "التاريخ", type: "date" },
      { k: "condition", ar: "الحالة الجوّية", type: "text" },
      { k: "temp_c", ar: "الحرارة °م", type: "num" },
      { k: "wind_kph", ar: "الرياح كم/س", type: "num" },
      { k: "precip_pct", ar: "احتمال المطر %", type: "num" },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  media_card: {
    ar: "بطاقة ذاكرة",
    fields: [
      { k: "card_label", ar: "رمز البطاقة", type: "text" },
      { k: "card_type", ar: "النوع", type: "select", opts: [
        { v: "sd", ar: "SD" }, { v: "microsd", ar: "microSD" }, { v: "cfexpress", ar: "CFexpress" },
        { v: "cfast", ar: "CFast" }, { v: "ssd", ar: "SSD" }, { v: "other", ar: "أخرى" }] },
      { k: "capacity_gb", ar: "السعة GB", type: "num" },
      { k: "holder_user_id", ar: "بحوزة", type: "select", lookup: "people" },
      { k: "holder_name", ar: "بحوزة (اسم حرّ)", type: "text" },
      { k: "status", ar: "الحالة", type: "select", opts: [
        { v: "assigned", ar: "مُسلَّمة" }, { v: "recording", ar: "قيد التصوير" },
        { v: "full", ar: "ممتلئة" }, { v: "offloaded", ar: "مُفرَّغة" },
        { v: "verified", ar: "مُتحقَّق منها" }, { v: "formatted", ar: "مُهيّأة" },
        { v: "lost", ar: "مفقودة" }] },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  ingest: {
    ar: "رفع/استيعاب",
    fields: [
      { k: "target", ar: "الوجهة", type: "select", opts: [
        { v: "nas", ar: "NAS" }, { v: "cloud", ar: "سحابة" }, { v: "drive", ar: "قرص" },
        { v: "editing_station", ar: "محطّة مونتاج" }, { v: "other", ar: "أخرى" }] },
      { k: "status", ar: "الحالة", type: "select", opts: [
        { v: "not_started", ar: "لم يبدأ" }, { v: "uploading", ar: "جارٍ الرفع" },
        { v: "uploaded", ar: "مرفوع" }, { v: "failed", ar: "فشل" }, { v: "verified", ar: "مُتحقَّق" }] },
      { k: "started_at", ar: "البدء", type: "datetime" },
      { k: "finished_at", ar: "الانتهاء", type: "datetime" },
      { k: "total_gb", ar: "الحجم GB", type: "num" },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  post_handoff: {
    ar: "تسليم لما بعد الإنتاج",
    fields: [
      { k: "handed_to_user_id", ar: "المونتير", type: "select", lookup: "people" },
      { k: "handed_to_name", ar: "اسم حرّ", type: "text" },
      { k: "expected_delivery", ar: "التسليم المتوقّع", type: "date" },
      { k: "brief_url", ar: "رابط البريف", type: "text" },
      { k: "brief", ar: "البريف", type: "textarea" },
    ],
  },
  incident: {
    ar: "حادث",
    fields: [
      { k: "incident_type", ar: "النوع", type: "select", opts: [
        { v: "injury", ar: "إصابة" }, { v: "equipment_damage", ar: "تلف معدّة" },
        { v: "equipment_loss", ar: "فقد معدّة" }, { v: "access_denied", ar: "منع دخول" },
        { v: "public_complaint", ar: "شكوى عامّة" }, { v: "vehicle", ar: "مركبة" },
        { v: "weather", ar: "طقس" }, { v: "security", ar: "أمن" }, { v: "other", ar: "أخرى" }] },
      { k: "severity", ar: "الخطورة", type: "select", opts: [
        { v: "low", ar: "منخفضة" }, { v: "medium", ar: "متوسّطة" },
        { v: "high", ar: "عالية" }, { v: "critical", ar: "حرجة" }] },
      { k: "occurred_at", ar: "وقت الحدوث", type: "datetime" },
      { k: "description", ar: "الوصف", type: "textarea" },
      { k: "immediate_action", ar: "الإجراء الفوريّ", type: "textarea" },
      { k: "status", ar: "الحالة", type: "select", opts: [
        { v: "open", ar: "مفتوح" }, { v: "investigating", ar: "قيد الفحص" },
        { v: "resolved", ar: "مُعالَج" }, { v: "closed", ar: "مغلق" }] },
      { k: "resolution", ar: "المعالجة", type: "textarea" },
    ],
  },
  delay: {
    ar: "تأخير",
    fields: [
      { k: "delay_reason", ar: "السبب", type: "select", opts: [
        { v: "weather", ar: "طقس" }, { v: "permit", ar: "تصريح" }, { v: "crew_late", ar: "تأخّر طاقم" },
        { v: "equipment_failure", ar: "عطل معدّة" }, { v: "client", ar: "العميل" },
        { v: "location_access", ar: "دخول الموقع" }, { v: "traffic", ar: "مرور" },
        { v: "technical", ar: "تقنيّ" }, { v: "talent", ar: "المتحدّث/الممثّل" }, { v: "other", ar: "أخرى" }] },
      { k: "minutes_lost", ar: "الدقائق المفقودة", type: "num" },
      { k: "occurred_at", ar: "وقت الحدوث", type: "datetime" },
      { k: "note", ar: "ملاحظة", type: "textarea" },
    ],
  },
  call_sheet: {
    ar: "Call Sheet",
    fields: [
      { k: "sheet_date", ar: "التاريخ", type: "date" },
      { k: "version", ar: "النسخة", type: "num" },
      { k: "general_call_time", ar: "وقت الحضور العامّ", type: "datetime" },
      { k: "location_id", ar: "الموقع", type: "select", lookup: "locations" },
      { k: "weather_note", ar: "ملاحظة الطقس", type: "text" },
      { k: "hospital_name", ar: "أقرب مستشفى", type: "text" },
      { k: "hospital_address", ar: "عنوان المستشفى", type: "text" },
      { k: "emergency_contact_name", ar: "مسؤول الطوارئ", type: "text" },
      { k: "emergency_contact_phone", ar: "جوّال الطوارئ", type: "text" },
      { k: "parking_note", ar: "المواقف", type: "text" },
      { k: "notes", ar: "ملاحظات", type: "textarea" },
    ],
  },
};

function lookupOptions(lk: Field["lookup"], L: OpsLookups | null): { v: string; ar: string }[] {
  if (!L || !lk) return [];
  if (lk === "people") return L.people.map((p) => ({ v: p.user_id, ar: p.name + (p.job_title ? ` — ${p.job_title}` : "") }));
  if (lk === "assets") return L.assets.map((a) => ({ v: a.id, ar: `${a.name} (${a.code})` }));
  if (lk === "locations") return L.locations.map((l) => ({ v: l.id, ar: l.name }));
  if (lk === "vehicles") return L.vehicles.map((v) => ({ v: v.id, ar: v.label }));
  if (lk === "professions") return L.professions.map((p) => ({ v: p.id, ar: p.name_ar || p.key }));
  return [];
}

/** timestamptz → القيمة التي يقبلها <input type="datetime-local"> (محلّي). */
function toLocalInput(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OpsChildForm({
  kind, jobId, row, lookups, onDone, onCancel,
}: {
  kind: OpsChildKind;
  jobId: string;
  row?: Record<string, unknown> | null;
  lookups: OpsLookups | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const spec = FIELDS[kind];
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of spec.fields) {
      const raw = row?.[f.k];
      if (raw === null || raw === undefined) { o[f.k] = ""; continue; }
      o[f.k] = f.type === "datetime" ? toLocalInput(raw) : String(raw);
    }
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ t: string; tone: "ok" | "bad" }>({ t: "", tone: "ok" });
  const id = typeof row?.id === "string" ? row.id : null;

  const save = async () => {
    setBusy(true); setFlash({ t: "", tone: "ok" });
    const payload: Record<string, unknown> = { job_id: jobId };
    if (id) payload.id = id;
    for (const f of spec.fields) {
      const v = vals[f.k] ?? "";
      if (f.type === "bool") { payload[f.k] = v === "true"; continue; }
      payload[f.k] = v === "" ? null : v;
    }
    const r = await opsChildUpsert(kind, payload);
    setBusy(false);
    if (r.state === "ok") { onDone(); return; }
    setFlash({ t: r.message, tone: "bad" });
  };

  const remove = async () => {
    if (!id) return;
    const reason = window.prompt("سبب الحذف (٣ أحرف على الأقلّ):", "");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const r = await opsChildDelete(kind, id, reason.trim());
    setBusy(false);
    if (r.state === "ok") { onDone(); return; }
    setFlash({ t: r.message, tone: "bad" });
  };

  return (
    <div className="bg-stone-950 border border-stone-700 rounded-xl p-4 space-y-3">
      <h4 className="text-sm text-stone-100">{id ? `تعديل ${spec.ar}` : `إضافة ${spec.ar}`}</h4>
      {kind === "weather" && (
        <p className="text-[11px] text-stone-500 leading-5">
          إدخال يدويّ فقط — النظام لا يتّصل بأيّ خدمة طقس خارجية، ولا يدّعي ذلك.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {spec.fields.map((f) => {
          const opts = f.lookup ? lookupOptions(f.lookup, lookups) : f.opts ?? [];
          return (
            <label key={f.k} className="block">
              <span className="block text-[11px] text-stone-400 mb-1">{f.ar}</span>
              {f.type === "textarea" ? (
                <textarea
                  className={`${fieldCls} min-h-[76px]`} rows={3}
                  value={vals[f.k] ?? ""}
                  onChange={(e) => setVals((s) => ({ ...s, [f.k]: e.target.value }))}
                />
              ) : f.type === "select" || f.type === "bool" ? (
                <select
                  className={fieldCls}
                  value={vals[f.k] ?? ""}
                  onChange={(e) => setVals((s) => ({ ...s, [f.k]: e.target.value }))}
                >
                  <option value="">—</option>
                  {(f.type === "bool" ? [{ v: "true", ar: "نعم" }, { v: "false", ar: "لا" }] : opts).map((o) => (
                    <option key={o.v} value={o.v}>{o.ar}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={fieldCls}
                  type={f.type === "num" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
                  value={vals[f.k] ?? ""}
                  onChange={(e) => setVals((s) => ({ ...s, [f.k]: e.target.value }))}
                />
              )}
            </label>
          );
        })}
      </div>
      <Flash text={flash.t} tone={flash.tone} />
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "…" : "حفظ"}
        </button>
        <button className={btnGhost} disabled={busy} onClick={onCancel}>إلغاء</button>
        {id && (
          <button className={`${btnGhost} text-red-300`} disabled={busy} onClick={() => void remove()}>
            حذف
          </button>
        )}
      </div>
    </div>
  );
}

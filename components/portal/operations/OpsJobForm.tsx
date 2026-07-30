"use client";
// ════════════════════════════════════════════════════════════════════════════
// OpsJobForm — نموذج أمر العمل: **إنشاء وتعديل بنفس الحقول**.
//
// فُصل عن OpsCenter كي لا يُستورد دائريًّا من OpsJobPanel (الدورة تُخرج المكوّن
// undefined عند العرض في بعض حزم البناء، فتظهر شاشة بيضاء بلا خطأ مفهوم).
//
// ما يُرسَل هنا يُفحص كلّه في القاعدة: الصلاحية في prodops_job_upsert، ومنع
// الحجز المزدوج في مُشغِّل §7B. الحقول أدناه راحة إدخال لا حاجز أمان.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  opsJobUpsert, opsLookups, JOB_TYPE_AR,
  type OpsLookups, type OpsRow,
} from "@/lib/portal/opsCenter";
import { card, btnGhost, btnPrimary, fieldCls, Flash, useOpsLoad } from "./OpsAtoms";


/** حقول أمر العمل القابلة للتحرير — نفس النموذج للإنشاء وللتعديل، كي لا ينحرف
 *  أحدهما عن الآخر ويصير في النظام «إنشاء يقبل حقلًا لا يقبله التعديل». */
const JOB_FORM_KEYS = [
  "title", "job_type", "scheduled_start", "scheduled_end", "location_id",
  "location_note", "client_label", "priority", "owner_user_id", "project_id",
] as const;

/** datetime-local لا يقبل قيمة ISO كاملة بمنطقة زمنية: تُقتطع إلى دقيقة محلّية. */
function toLocalInput(iso: unknown): string {
  if (typeof iso !== "string" || iso === "") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OpsJobForm({ onDone, job }: { onDone: () => void; job?: OpsRow | null }) {
  const { st: lkSt } = useOpsLoad<OpsLookups>(() => opsLookups(), []);
  const lookups = lkSt && lkSt.state === "ok" ? lkSt.data : null;
  const editing = job ? String(job.id ?? "") : "";
  const [f, setF] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {
      title: "", job_type: "filming", scheduled_start: "", scheduled_end: "",
      location_id: "", location_note: "", client_label: "", priority: "normal",
      owner_user_id: "", project_id: "",
    };
    if (!job) return base;
    for (const k of JOB_FORM_KEYS) {
      const v = job[k];
      base[k] = k === "scheduled_start" || k === "scheduled_end"
        ? toLocalInput(v) : v === null || v === undefined ? "" : String(v);
    }
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ t: string; tone: "ok" | "bad" }>({ t: "", tone: "ok" });

  const save = async () => {
    if (f.title.trim().length < 2) { setFlash({ t: "العنوان مطلوب.", tone: "bad" }); return; }
    setBusy(true);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) payload[k] = v === "" ? null : v;
    if (editing) payload.id = editing;
    const r = await opsJobUpsert(payload);
    setBusy(false);
    if (r.state === "ok") onDone();
    // ★ رفض الحجز المزدوج يصل هنا كرسالة الخادم نفسها: لم يُحفَظ شيء.
    else setFlash({ t: r.message, tone: "bad" });
  };

  return (
    <div className={`${card} p-4 space-y-3`}>
      <h3 className="text-sm text-stone-100">{editing ? "تعديل أمر العمل" : "أمر عمل جديد"}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="block text-[11px] text-stone-400 mb-1">العنوان</span>
          <input className={fieldCls} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">النوع</span>
          <select className={fieldCls} value={f.job_type} onChange={(e) => setF((s) => ({ ...s, job_type: e.target.value }))}>
            {Object.entries(JOB_TYPE_AR).map(([v, ar]) => <option key={v} value={v}>{ar}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">الأولوية</span>
          <select className={fieldCls} value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))}>
            <option value="low">منخفضة</option><option value="normal">عادية</option>
            <option value="high">عالية</option><option value="urgent">عاجلة</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">البداية</span>
          <input className={fieldCls} type="datetime-local" value={f.scheduled_start}
            onChange={(e) => setF((s) => ({ ...s, scheduled_start: e.target.value }))} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">النهاية</span>
          <input className={fieldCls} type="datetime-local" value={f.scheduled_end}
            onChange={(e) => setF((s) => ({ ...s, scheduled_end: e.target.value }))} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">الموقع</span>
          <select className={fieldCls} value={f.location_id} onChange={(e) => setF((s) => ({ ...s, location_id: e.target.value }))}>
            <option value="">—</option>
            {(lookups?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">وصف الموقع (حرّ)</span>
          <input className={fieldCls} value={f.location_note}
            onChange={(e) => setF((s) => ({ ...s, location_note: e.target.value }))} />
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-[11px] text-stone-400 mb-1">العميل (نصّ حرّ)</span>
          <input className={fieldCls} value={f.client_label}
            onChange={(e) => setF((s) => ({ ...s, client_label: e.target.value }))} />
        </label>
        {/* مدير العمليّات المسؤول عن أمر العمل — مرجع تشغيليّ، لا يمنح صلاحية.
            الصلاحية تُمنح بمفتاح operations.manage من شاشة الصلاحيات وحدها. */}
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">مدير العمليّات المسؤول</span>
          <select className={fieldCls} value={f.owner_user_id}
            onChange={(e) => setF((s) => ({ ...s, owner_user_id: e.target.value }))}>
            <option value="">—</option>
            {(lookups?.people ?? []).map((p) => (
              <option key={p.user_id} value={p.user_id}>{p.name}</option>
            ))}
          </select>
          <span className="block text-[10px] text-stone-600 mt-1">
            مرجع فقط — لا يمنح صلاحية إدارة المركز.
          </span>
        </label>
        <label className="block">
          <span className="block text-[11px] text-stone-400 mb-1">المشروع المرتبط (اختياريّ)</span>
          <select className={fieldCls} value={f.project_id}
            disabled={lookups?.projects_source === "unavailable"}
            onChange={(e) => setF((s) => ({ ...s, project_id: e.target.value }))}>
            <option value="">— بلا ربط —</option>
            {(lookups?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="block text-[10px] text-stone-600 mt-1">
            {lookups?.projects_source === "unavailable"
              ? "الربط معطّل: جدول المشاريع غير موجود على هذه القاعدة."
              : "عرض فقط — لا يُكتب في المشروع شيء."}
          </span>
        </label>
      </div>
      <Flash text={flash.t} tone={flash.tone} />
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "…" : editing ? "حفظ التعديل" : "إنشاء"}
        </button>
        {editing && <button className={btnGhost} disabled={busy} onClick={onDone}>تراجع</button>}
      </div>
    </div>
  );
}

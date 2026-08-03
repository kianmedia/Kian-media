"use client";
// ════════════════════════════════════════════════════════════════════════════
// OpsPermitsRegistry — سجلّ التصاريح العامّ + وسائط التشغيل.
//
// Wave 3 · V2-3.2-A / V2-3.4-B
//
// ★ لماذا سجلّ منفصل عن تصاريح المهمّة ★
// `ops_job_permits` تصريحٌ **لمهمّة** (`job_id not null`, cascade). رخصة درون
// سنوية على مستوى الشركة لا مكان لها فيه، وحذف المهمّة كان سيحذفها. هذا السجلّ
// للتصاريح التي لها عمر مستقلّ — ويُربط بتصاريح المهامّ لا يستبدلها.
//
// ★ الحالات الأربع كلّها حقيقية هنا ★
// تحميل · خطأ (بإعادة محاولة) · «تحتاج ترحيلة» · فارغ. والفارغ **مقصود**:
// الجدول يُنشأ فارغًا ولا تُخترع تصاريح، فأوّل ما يراه المستخدم هو حالة فارغة
// تشرح ما يفعله — لا شبكة تصاريح وهمية.
//
// ⛔ ولا رابط تخزين دائم: القائمة تحمل bucket+path، والرابط يُوقَّع عند الضغط
//    وينتهي بعد خمس دقائق.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  opsPermitsList, opsMediaList, opsPermitDelete, opsPermitUpsert, opsMediaDelete,
  PERMIT_STATUS_AR, PERMIT_TYPE_AR, PERMIT_SCOPE_AR, permitExpiryTone,
  opsDate,
  type OpsPermitRow, type OpsMediaRow,
} from "@/lib/portal/opsCenter";
import { card, btnGhost, btnPrimary, fieldCls, Chip, Empty, StateView, useOpsLoad } from "./OpsAtoms";

const S = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** نصّ مهلة الانتهاء. العتبات نفس عتبات محرّك التنبيهات (٣٠ · ٧). */
function expiryLabel(d: number | null): string {
  if (d === null) return "بلا تاريخ انتهاء";
  if (d < 0) return `انتهى منذ ${Math.abs(d)} يومًا`;
  if (d === 0) return "ينتهي اليوم";
  return `يتبقّى ${d} يومًا`;
}

// ─── وسائط مالك واحد ────────────────────────────────────────────────────────

function MediaStrip({ ownerKind, ownerId, canManage = false }: { ownerKind: "location" | "permit"; ownerId: string; canManage?: boolean }) {
  const { st, reload } = useOpsLoad<{ ok: boolean; rows: OpsMediaRow[]; can_manage: boolean }>(
    () => opsMediaList(ownerKind, ownerId), [ownerKind, ownerId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function open(m: OpsMediaRow) {
    setBusy(m.id); setErr(null);
    try {
      const { getValidSession } = await import("@/lib/portalAuth");
      const session = await getValidSession();
      if (!session?.access_token) { setErr("انتهت الجلسة."); return; }
      const res = await fetch("/api/portal/ops/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ media_id: m.id, owner_kind: ownerKind, owner_id: ownerId }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (j.ok && j.url) {
        // noopener/noreferrer: الرابط موقَّع، ولا يُسرَّب في Referer.
        window.open(j.url, "_blank", "noopener,noreferrer");
        return;
      }
      setErr(j.error === "needs_migration" ? "تحتاج ترحيلة قاعدة لم تُطبَّق بعد."
           : j.error === "denied" ? "لا تملك صلاحية عرض هذا الملفّ."
           : "تعذّر فتح الملفّ.");
    } catch {
      setErr("لا اتصال بالشبكة.");
    } finally { setBusy(null); }
  }

  // 🔴 فشل الوسائط لا يمنع رؤية التصريح: تُعرض سطرًا صغيرًا ولا تُخفي ما فوقها.
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (
        d.rows.length === 0
          ? <p className="text-[11px] text-stone-500">لا مرفقات.</p>
          : (
            <div className="space-y-1">
              <ul className="flex flex-wrap gap-2">
                {d.rows.map((m) => (
                  <li key={m.id}>
                    <button
                      className={`${btnGhost} text-[11px] px-2 py-1`}
                      onClick={() => open(m)}
                      disabled={busy === m.id}
                      title={m.path}
                    >
                      {busy === m.id ? "جارٍ الفتح…" : (m.caption || m.media_type)}
                    </button>
                    {canManage && d.can_manage && (
                      <button
                        className="text-[11px] text-stone-500 underline ms-1"
                        onClick={async () => {
                          const reason = window.prompt("سبب حذف المرفق (٣ أحرف على الأقل):")?.trim() ?? "";
                          // نفس عقد القاعدة: الحذف إخفاء بسبب مكتوب، لا إزالة صامتة.
                          if (reason.length < 3) { setErr("الحذف يحتاج سببًا مكتوبًا."); return; }
                          const r = await opsMediaDelete(m.id, reason);
                          if (r.state === "ok") reload(); else setErr(r.message);
                        }}
                      >حذف</button>
                    )}
                  </li>
                ))}
              </ul>
              {err && <p className="text-[11px] text-amber-500">{err}</p>}
              <p className="text-[10px] text-stone-600">
                الروابط تُوقَّع عند الفتح وتنتهي خلال ٥ دقائق — لا رابط دائم.
              </p>
            </div>
          )
      )}
    </StateView>
  );
}

// ─── السجلّ ─────────────────────────────────────────────────────────────────

function PermitCard({ p, canManage, onChanged }: { p: OpsPermitRow; canManage: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tone = permitExpiryTone(p.days_left);

  async function remove() {
    const reason = window.prompt("سبب الحذف (٣ أحرف على الأقل):")?.trim() ?? "";
    if (reason.length < 3) { setMsg("الحذف يحتاج سببًا مكتوبًا."); return; }
    const r = await opsPermitDelete(p.id, reason);
    if (r.state === "ok") { onChanged(); return; }
    setMsg(r.message);
  }

  return (
    <li className={`${card} p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] text-stone-100 font-semibold truncate">{p.title}</div>
          <div className="text-[11.5px] text-stone-400">
            {PERMIT_TYPE_AR[p.permit_type] ?? p.permit_type} · {PERMIT_SCOPE_AR[p.scope] ?? p.scope}
            {p.authority_name ? ` · ${p.authority_name}` : ""}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Chip tone={p.status === "approved" ? "good" : p.status === "rejected" || p.status === "revoked" ? "bad" : "neutral"}>
            {PERMIT_STATUS_AR[p.status] ?? p.status}
          </Chip>
          <Chip tone={tone === "bad" ? "bad" : tone === "warn" ? "warn" : "neutral"}>
            {expiryLabel(p.days_left)}
          </Chip>
        </div>
      </div>

      <button className="text-[11.5px] text-stone-400 underline" onClick={() => setOpen((v) => !v)}>
        {open ? "إخفاء التفاصيل" : `التفاصيل${p.media_count > 0 ? ` · ${p.media_count} مرفقًا` : ""}`}
      </button>

      {open && (
        <div className="space-y-1 border-t border-stone-800 pt-2 text-[12px]">
          <div className="text-stone-400">رقم التصريح: <span className="text-stone-200" dir="ltr">{S(p.reference_no)}</span></div>
          <div className="text-stone-400">الإصدار: <span className="text-stone-200">{p.issued_at ? opsDate(p.issued_at) : "—"}</span></div>
          <div className="text-stone-400">الانتهاء: <span className="text-stone-200">{p.expires_at ? opsDate(p.expires_at) : "—"}</span></div>
          {p.activity_note && <div className="text-stone-400">النشاط: <span className="text-stone-200">{p.activity_note}</span></div>}
          {p.note && <div className="text-stone-300 leading-6">{p.note}</div>}
          <div className="pt-1"><MediaStrip ownerKind="permit" ownerId={p.id} canManage={canManage} /></div>
          {canManage && (
            <div className="pt-1 flex gap-2">
              <button className={`${btnGhost} text-[11px] px-2 py-1`} onClick={() => setEditing(true)}>تعديل</button>
              <button className={`${btnGhost} text-[11px] px-2 py-1`} onClick={remove}>حذف (بسبب)</button>
            </div>
          )}
          {editing && (
            <PermitForm initial={p} onCancel={() => setEditing(false)}
              onDone={() => { setEditing(false); onChanged(); }} />
          )}
          {msg && <p className="text-[11.5px] text-red-400">{msg}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * إضافة/تعديل تصريح.
 *
 * ⛔ لا حقل مملوء مسبقًا بقيمة مخترعة: الجهة والرقم يبقيان فارغين حتى يكتبهما
 *    المستخدم. تصريح بجهة افتراضية هو بيان خاطئ عن جهة حقيقية.
 */
function PermitForm({ initial, onDone, onCancel }: {
  initial?: OpsPermitRow | null; onDone: () => void; onCancel: () => void;
}) {
  const [f, setF] = useState<Record<string, string>>({
    permit_type: initial?.permit_type ?? "other",
    title: initial?.title ?? "",
    authority_name: initial?.authority_name ?? "",
    reference_no: initial?.reference_no ?? "",
    issued_at: initial?.issued_at ?? "",
    expires_at: initial?.expires_at ?? "",
    status: initial?.status ?? "pending",
    scope: initial?.scope ?? "company",
    activity_note: initial?.activity_note ?? "",
    note: initial?.note ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  async function save() {
    if (f.title.trim().length < 2) { setMsg("العنوان مطلوب."); return; }
    // نفس قيد القاعدة: نطاق يدّعي ارتباطًا يجب أن يحمله.
    if (f.scope === "activity" && f.activity_note.trim().length < 3) {
      setMsg("نطاق «نشاط» يحتاج وصفًا للنشاط."); return;
    }
    if (f.issued_at && f.expires_at && f.expires_at < f.issued_at) {
      setMsg("تاريخ الانتهاء قبل تاريخ الإصدار."); return;
    }
    setBusy(true); setMsg(null);
    const r = await opsPermitUpsert(initial ? { ...f, id: initial.id } : f);
    setBusy(false);
    if (r.state === "ok") { onDone(); return; }
    setMsg(r.message);
  }

  return (
    <div className={`${card} p-3 space-y-2`}>
      <h3 className="text-[13px] text-stone-100">{initial ? "تعديل تصريح" : "تصريح جديد"}</h3>
      <input className={fieldCls} placeholder="العنوان" value={f.title} onChange={(e) => set("title", e.target.value)} aria-label="العنوان" />
      <div className="grid grid-cols-2 gap-2">
        <select className={fieldCls} value={f.permit_type} onChange={(e) => set("permit_type", e.target.value)} aria-label="النوع">
          {Object.entries(PERMIT_TYPE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={fieldCls} value={f.scope} onChange={(e) => set("scope", e.target.value)} aria-label="النطاق">
          {Object.entries(PERMIT_SCOPE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className={fieldCls} placeholder="الجهة المصدرة" value={f.authority_name} onChange={(e) => set("authority_name", e.target.value)} aria-label="الجهة المصدرة" />
        <input className={fieldCls} placeholder="رقم التصريح" value={f.reference_no} onChange={(e) => set("reference_no", e.target.value)} aria-label="رقم التصريح" dir="ltr" />
        <label className="text-[11px] text-stone-400">الإصدار
          <input type="date" className={fieldCls} value={f.issued_at} onChange={(e) => set("issued_at", e.target.value)} />
        </label>
        <label className="text-[11px] text-stone-400">الانتهاء
          <input type="date" className={fieldCls} value={f.expires_at} onChange={(e) => set("expires_at", e.target.value)} />
        </label>
        <select className={fieldCls} value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="الحالة">
          {Object.entries(PERMIT_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {f.scope === "activity" && (
        <input className={fieldCls} placeholder="وصف النشاط" value={f.activity_note} onChange={(e) => set("activity_note", e.target.value)} aria-label="وصف النشاط" />
      )}
      <textarea className={fieldCls} placeholder="ملاحظات" value={f.note} onChange={(e) => set("note", e.target.value)} aria-label="ملاحظات" rows={2} />
      <p className="text-[10.5px] text-stone-500">
        بلا تاريخ انتهاء لا يُرسَل تنبيه — التنبيهات تعمل قبل ٣٠ و٧ أيام.
      </p>
      {msg && <p className="text-[11.5px] text-red-400">{msg}</p>}
      <div className="flex gap-2">
        <button className={btnPrimary} onClick={save} disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ"}</button>
        <button className={btnGhost} onClick={onCancel}>إلغاء</button>
      </div>
    </div>
  );
}

export default function OpsPermitsRegistry() {
  const [scope, setScope] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const { st, reload } = useOpsLoad<{ ok: boolean; rows: OpsPermitRow[]; can_manage: boolean }>(
    () => opsPermitsList(scope ? { scope } : {}), [scope],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm text-stone-100">سجلّ التصاريح</h2>
        <div className="flex gap-2 items-center">
        <select
          className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="تصفية حسب النطاق"
        >
          <option value="">كلّ النطاقات</option>
          {Object.entries(PERMIT_SCOPE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        </div>
      </div>

      <StateView st={st} onRetry={reload}>
        {(d) => (
          <>
          {d.can_manage && (adding
            ? <PermitForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
            : <button className={`${btnGhost} text-[12px]`} onClick={() => setAdding(true)}>+ تصريح جديد</button>)}
          {d.rows.length === 0 ? (
            /* الفارغ مقصود: لا تصاريح مخترعة. النصّ يقول ما يُفعل، لا «لا نتائج». */
            <Empty message="لا تصاريح مسجَّلة بعد. أضف تصريحًا ليبدأ تتبّع انتهائه والتنبيه قبل ٣٠ و٧ أيام." />
          ) : (
            <ul className="space-y-2">
              {d.rows.map((p) => (
                <PermitCard key={p.id} p={p} canManage={d.can_manage} onChanged={reload} />
              ))}
            </ul>
          )}
          </>
        )}
      </StateView>
    </div>
  );
}

/** وسائط موقع تصوير — نفس الجدول ونفس مسار التوقيع (V2-3.4-B). */
export function OpsLocationMedia({ locationId }: { locationId: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[12.5px] text-stone-200">وسائط الموقع</h3>
      <MediaStrip ownerKind="location" ownerId={locationId} />
    </div>
  );
}

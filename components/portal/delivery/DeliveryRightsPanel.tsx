"use client";
// ════════════════════════════════════════════════════════════════════════════
// DeliveryRightsPanel — حقوق العرض التسويقيّ + روابط التسليم.
//
// Wave 5 · V2-5.2-A/B · V2-5.3-A…D
//
// ★ ثلاثة أشياء ترفض هذه اللوحة أن تفعلها ★
//  ١. **لا تفترض إذنًا.** الإذن التسويقيّ يُمنح بضغطة واعية، والافتراض `false`.
//     عملٌ يظهر في شوريل بلا إذن العميل خرقُ سرّية لا خطأ عرض.
//  ٢. **لا تُظهر الرمز مرّتين.** يعود من الخادم مرّة واحدة ولا يُخزَّن مهشَّمًا
//     إلّا. فتُعرض النسخة هنا، ومن يفقدها يُصدر غيرها ويُلغي القديمة.
//  ٣. **لا تُرسل شيئًا.** الخادم يعيد `auto_sent: false`، والتسليم قرار بشريّ.
//
// ⛔ خلف علم مطفأ لا تُركَّب (الحارس في المستدعي).
//
// 🔴 ولماذا تعيش خارج `components/portal/projectcore/` رغم أنّ موضوعها المخرَجات:
//    **منصّة المشاريع مجمَّدة** بقرار اعتماد مالك (Project Platform V1)، ويفرض
//    التجميدَ اختبارٌ آليّ. تركيب لوحة جديدة داخلها خرقٌ للتجميد لا «إضافة
//    صغيرة». فالمسار مستقلّ، والقراءة/الكتابة عبر RPCs جديدة لا عبر تعديل
//    شاشات المنصّة. رفع التجميد قرار خالد (W5-4) لا قرار هذه الموجة.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  pcDeliverableRightsSet, pcDeliveryLinkIssue, pcDeliveryLinkRevoke,
  ARCHIVE_POLICY_AR,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const btn = "px-3 py-1.5 rounded-lg text-[12px] border";
const btnGhost = `${btn} bg-stone-800 hover:bg-stone-700 text-stone-200 border-stone-700`;
const btnPrimary = `${btn} bg-red-700 hover:bg-red-600 text-white border-red-700`;

export default function DeliveryRightsPanel({
  projectId, deliverableId, initial,
}: {
  projectId: string;
  deliverableId?: string | null;
  initial?: { showreel_allowed?: boolean; confidential?: boolean; rights_note?: string | null };
}) {
  const [showreel, setShowreel] = useState(initial?.showreel_allowed === true);
  const [confidential, setConfidential] = useState(initial?.confidential === true);
  const [note, setNote] = useState(initial?.rights_note ?? "");
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // 🔴 الرمز يُعرض مرّة واحدة ثمّ يختفي بمغادرة الشاشة — لا يُحفظ في أيّ حالة.
  const [issued, setIssued] = useState<{ id: string; token: string; hint: string; days: number } | null>(null);
  const [days, setDays] = useState(14);

  async function saveRights() {
    // القيد نفسه موجود في القاعدة؛ يُفحص هنا لتخرج رسالة مفهومة قبل رسالة القيد.
    if (showreel && confidential) {
      setMsg({ t: "عمل سرّيّ لا يجوز السماح بعرضه تسويقيًّا.", bad: true });
      return;
    }
    if (!deliverableId) { setMsg({ t: "لا مخرَج محدَّد.", bad: true }); return; }
    setBusy(true); setMsg(null);
    const r = await pcDeliverableRightsSet(deliverableId, {
      showreel_allowed: showreel, confidential, rights_note: note.trim() || null,
    });
    setBusy(false);
    setMsg(r.ok ? { t: "حُفظت الحقوق.", bad: false } : { t: r.error ?? "تعذّر الحفظ.", bad: true });
  }

  async function issueLink() {
    setBusy(true); setMsg(null); setIssued(null);
    const r = await pcDeliveryLinkIssue(projectId, { deliverableId: deliverableId ?? null, days });
    setBusy(false);
    if (r.ok && r.data?.token) {
      setIssued({ id: r.data.id, token: r.data.token, hint: r.data.hint, days: r.data.expires_in_days });
      return;
    }
    setMsg({ t: r.ok ? "تعذّر إصدار الرابط." : (r.error ?? "تعذّر إصدار الرابط."), bad: true });
  }

  /**
   * إلغاء الرابط الذي صدر للتوّ.
   * موجود لأنّ الإصدار بالخطأ يقع فعلًا — ورابط صدر لمشروع خاطئ يجب أن يموت
   * في الثانية نفسها، لا أن ينتظر شاشة إدارة روابط.
   */
  async function revokeIssued() {
    if (!issued) return;
    const reason = window.prompt("سبب الإلغاء (٣ أحرف على الأقل):")?.trim() ?? "";
    if (reason.length < 3) { setMsg({ t: "الإلغاء يحتاج سببًا مكتوبًا.", bad: true }); return; }
    const r = await pcDeliveryLinkRevoke(issued.id, reason);
    if (r.ok) { setIssued(null); setMsg({ t: "أُلغي الرابط.", bad: false }); return; }
    setMsg({ t: r.error ?? "تعذّر الإلغاء.", bad: true });
  }

  return (
    <div className="space-y-3">
      {/* ─── حقوق العرض ─── */}
      <section className={card}>
        <h3 className="text-[13px] text-stone-100 mb-2">حقوق العرض التسويقيّ</h3>

        <label className="flex items-start gap-2 text-[12.5px] text-stone-200 mb-2">
          <input type="checkbox" checked={confidential} className="mt-[3px]"
            onChange={(e) => {
              setConfidential(e.target.checked);
              // 🔴 السرّية تتقدّم: تفعيلها يُسقط الإذن التسويقيّ فورًا في الواجهة
              //    أيضًا، فلا تبقى علامة مضلِّلة على الشاشة قبل الحفظ.
              if (e.target.checked) setShowreel(false);
            }} />
          <span>
            عمل سرّيّ
            <span className="block text-[11px] text-stone-500">
              يتقدّم على أيّ إذن تسويقيّ، ويمنع ظهوره في الشوريل نهائيًّا.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-[12.5px] text-stone-200">
          <input type="checkbox" checked={showreel} disabled={confidential} className="mt-[3px]"
            onChange={(e) => setShowreel(e.target.checked)} />
          <span>
            يُسمح بعرضه تسويقيًّا (شوريل)
            <span className="block text-[11px] text-stone-500">
              ⛔ لا يُفترض — يُمنح بإذن العميل. ولا يظهر قبل التسليم النهائيّ.
            </span>
          </span>
        </label>

        <textarea
          className="w-full mt-2 bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200"
          rows={2} placeholder="مرجع الإذن أو قيوده (اختياريّ)"
          value={note} onChange={(e) => setNote(e.target.value)} aria-label="ملاحظة الحقوق"
        />
        <button className={`${btnPrimary} mt-2`} onClick={saveRights} disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "حفظ الحقوق"}
        </button>
      </section>

      {/* ─── روابط التسليم ─── */}
      <section className={card}>
        <h3 className="text-[13px] text-stone-100 mb-1">رابط تسليم</h3>
        <p className="text-[11px] text-stone-500 mb-2">
          الرابط ينتهي تلقائيًّا، ويُلغى في أيّ وقت، ولا يتجاوز بوّابة السداد القائمة.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[11px] text-stone-400">
            صلاحية بالأيّام
            <input type="number" min={1} max={90} value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 14)))}
              className="block w-24 bg-stone-950 border border-stone-700 rounded px-2 py-1 text-[12px] text-stone-200"
              dir="ltr" />
          </label>
          <button className={btnGhost} onClick={issueLink} disabled={busy}>إصدار رابط</button>
        </div>

        {issued && (
          <div className="mt-2 p-2 rounded border border-amber-700/50 bg-amber-950/20">
            {/* 🔴 يظهر مرّة واحدة — لا يُخزَّن ولا يُسترجَع. */}
            <p className="text-[11px] text-amber-400 mb-1">
              انسخه الآن: لا يظهر مرّة أخرى، ولا يُخزَّن لدينا إلّا مهشَّمًا.
            </p>
            <code className="block text-[11px] text-stone-100 break-all" dir="ltr">{issued.token}</code>
            <p className="text-[10.5px] text-stone-500 mt-1">
              المعرّف المختصر <span dir="ltr">{issued.hint}</span> · ينتهي بعد {issued.days} يومًا ·
              لم يُرسَل تلقائيًّا.
            </p>
            <div className="flex gap-2 mt-1">
              <button className={btnGhost} onClick={() => setIssued(null)}>إخفاء</button>
              <button className={btnGhost} onClick={revokeIssued}>إلغاء هذا الرابط</button>
            </div>
          </div>
        )}

        {/* 🔴 سياسة الأرشفة تُقال قبل التسليم لا بعده (V2-5.3-D). */}
        <p className="text-[10.5px] text-stone-500 leading-relaxed mt-3 border-t border-stone-800 pt-2">
          {ARCHIVE_POLICY_AR}
        </p>
      </section>

      {msg && (
        <p className={`text-[12px] ${msg.bad ? "text-red-400" : "text-emerald-500"}`}>{msg.t}</p>
      )}
    </div>
  );
}

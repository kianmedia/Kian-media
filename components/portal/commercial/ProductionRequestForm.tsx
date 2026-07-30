"use client";
// ════════════════════════════════════════════════════════════════════════════
// ProductionRequestForm — «طلب إنتاج جديد».
//
// ★ ثلاثة أشياء تقولها هذه الشاشة بصراحة ★
//   ١) تقدير التجاوز المعروض هنا **تقدير**، والرقم الملزِم يحسبه الخادم من
//      الدفتر لحظة التقديم. وإن كان رصيد الوحدة غير معروف (لا حركة بعد) فلا
//      يُعرض تقدير إطلاقًا — تقدير مبنيّ على صفر مجهول أسوأ من غياب التقدير.
//   ٢) المرفق **بيانات فقط**: اسم ونوع وحجم وملاحظة. لا يُرفع ملفّ من هنا ولا
//      يُحفظ رابط، والقاعدة ترفض أيّ اسم يبدأ بـhttp. الملفّ يُسلَّم بالقناة
//      المتّفق عليها، وهذا مكتوب في الشاشة لا في وثيقة.
//   ٣) ★ التقديم لا يُنشئ مشروعًا ★ — ولا الاعتماد. إنشاء المشروع خطوة يدويّة
//      منفصلة يقوم بها فريق كيان. مكتوبة للعميل كي لا ينتظر ما لن يحدث.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import {
  submitServiceRequest, addAttachmentMeta, csubUnits,
  type CsubUnitBalance, type CsubServiceRequest,
} from "@/lib/portal/commercial";
import {
  card, btnPrimary, btnGhost, fieldCls, labelCls, ErrorBox, Chip,
} from "./CsubAtoms";

interface AttachmentDraft { file_name: string; mime_type: string; size_bytes: string; note: string; }

export default function ProductionRequestForm({
  subscriptionId, balances, draft, onDone, onCancel,
}: {
  subscriptionId: string;
  /** null = لا وحدات مُسنَدة. لا يُعامَل كرصيد صفر أبدًا. */
  balances: CsubUnitBalance[] | null;
  draft?: CsubServiceRequest | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const units = balances ?? [];
  const [unitType, setUnitType] = useState(draft?.unit_type ?? units[0]?.unit_type ?? "");
  const [qty, setQty] = useState(String(draft?.units ?? 1));
  const [credits, setCredits] = useState(String(draft?.credits_required ?? draft?.units ?? 1));
  const [city, setCity] = useState(draft?.city ?? "");
  const [location, setLocation] = useState(draft?.location_text ?? "");
  const [preferred, setPreferred] = useState(draft?.preferred_date ?? "");
  const [alternative, setAlternative] = useState(draft?.alternative_date ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [contactName, setContactName] = useState(draft?.contact_person_name ?? "");
  const [contactPhone, setContactPhone] = useState(draft?.contact_person_phone ?? "");
  const [urgent, setUrgent] = useState(!!draft?.is_urgent);
  const [clientNotes, setClientNotes] = useState(draft?.client_notes ?? "");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [att, setAtt] = useState<AttachmentDraft>({ file_name: "", mime_type: "", size_bytes: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = units.find((u) => u.unit_type === unitType) ?? null;
  const creditsNum = Number(credits);
  const creditsValid = Number.isFinite(creditsNum) && creditsNum >= 0;

  /**
   * ★ تقدير التجاوز ★ — يُحسب فقط حين يكون المتاح **معروفًا**، أي حين تحمل
   * الوحدة حركات في الدفتر. بلا ذلك لا يوجد تقدير، ويُقال ذلك نصًّا بدل
   * افتراض متاحٍ صفرًا (الذي سيُظهر كلّ الطلب تجاوزًا وهو ادّعاء بلا دليل).
   */
  const overage = useMemo(() => {
    if (!selected || !selected.has_entries || !creditsValid) return null;
    return Math.max(0, creditsNum - Number(selected.available));
  }, [selected, creditsNum, creditsValid]);

  const addAtt = () => {
    const name = att.file_name.trim();
    if (!name) return;
    if (/^(https?|s3|gs|file):\/\//i.test(name)) {
      setErr("يُسجَّل اسم الملفّ فقط لا رابطه. الملفّ نفسه يُسلَّم بالقناة المتّفق عليها.");
      return;
    }
    setErr(null);
    setAttachments((a) => [...a, { ...att, file_name: name }]);
    setAtt({ file_name: "", mime_type: "", size_bytes: "", note: "" });
  };

  const save = async (submit: boolean) => {
    setErr(null);
    if (!unitType) { setErr("اختر نوع الخدمة (وحدة الإنتاج)."); return; }
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) { setErr("عدد الوحدات يجب أن يكون أكبر من صفر."); return; }
    if (!creditsValid) { setErr("الرصيد المطلوب غير صالح."); return; }
    if (submit) {
      if (!city.trim()) { setErr("المدينة مطلوبة قبل التقديم."); return; }
      if (!contactName.trim()) { setErr("اسم جهة الاتصال مطلوب قبل التقديم."); return; }
      if (!preferred) { setErr("التاريخ المفضّل مطلوب قبل التقديم."); return; }
    }
    setBusy(true);
    const r = await submitServiceRequest({
      id: draft?.id ?? null,
      subscriptionId,
      unitType,
      units: qtyNum,
      creditsRequired: creditsNum,
      city: city.trim() || undefined,
      locationText: location.trim() || undefined,
      preferredDate: preferred || undefined,
      alternativeDate: alternative || undefined,
      description: description.trim() || undefined,
      contactPersonName: contactName.trim() || undefined,
      contactPersonPhone: contactPhone.trim() || undefined,
      isUrgent: urgent,
      clientNotes: clientNotes.trim() || undefined,
    }, submit);

    if (r.state !== "ok") { setBusy(false); setErr(r.message); return; }

    // بيانات المرفقات تُسجَّل بعد إنشاء الطلب. فشل واحد منها لا يُلغي الطلب،
    // ويُقال للعميل صراحةً بدل ابتلاعه.
    const failed: string[] = [];
    for (const a of attachments) {
      const size = Number(a.size_bytes);
      const res = await addAttachmentMeta({
        requestId: r.data.id,
        fileName: a.file_name,
        mimeType: a.mime_type.trim() || undefined,
        sizeBytes: Number.isFinite(size) && size > 0 ? size : undefined,
        note: a.note.trim() || undefined,
      });
      if (res.state !== "ok") failed.push(a.file_name);
    }
    setBusy(false);
    if (failed.length) {
      setErr(`حُفظ الطلب، ولم تُسجَّل بيانات هذه الملفّات: ${failed.join("، ")}. أضفها لاحقًا.`);
      return;
    }
    onDone();
  };

  return (
    <div className={`${card} p-4 sm:p-5 space-y-4`} dir="rtl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-stone-100 text-base font-medium">
            {draft ? "تعديل مسوّدة طلب إنتاج" : "طلب إنتاج جديد"}
          </h2>
          <p className="text-[11px] text-stone-500 mt-1 leading-6">
            يُراجَع الطلب ثمّ يُحجز له الرصيد ثمّ يُعتمد ويُجدوَل ويُنفَّذ. كلّ حالة تظهر لك في «طلباتي».
          </p>
        </div>
        <button className={btnGhost} onClick={onCancel} disabled={busy}>إغلاق</button>
      </div>

      {/* ★ ما لن يحدث — يُقال قبل الإرسال لا بعده ★ */}
      <div className="rounded-lg border border-stone-700 bg-stone-950 p-3">
        <p className="text-[11px] text-stone-400 leading-6">
          تقديم الطلب — واعتماده لاحقًا — <span className="text-stone-200">لا يُنشئ مشروعًا</span>.
          إنشاء المشروع خطوة منفصلة يقوم بها فريق كيان يدويًّا بعد الاعتماد، وستُبلَّغ بها.
        </p>
      </div>

      {units.length === 0 && (
        <ErrorBox message="لا توجد وحدات إنتاج مُسنَدة إلى اشتراكك، فلا يمكن تقديم طلب. تواصل معنا لإسناد الوحدات." />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="csub-unit">نوع الخدمة *</label>
          <select id="csub-unit" className={fieldCls} value={unitType}
                  onChange={(e) => setUnitType(e.target.value)}>
            <option value="">— اختر —</option>
            {units.map((u) => (
              <option key={u.unit_type} value={u.unit_type}>{u.label_ar}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-qty">عدد الوحدات *</label>
          <input id="csub-qty" className={fieldCls} type="number" min={1} step="0.5" value={qty}
                 onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-city">المدينة *</label>
          <input id="csub-city" className={fieldCls} value={city}
                 onChange={(e) => setCity(e.target.value)} placeholder="الرياض" />
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-location">الموقع</label>
          <input id="csub-location" className={fieldCls} value={location}
                 onChange={(e) => setLocation(e.target.value)} placeholder="اسم المبنى أو وصف الموقع" />
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-pref">التاريخ المفضّل *</label>
          <input id="csub-pref" className={fieldCls} type="date" value={preferred ?? ""}
                 onChange={(e) => setPreferred(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-alt">تاريخ بديل</label>
          <input id="csub-alt" className={fieldCls} type="date" value={alternative ?? ""}
                 onChange={(e) => setAlternative(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-contact">جهة الاتصال *</label>
          <input id="csub-contact" className={fieldCls} value={contactName}
                 onChange={(e) => setContactName(e.target.value)} placeholder="الاسم" />
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-phone">جوّال جهة الاتصال</label>
          <input id="csub-phone" className={fieldCls} value={contactPhone}
                 onChange={(e) => setContactPhone(e.target.value)} inputMode="tel" placeholder="05…" />
        </div>
        <div>
          <label className={labelCls} htmlFor="csub-credits">الرصيد المطلوب</label>
          <input id="csub-credits" className={fieldCls} type="number" min={0} step="0.5" value={credits}
                 onChange={(e) => setCredits(e.target.value)} />
          <p className="text-[10px] text-stone-600 mt-1 leading-5">
            تقديرك أنت. يراجعه فريق كيان ويصحّحه قبل حجز الرصيد.
          </p>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-stone-300 min-h-[44px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-red-700" checked={urgent}
                   onChange={(e) => setUrgent(e.target.checked)} />
            طلب عاجل
          </label>
        </div>
      </div>

      {/* ★ تقدير التجاوز — أو الاعتراف بأنّه غير معروف ★ */}
      <div className="rounded-lg border border-stone-700 bg-stone-950 p-3 space-y-1">
        {!selected ? (
          <p className="text-[11px] text-stone-500 leading-6">اختر نوع الخدمة لعرض رصيدك المتاح.</p>
        ) : !selected.has_entries ? (
          <p className="text-[11px] text-amber-300/80 leading-6">
            لم تُسجَّل حركات على وحدة «{selected.label_ar}» بعد، فرصيدك المتاح عليها غير معروف على هذه
            الشاشة ولا يمكن تقدير التجاوز. سيحسبه فريق كيان عند المراجعة.
          </p>
        ) : overage === null ? (
          <p className="text-[11px] text-stone-500 leading-6">أدخل رصيدًا مطلوبًا صالحًا لعرض تقدير التجاوز.</p>
        ) : overage > 0 ? (
          <>
            <p className="text-[11px] text-amber-300 leading-6">
              تقدير تجاوز: {csubUnits(overage, selected.uom_ar)} فوق المتاح لديك
              ({csubUnits(Number(selected.available), selected.uom_ar)}).
            </p>
            <p className="text-[10px] text-stone-500 leading-5">
              الطلب المتجاوز لا يُرفض تلقائيًّا — يمرّ باعتماد إضافي من كيان قبل تنفيذه، ولا يُخصم شيء قبله.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-emerald-300/90 leading-6">
            تقدير مبدئيّ: المتاح لديك ({csubUnits(Number(selected.available), selected.uom_ar)}) يغطّي هذا الطلب.
          </p>
        )}
        <p className="text-[10px] text-stone-600 leading-5">
          هذا تقدير على شاشتك. الرقم الملزِم يُحسب في الخادم لحظة التقديم.
        </p>
      </div>

      <div>
        <label className={labelCls} htmlFor="csub-desc">وصف الطلب</label>
        <textarea id="csub-desc" className={`${fieldCls} min-h-[96px]`} value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="ما المطلوب تصويره/إنتاجه؟ وما الغرض منه؟" />
      </div>

      <div>
        <label className={labelCls} htmlFor="csub-notes">ملاحظاتك</label>
        <textarea id="csub-notes" className={`${fieldCls} min-h-[72px]`} value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)} />
      </div>

      {/* ★ بيانات المرفقات — لا ملفّ ولا رابط ★ */}
      <div className="space-y-2">
        <div>
          <h3 className="text-stone-200 text-sm font-medium">بيانات المرفقات</h3>
          <p className="text-[11px] text-stone-500 mt-1 leading-6">
            تُسجَّل هنا <span className="text-stone-300">بيانات</span> الملفّ فقط: الاسم والنوع والحجم وملاحظة.
            لا يُرفع ملفّ من هذه الشاشة ولا يُحفظ رابط — الملفّ نفسه يُسلَّم بالقناة المتّفق عليها.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className={fieldCls} value={att.file_name} placeholder="اسم الملفّ"
                 onChange={(e) => setAtt({ ...att, file_name: e.target.value })} aria-label="اسم الملفّ" />
          <input className={fieldCls} value={att.mime_type} placeholder="النوع (pdf/mp4…)"
                 onChange={(e) => setAtt({ ...att, mime_type: e.target.value })} aria-label="نوع الملفّ" />
          <input className={fieldCls} value={att.size_bytes} placeholder="الحجم (بايت)" inputMode="numeric"
                 onChange={(e) => setAtt({ ...att, size_bytes: e.target.value })} aria-label="حجم الملفّ" />
          <button className={btnGhost} onClick={addAtt} type="button">إضافة</button>
        </div>
        {attachments.length > 0 && (
          <ul className="space-y-1">
            {attachments.map((a, i) => (
              <li key={`${a.file_name}-${i}`} className="flex items-center gap-2 flex-wrap text-xs text-stone-400">
                <Chip text={a.file_name} />
                {a.mime_type && <span className="text-stone-600">{a.mime_type}</span>}
                <button type="button" className="text-red-400 hover:text-red-300"
                        onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))}>
                  إزالة
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && <ErrorBox message={err} />}

      <div className="flex gap-2 flex-wrap">
        <button className={btnPrimary} onClick={() => void save(true)} disabled={busy || units.length === 0}>
          {busy ? "جارٍ الإرسال…" : "تقديم الطلب"}
        </button>
        <button className={btnGhost} onClick={() => void save(false)} disabled={busy || units.length === 0}>
          حفظ كمسوّدة
        </button>
        <button className={btnGhost} onClick={onCancel} disabled={busy}>إلغاء</button>
      </div>
    </div>
  );
}

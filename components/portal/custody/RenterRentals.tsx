"use client";
// ════════════════════════════════════════════════════════════════════════
// External rental v2 — registration gate (KYC) → (a) طلب عرض سعر تأجير معدات
// (feeds the EXISTING Zoho quotes flow: admin prices it in Zoho Books, renter
// views/downloads the PDF, accepts/rejects/requests changes, admin issues the
// e-invoice — all in the quotes tab; can be skipped for personal-deal clients)
// → (b) rental handover request with signed bilingual contract (min 2 photos
// per item + 2 overall) → "my rentals" + return.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  getMyRenterProfile, upsertRenterProfile, listMyCustodyRecords, submitRentalRequest,
  submitReturn, uploadEvidence, evidencePath, newRecordId, emitCustodyEvent,
  notifyRentalQuoteRequest, MIN_PHOTOS_PER_ITEM, MIN_PHOTOS_OVERALL,
  type CustodyRecord, type RenterProfile, type CheckoutItemInput,
} from "@/lib/portal/custody";
import { createQuote } from "@/lib/portal/leads";
import {
  SectionTitle, Empty, RecordCard, ReturnPanel, ItemPhotoEditor, MultiPhotoCapture,
  SignBlock, RENT_CLAUSES, RENT_AGREE, type DraftItem, type ShotFile,
} from "@/components/portal/custody/ui";

export default function RenterRentals() {
  const { t, isAr } = useI18n();
  const { profile, readOnly } = usePortal();
  const uid = profile.id;

  const [renter, setRenter] = useState<RenterProfile | null>(null);
  const [records, setRecords] = useState<CustodyRecord[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); };

  const reload = useCallback(async () => {
    const [rp, rec] = await Promise.all([getMyRenterProfile(uid), listMyCustodyRecords("rental", uid)]);
    if (rp.ok) setRenter(rp.data);
    setRecords(rec.ok ? rec.data : []);
    setPhase(rp.ok && rec.ok ? "ready" : "error");
  }, [uid]);
  useEffect(() => { void reload(); }, [reload]);

  // ─── Registration form ───
  const [reg, setReg] = useState({ fullName: "", idNumber: "", phone: "", email: profile.email || "", address: "" });
  const [regErr, setRegErr] = useState<string | null>(null);
  async function doRegister() {
    setRegErr(null);
    if (readOnly) return;
    if (!reg.fullName.trim() || !reg.idNumber.trim() || !reg.phone.trim() || !reg.email.trim() || !reg.address.trim()) {
      setRegErr(t({ ar: "كل الحقول مطلوبة لفتح الحساب.", en: "All fields are required." })); return;
    }
    if (!reg.email.includes("@")) { setRegErr(t({ ar: "أدخل بريدًا إلكترونيًا صحيحًا.", en: "Enter a valid email." })); return; }
    setBusy(true);
    const r = await upsertRenterProfile(reg);
    setBusy(false);
    if (!r.ok) { setRegErr((t({ ar: "تعذّر فتح الحساب: ", en: "Couldn't register: " })) + r.error); return; }
    await reload();
    flash(t({ ar: "تم تفعيل حسابك كمستأجر.", en: "Your renter account is active." }));
  }

  // ─── طلب عرض سعر تأجير معدات (يغذي نظام عروض Zoho القائم) ───
  const [quoteLines, setQuoteLines] = useState<{ name: string; qty: string }[]>([{ name: "", qty: "1" }]);
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoteRef, setQuoteRef] = useState<string | null>(null);

  async function doQuoteRequest() {
    setQuoteErr(null);
    if (readOnly || !renter) return;
    const lines = quoteLines.map((l) => ({ name: l.name.trim(), qty: Math.max(Number(l.qty) || 1, 1) }))
      .filter((l) => l.name);
    if (lines.length === 0) { setQuoteErr(t({ ar: "أضف معدة واحدة على الأقل.", en: "Add at least one equipment line." })); return; }
    const description =
      "طلب تأجير معدات — Equipment Rental Quote Request\n" +
      lines.map((l, i) => `${i + 1}. ${l.name} × ${l.qty}`).join("\n") +
      (quoteNotes.trim() ? `\n\nملاحظات: ${quoteNotes.trim()}` : "");
    setQuoteBusy(true);
    const r = await createQuote({
      services: ["Equipment Rental"],
      description,
      contact: { fullName: renter.full_name, mobile: renter.phone, email: renter.email },
      language: isAr ? "AR" : "EN",
    });
    setQuoteBusy(false);
    if (!r.ok) { setQuoteErr((t({ ar: "تعذّر إرسال الطلب: ", en: "Couldn't submit: " })) + r.error); return; }
    const ref = r.data.row.reference || "";
    setQuoteRef(ref);
    // إشعار داخل البوابة (أدمن/مالك/مدير/أمين عهدة) + بريد — لا يفشلان الطلب.
    try { void notifyRentalQuoteRequest(r.data.row.id, ref); } catch { /* non-blocking */ }
    emitCustodyEvent({ event: "rental_quote_request_new", record_id: r.data.row.id, reference: ref, kind: "rental", party_name: renter.full_name });
    setQuoteLines([{ name: "", qty: "1" }]); setQuoteNotes("");
    flash(t({ ar: "أُرسل طلب عرض السعر — سيصلك عرض مرتب من فريق كيان في تبويب طلبات السعر.", en: "Quote request sent — Kian's priced offer will appear in your Quotes tab." }));
  }

  // ─── Rental handover request form ───
  const [items, setItems] = useState<DraftItem[]>([]);
  const [overall, setOverall] = useState<ShotFile[]>([]);
  const [signed, setSigned] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doRequest() {
    setErr(null);
    if (readOnly || !renter) return;
    if (items.length === 0) { setErr(t({ ar: "أضف صنفاً واحداً على الأقل.", en: "Add at least one item." })); return; }
    if (items.some((i) => i.shots.length < MIN_PHOTOS_PER_ITEM)) {
      setErr(t({ ar: `صوّر كل قطعة (${MIN_PHOTOS_PER_ITEM} صور على الأقل لكل بند).`, en: `Min ${MIN_PHOTOS_PER_ITEM} photos per item.` })); return;
    }
    if (overall.length < MIN_PHOTOS_OVERALL) {
      setErr(t({ ar: `صوّر إجمالي المعدات (${MIN_PHOTOS_OVERALL} صور على الأقل).`, en: `Min ${MIN_PHOTOS_OVERALL} overall photos.` })); return;
    }
    if (!signed) { setErr(t({ ar: "أشّر على عقد الإيجار قبل الإرسال.", en: "Check the rental contract first." })); return; }

    setBusy(true);
    const recordId = newRecordId();
    const payload: CheckoutItemInput[] = [];
    for (let i = 0; i < items.length; i++) {
      const paths: string[] = [];
      for (let j = 0; j < items[i].shots.length; j++) {
        const p = evidencePath(uid, recordId, "before", `item-${i}-${j}`);
        const up = await uploadEvidence(p, items[i].shots[j].file);
        if (!up.ok) { setBusy(false); setErr(t({ ar: `تعذّر رفع صور «${items[i].name}» — حاول مجددًا.`, en: `Couldn't upload photos of "${items[i].name}" — retry.` })); return; }
        paths.push(p);
      }
      payload.push({ name: items[i].name, qty: items[i].qty, photos: paths });
    }
    const overallPaths: string[] = [];
    for (let j = 0; j < overall.length; j++) {
      const p = evidencePath(uid, recordId, "before", `overall-${j}`);
      const up = await uploadEvidence(p, overall[j].file);
      if (!up.ok) { setBusy(false); setErr(t({ ar: "تعذّر رفع الصور الإجمالية — حاول مجددًا.", en: "Couldn't upload the overall photos — retry." })); return; }
      overallPaths.push(p);
    }

    const r = await submitRentalRequest(recordId, payload, overallPaths);
    setBusy(false);
    if (!r.ok) { setErr((t({ ar: "تعذّر إرسال الطلب: ", en: "Couldn't submit: " })) + r.error); return; }

    emitCustodyEvent({ event: "rental_request_new", record_id: recordId, record_no: r.data.record_no, kind: "rental", party_name: renter.full_name });
    setItems([]); setOverall([]); setSigned(false);
    await reload();
    flash(t({ ar: `استلمنا طلبك ${r.data.record_no} — سيراجعه فريق كيان قبل التسليم.`, en: `Request ${r.data.record_no} received — Kian will review before handover.` }));
  }

  async function doReturn(record: CustodyRecord, afters: Map<string, File[]>, overallFiles: File[], shortage: boolean, note: string) {
    setBusy(true);
    const after: { item_id: string; photos: string[] }[] = [];
    for (const [itemId, files] of Array.from(afters)) {   // Array.from: Map iteration needs es2015 target; avoid touching global tsconfig
      const paths: string[] = [];
      for (let j = 0; j < files.length; j++) {
        const p = evidencePath(uid, record.id, "after", `item-${itemId}-${j}`);
        const up = await uploadEvidence(p, files[j]);
        if (!up.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع إحدى صور الإرجاع — حاول مجددًا.", en: "Couldn't upload a return photo — retry." })); return; }
        paths.push(p);
      }
      after.push({ item_id: itemId, photos: paths });
    }
    const overallPaths: string[] = [];
    for (let j = 0; j < overallFiles.length; j++) {
      const p = evidencePath(uid, record.id, "after", `overall-${j}`);
      const up = await uploadEvidence(p, overallFiles[j]);
      if (!up.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع الصور الإجمالية — حاول مجددًا.", en: "Couldn't upload the overall photos — retry." })); return; }
      overallPaths.push(p);
    }

    const r = await submitReturn(record.id, after, overallPaths, shortage, note);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر إرسال الإرجاع: ", en: "Couldn't send the return: " })) + r.error); return; }
    emitCustodyEvent({
      event: shortage ? "custody_return_shortage" : "custody_return_submitted",
      record_id: record.id, record_no: record.record_no, kind: record.kind,
      party_name: record.party_name, urgent: shortage,
    });
    await reload();
    flash(t({ ar: "أُرسل الإرجاع — الإقفال النهائي بعد مراجعة الإدارة.", en: "Return sent — final closure after admin review." }));
  }

  // inpBare بلا w-full — للحقول داخل صفوف flex حتى لا يتغلب w-full على العرض المحدد (خانة العدد).
  const inpBare = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
  const inp = `w-full ${inpBare}`;

  if (phase === "loading") return <p className="text-stone-500 text-sm">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return <p className="text-red-400 text-sm">{t({ ar: "تعذّر التحميل — شغّل ترحيل قاعدة البيانات أولاً.", en: "Couldn't load — run the DB migration first." })}</p>;

  // ─── Registration gate ───
  if (!renter) {
    return (
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3 max-w-xl">
        <SectionTitle icon="shield">{t({ ar: "فتح حساب مستأجر", en: "Open a renter account" })}</SectionTitle>
        <p className="text-xs text-stone-400 leading-relaxed">
          {t({ ar: "فتح الحساب شرط أساسي قبل التسليم. عبّئ بياناتك:", en: "Registration is required before any handover. Fill in your details:" })}
        </p>
        <input value={reg.fullName} onChange={(e) => setReg({ ...reg, fullName: e.target.value })} placeholder={t({ ar: "الاسم الكامل / الجهة", en: "Full name / entity" })} className={inp} />
        <div className="grid grid-cols-2 gap-2">
          <input value={reg.idNumber} onChange={(e) => setReg({ ...reg, idNumber: e.target.value })} placeholder={t({ ar: "رقم الهوية / الإقامة", en: "National ID / Iqama" })} className={inp} />
          <input value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder={t({ ar: "رقم الجوال", en: "Phone" })} dir="ltr" className={inp} />
        </div>
        <input value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} placeholder={t({ ar: "البريد الإلكتروني", en: "Email" })} dir="ltr" className={inp} />
        <input value={reg.address} onChange={(e) => setReg({ ...reg, address: e.target.value })} placeholder={t({ ar: "العنوان", en: "Address" })} className={inp} />
        {regErr && <div className="text-red-400 text-xs">{regErr}</div>}
        <button type="button" onClick={() => void doRegister()} disabled={busy || readOnly}
          className="w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2.5">
          {busy ? "…" : t({ ar: "فتح حساب مستأجر", en: "Open renter account" })}
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active renter card */}
      <div className="bg-stone-900 border border-emerald-900 rounded-xl p-3.5 flex items-start gap-2.5">
        <span className="text-emerald-400 mt-0.5"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8z"/><path d="M9 12l2 2 4-4"/></svg></span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-stone-100">{t({ ar: "حسابك مفعّل كمستأجر", en: "Your renter account is active" })}</div>
          <div className="text-[11px] font-mono text-stone-500 leading-relaxed">
            {renter.full_name} • {t({ ar: "هوية", en: "ID" })}: {renter.id_number} • <span dir="ltr">{renter.phone}</span>
            <br /><span dir="ltr">{renter.email}</span> • {renter.address}
          </div>
        </div>
      </div>

      {/* طلب عرض سعر تأجير معدات */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
        <SectionTitle icon="pkg">{t({ ar: "طلب تأجير معدات — عرض سعر", en: "Equipment rental — request a quote" })}</SectionTitle>
        <p className="text-xs text-stone-400 leading-relaxed">
          {t({ ar: "اكتب المعدات المطلوب تأجيرها وسيرد عليك فريق كيان بعرض سعر مرتب (PDF من Zoho Books) في تبويب طلبات السعر — تقدر تقبله أو ترفضه أو تطلب تعديله، وبعد قبوله تُصدر الفاتورة الإلكترونية ثم تفتح طلب استلام العهدة أدناه.",
               en: "List the equipment you want to rent — Kian replies with a formal priced quote (Zoho Books PDF) in your Quotes tab; accept/reject/request changes, then the e-invoice is issued and you open the handover request below." })}
        </p>
        {quoteLines.map((l, i) => (
          <div key={i} className="flex gap-2">
            {/* اسم المعدة = الحقل العريض؛ العدد = خانة صغيرة ثابتة (inpBare بلا w-full حتى لا يتغلب على العرض) */}
            <input value={l.name} onChange={(e) => setQuoteLines((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
              placeholder={t({ ar: `المعدة ${i + 1} (مثال: كاميرا Sony FX6)`, en: `Equipment ${i + 1} (e.g. Sony FX6)` })}
              className={`flex-1 min-w-0 ${inpBare}`} />
            <input value={l.qty} onChange={(e) => setQuoteLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
              type="number" min={1} className={`${inpBare} text-center`} style={{ width: 64, flex: "0 0 auto" }}
              aria-label={t({ ar: "الكمية", en: "Qty" })} />
            <button type="button" aria-label={t({ ar: "حذف", en: "Remove" })}
              onClick={() => setQuoteLines((p) => p.length > 1 ? p.filter((_, j) => j !== i) : p)}
              className="px-2.5 rounded-lg bg-stone-800 border border-stone-700 text-stone-400" style={{ flex: "0 0 auto" }}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => setQuoteLines((p) => [...p, { name: "", qty: "1" }])}
          className="rounded-lg bg-stone-800 border border-stone-700 text-stone-300 text-xs px-3 py-1.5">
          + {t({ ar: "إضافة معدة", en: "Add equipment" })}
        </button>
        <textarea value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} rows={2}
          placeholder={t({ ar: "ملاحظات (مدة الإيجار، الموقع، التواريخ…) — اختياري", en: "Notes (duration, location, dates…) — optional" })} className={inp} />
        {quoteErr && <div className="text-red-400 text-xs">{quoteErr}</div>}
        {quoteRef && (
          <div className="text-xs text-emerald-400">
            {t({ ar: `أُرسل الطلب (${quoteRef}) — تابع عرض السعر في `, en: `Request sent (${quoteRef}) — track the quote in ` })}
            <Link href="/client-portal/quotes" className="underline text-emerald-300">{t({ ar: "تبويب طلبات السعر", en: "the Quotes tab" })}</Link>
          </div>
        )}
        <button type="button" onClick={() => void doQuoteRequest()} disabled={quoteBusy || readOnly}
          className="w-full rounded-lg bg-stone-800 border border-red-800 text-red-300 hover:text-red-200 disabled:opacity-50 text-sm font-medium py-2.5">
          {quoteBusy ? "…" : t({ ar: "إرسال طلب عرض السعر", en: "Send quote request" })}
        </button>
        <p className="text-[10.5px] text-stone-500">
          {t({ ar: "للعملاء الخاصين: يمكن لفريق كيان اعتماد التأجير مباشرة (بدون عرض سعر أو بمبلغ صفر) — تجاوز هذا القسم وافتح طلب الاستلام أدناه.",
               en: "Personal-deal clients: Kian can approve directly (no quote / zero amount) — skip this and open the handover request below." })}
        </p>
      </section>

      {/* Rental handover request */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
        <SectionTitle icon="pkg">{t({ ar: "طلب استلام عهدة مستأجر", en: "Renter handover request" })}</SectionTitle>
        <div className="text-xs font-mono text-stone-500">
          {t({ ar: "المستأجر (من حسابك): ", en: "Renter (from your account): " })}{renter.full_name} • <span dir="ltr">{renter.phone}</span>
        </div>
        <ItemPhotoEditor items={items} setItems={(fn) => setItems(fn)} />
        <MultiPhotoCapture label={t({ ar: "صور إجمالي المعدات (بعد تصوير القطع)", en: "Overall equipment photos (after per-item shots)" })}
          shots={overall}
          onAdd={(f) => setOverall((p) => [...p, { file: f, preview: URL.createObjectURL(f) }])}
          onRemove={(i) => setOverall((p) => p.filter((_, k) => k !== i))} />
        <SignBlock title={t({ ar: "عقد إيجار معدات — كيان", en: "Equipment rental contract — Kian" })}
          clauses={RENT_CLAUSES} agree={RENT_AGREE} signerName={renter.full_name}
          checked={signed} onChange={setSigned} />
        {err && <div className="text-red-400 text-xs">{err}</div>}
        <button type="button" onClick={() => void doRequest()} disabled={busy || readOnly}
          className="w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2.5">
          {busy ? t({ ar: "جارٍ الرفع والإرسال…", en: "Uploading & sending…" }) : t({ ar: "إرسال طلب التسليم", en: "Submit handover request" })}
        </button>
        <p className="text-[11px] text-stone-500">{t({ ar: "يُسلَّم بعد اعتماد إدارة كيان.", en: "Handover happens after Kian management approval." })}</p>
      </section>

      {/* My rentals */}
      <section>
        <SectionTitle icon="pkg">{t({ ar: "تأجيراتي", en: "My rentals" })}</SectionTitle>
        {records.length === 0 && <Empty>{t({ ar: "لا توجد تأجيرات بعد.", en: "No rentals yet." })}</Empty>}
        <div className="space-y-2.5">
          {records.map((rec) => (
            <RecordCard key={rec.id} record={rec} onChanged={() => void reload()}>
              {({ items: recItems }) => rec.status === "rented" ? (
                <ReturnPanel record={rec} items={recItems} busy={busy}
                  onSubmit={(a, o, s, n) => void doReturn(rec, a, o, s, n)} />
              ) : null}
            </RecordCard>
          ))}
        </div>
      </section>

      {toast && (
        <div className="fixed bottom-5 z-50 bg-black/90 border border-stone-700 rounded-xl px-4 py-2.5 text-sm text-white max-w-sm" style={{ insetInlineEnd: 20 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

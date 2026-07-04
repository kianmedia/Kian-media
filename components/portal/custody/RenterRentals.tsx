"use client";
// ════════════════════════════════════════════════════════════════════════
// External rental — registration gate (KYC renter_profiles row, mandatory
// before the rental tab opens) → rental request (per-item + overall photos +
// bilingual rental contract click-to-sign) → "my rentals" list with a return
// panel when status=rented. Handover approval + closure stay admin-only.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  getMyRenterProfile, upsertRenterProfile, listMyCustodyRecords, submitRentalRequest,
  submitReturn, uploadEvidence, evidencePath, newRecordId, emitCustodyEvent,
  type CustodyRecord, type RenterProfile,
} from "@/lib/portal/custody";
import {
  SectionTitle, Empty, RecordCard, ReturnPanel, ItemPhotoEditor, PhotoCapture,
  SignBlock, RENT_CLAUSES, RENT_AGREE,
} from "@/components/portal/custody/ui";

export default function RenterRentals() {
  const { t } = useI18n();
  const { profile, readOnly } = usePortal();
  const uid = profile.id;

  const [renter, setRenter] = useState<RenterProfile | null>(null);
  const [records, setRecords] = useState<CustodyRecord[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

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

  // ─── Rental request form ───
  const [items, setItems] = useState<{ name: string; qty: number; file: File | null; preview: string | null }[]>([]);
  const [overall, setOverall] = useState<{ file: File; preview: string } | null>(null);
  const [signed, setSigned] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doRequest() {
    setErr(null);
    if (readOnly || !renter) return;
    if (items.length === 0) { setErr(t({ ar: "أضف صنفاً واحداً على الأقل.", en: "Add at least one item." })); return; }
    if (items.some((i) => !i.file)) { setErr(t({ ar: "صوّر كل قطعة قبل الإرسال.", en: "Photograph every item first." })); return; }
    if (!overall) { setErr(t({ ar: "صوّر إجمالي المعدات قبل الإرسال.", en: "Capture the overall photo first." })); return; }
    if (!signed) { setErr(t({ ar: "أشّر على عقد الإيجار قبل الإرسال.", en: "Check the rental contract first." })); return; }

    setBusy(true);
    const recordId = newRecordId();
    const payload: { name: string; qty: number; photo_before_path: string }[] = [];
    for (let i = 0; i < items.length; i++) {
      const p = evidencePath(uid, recordId, "before", `item-${i}`);
      const up = await uploadEvidence(p, items[i].file as File);
      if (!up.ok) { setBusy(false); setErr(t({ ar: `تعذّر رفع صورة «${items[i].name}» — حاول مجددًا.`, en: `Couldn't upload the photo of "${items[i].name}" — retry.` })); return; }
      payload.push({ name: items[i].name, qty: items[i].qty, photo_before_path: p });
    }
    const overallPath = evidencePath(uid, recordId, "before", "overall");
    const upo = await uploadEvidence(overallPath, overall.file);
    if (!upo.ok) { setBusy(false); setErr(t({ ar: "تعذّر رفع الصورة الإجمالية — حاول مجددًا.", en: "Couldn't upload the overall photo — retry." })); return; }

    const r = await submitRentalRequest(recordId, payload, overallPath);
    setBusy(false);
    if (!r.ok) { setErr((t({ ar: "تعذّر إرسال الطلب: ", en: "Couldn't submit: " })) + r.error); return; }

    emitCustodyEvent({ event: "rental_request_new", record_id: recordId, record_no: r.data.record_no, kind: "rental", party_name: renter.full_name });
    setItems([]); setOverall(null); setSigned(false);
    await reload();
    flash(t({ ar: `استلمنا طلبك ${r.data.record_no} — سيراجعه فريق كيان قبل التسليم.`, en: `Request ${r.data.record_no} received — Kian will review before handover.` }));
  }

  async function doReturn(record: CustodyRecord, afters: Map<string, File>, overallFile: File, shortage: boolean, note: string) {
    setBusy(true);
    const after: { item_id: string; path: string }[] = [];
    for (const [itemId, file] of afters) {
      const p = evidencePath(uid, record.id, "after", `item-${itemId}`);
      const up = await uploadEvidence(p, file);
      if (!up.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع إحدى صور الإرجاع — حاول مجددًا.", en: "Couldn't upload a return photo — retry." })); return; }
      after.push({ item_id: itemId, path: p });
    }
    const overallPath = evidencePath(uid, record.id, "after", "overall");
    const upo = await uploadEvidence(overallPath, overallFile);
    if (!upo.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع الصورة الإجمالية — حاول مجددًا.", en: "Couldn't upload the overall photo — retry." })); return; }

    const r = await submitReturn(record.id, after, overallPath, shortage, note);
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

  const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";

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

      {/* Rental request */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
        <SectionTitle icon="pkg">{t({ ar: "تأجير المعدات", en: "Rent equipment" })}</SectionTitle>
        <div className="text-xs font-mono text-stone-500">
          {t({ ar: "المستأجر (من حسابك): ", en: "Renter (from your account): " })}{renter.full_name} • <span dir="ltr">{renter.phone}</span>
        </div>
        <ItemPhotoEditor items={items} setItems={(fn) => setItems(fn)} />
        <PhotoCapture label={t({ ar: "صورة إجمالي المعدات (بعد تصوير القطع)", en: "Overall equipment photo (after per-item shots)" })}
          preview={overall?.preview ?? null} onPick={(f) => setOverall({ file: f, preview: URL.createObjectURL(f) })} />
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
            <RecordCard key={rec.id} record={rec}>
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

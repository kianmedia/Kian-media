"use client";
// ════════════════════════════════════════════════════════════════════════
// Employee custody v2 — "my custody" list (+ return panel when status=out) and
// the checkout form. Evidence: UNLIMITED photos, minimum 2 per item + 2 overall
// at checkout AND at return. Name/phone auto-pulled from the profile.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  listMyCustodyRecords, submitCheckout, submitReturn, uploadEvidence, evidencePath,
  newRecordId, emitCustodyEvent, MIN_PHOTOS_PER_ITEM, MIN_PHOTOS_OVERALL,
  type CustodyRecord, type CheckoutItemInput,
} from "@/lib/portal/custody";
import {
  SectionTitle, Empty, RecordCard, ReturnPanel, ItemPhotoEditor, MultiPhotoCapture,
  SignBlock, CUSTODY_CLAUSES, CUSTODY_AGREE, type DraftItem, type ShotFile,
} from "@/components/portal/custody/ui";

export default function EmployeeCustody() {
  const { t } = useI18n();
  const { profile, readOnly } = usePortal();
  const uid = profile.id;
  const displayName = profile.full_name || profile.email || "";

  const [records, setRecords] = useState<CustodyRecord[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

  const reload = useCallback(async () => {
    const r = await listMyCustodyRecords("custody", uid);
    setRecords(r.ok ? r.data : []);
    setPhase(r.ok ? "ready" : "error");
  }, [uid]);
  useEffect(() => { void reload(); }, [reload]);

  // ─── Checkout form state ───
  const [items, setItems] = useState<DraftItem[]>([]);
  const [overall, setOverall] = useState<ShotFile[]>([]);
  const [signed, setSigned] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doCheckout() {
    setErr(null);
    if (readOnly) return;
    if (items.length === 0) { setErr(t({ ar: "أضف صنفاً واحداً على الأقل.", en: "Add at least one item." })); return; }
    if (items.some((i) => i.shots.length < MIN_PHOTOS_PER_ITEM)) {
      setErr(t({ ar: `صوّر كل قطعة (${MIN_PHOTOS_PER_ITEM} صور على الأقل لكل بند).`, en: `Min ${MIN_PHOTOS_PER_ITEM} photos per item.` })); return;
    }
    if (overall.length < MIN_PHOTOS_OVERALL) {
      setErr(t({ ar: `صوّر إجمالي المعدات (${MIN_PHOTOS_OVERALL} صور على الأقل).`, en: `Min ${MIN_PHOTOS_OVERALL} overall photos.` })); return;
    }
    if (!signed) { setErr(t({ ar: "أشّر على الإقرار قبل الإرسال.", en: "Check the acknowledgment first." })); return; }

    setBusy(true);
    const recordId = newRecordId();
    // 1) Upload ALL evidence photos (owner-first paths; storage RLS scopes to this user).
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

    // 2) Create the record (RPC validates paths+minimums, writes ack + notifies).
    const r = await submitCheckout(recordId, payload, overallPaths);
    setBusy(false);
    if (!r.ok) { setErr((t({ ar: "تعذّر تسجيل العهدة: ", en: "Couldn't record the checkout: " })) + r.error); return; }

    emitCustodyEvent({ event: "custody_checkout_new", record_id: recordId, record_no: r.data.record_no, kind: "custody", party_name: displayName });
    setItems([]); setOverall([]); setSigned(false);
    await reload();
    flash(t({ ar: `تم تسجيل عهدتك ${r.data.record_no} — أنت مسؤول عنها حتى الإقفال.`, en: `Custody ${r.data.record_no} recorded — you are responsible until closure.` }));
  }

  async function doReturn(record: CustodyRecord, afters: Map<string, File[]>, overallFiles: File[], shortage: boolean, note: string) {
    setBusy(true);
    const after: { item_id: string; photos: string[] }[] = [];
    for (const [itemId, files] of afters) {
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

  return (
    <div className="space-y-6">
      {/* My custody */}
      <section>
        <SectionTitle icon="user">{t({ ar: "عهدي الحالية", en: "My custody" })}</SectionTitle>
        {phase === "loading" && <p className="text-stone-500 text-sm">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
        {phase === "error" && <p className="text-red-400 text-sm">{t({ ar: "تعذّر التحميل — شغّل ترحيل قاعدة البيانات أولاً.", en: "Couldn't load — run the DB migration first." })}</p>}
        {phase === "ready" && records.length === 0 && <Empty>{t({ ar: "لا توجد عهدة مسجّلة باسمك.", en: "No custody recorded in your name." })}</Empty>}
        <div className="space-y-2.5">
          {records.map((rec) => (
            <RecordCard key={rec.id} record={rec} onChanged={() => void reload()}>
              {({ items: recItems }) => rec.status === "out" ? (
                <ReturnPanel record={rec} items={recItems} busy={busy}
                  onSubmit={(a, o, s, n) => void doReturn(rec, a, o, s, n)} />
              ) : null}
            </RecordCard>
          ))}
        </div>
      </section>

      {/* Checkout form */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
        <SectionTitle icon="camera">{t({ ar: "طلب خروج عدة", en: "Equipment checkout" })}</SectionTitle>
        <div className="text-xs font-mono text-stone-500">
          {t({ ar: "العهدة باسم (من حسابك): ", en: "Custody in the name of (from your account): " })}
          {displayName}{profile.mobile ? <> • <span dir="ltr">{profile.mobile}</span></> : null}
        </div>
        <ItemPhotoEditor items={items} setItems={(fn) => setItems(fn)} />
        <MultiPhotoCapture label={t({ ar: "صور إجمالي المعدات (بعد تصوير القطع)", en: "Overall equipment photos (after per-item shots)" })}
          shots={overall}
          onAdd={(f) => setOverall((p) => [...p, { file: f, preview: URL.createObjectURL(f) }])}
          onRemove={(i) => setOverall((p) => p.filter((_, k) => k !== i))} />
        <SignBlock title={t({ ar: "إقرار استلام عهدة", en: "Custody acknowledgment" })}
          clauses={CUSTODY_CLAUSES} agree={CUSTODY_AGREE} signerName={displayName}
          checked={signed} onChange={setSigned} />
        {err && <div className="text-red-400 text-xs">{err}</div>}
        <button type="button" onClick={() => void doCheckout()} disabled={busy || readOnly}
          className="w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2.5">
          {busy ? t({ ar: "جارٍ الرفع والتسجيل…", en: "Uploading & recording…" }) : t({ ar: "إرسال خروج العدة", en: "Submit checkout" })}
        </button>
      </section>

      {toast && (
        <div className="fixed bottom-5 z-50 bg-black/90 border border-stone-700 rounded-xl px-4 py-2.5 text-sm text-white max-w-sm" style={{ insetInlineEnd: 20 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

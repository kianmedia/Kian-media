"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin custody console — urgent alerts (shortage returns), the action queue
// (review_handover / review_return, shortage first), and all records. Approve /
// close / reject / note are RPC-enforced admin-only (can_manage_custody); the
// UI gate here is cosmetic. One page = the full report per record.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  listAllCustodyRecords, listRenterProfilesFor, adminApproveHandover, adminCloseCustody,
  adminRejectCustody, adminAddCustodyNote, emitCustodyEvent,
  type CustodyRecord, type RenterProfile,
} from "@/lib/portal/custody";
import { SectionTitle, Empty, RecordCard } from "@/components/portal/custody/ui";

function AdminActions({ record, busy, onApprove, onClose, onReject, onNote }: {
  record: CustodyRecord; busy: boolean;
  onApprove: () => void; onClose: () => void; onReject: (note: string) => void; onNote: (note: string) => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const primaryIsApprove = record.status === "review_handover";
  return (
    <div className="mt-3 border-t border-stone-800 pt-3 space-y-2">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
        placeholder={t({ ar: "ملاحظة للمستلِم (اختياري)", en: "Note to the party (optional)" })}
        className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500" />
      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={busy}
          onClick={() => (primaryIsApprove ? onApprove() : onClose())}
          className="flex-1 min-w-[140px] rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2">
          {primaryIsApprove ? t({ ar: "اعتماد التسليم", en: "Approve handover" }) : t({ ar: "إقفال العهدة", en: "Close custody" })}
        </button>
        <button type="button" disabled={busy || !note.trim()} onClick={() => { onNote(note.trim()); setNote(""); }}
          className="rounded-lg bg-stone-800 border border-stone-700 disabled:opacity-50 text-stone-200 text-sm px-3 py-2">
          {t({ ar: "إضافة ملاحظة", en: "Add note" })}
        </button>
        {primaryIsApprove && (
          <button type="button" disabled={busy} onClick={() => { onReject(note.trim()); setNote(""); }}
            className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-sm px-3 py-2 disabled:opacity-50">
            {t({ ar: "رفض", en: "Reject" })}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminCustodyConsole() {
  const { t } = useI18n();
  const [records, setRecords] = useState<CustodyRecord[]>([]);
  const [renters, setRenters] = useState<Record<string, RenterProfile>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

  const reload = useCallback(async () => {
    const r = await listAllCustodyRecords();
    if (!r.ok) { setPhase("error"); return; }
    setRecords(r.data);
    const renterIds = Array.from(new Set(r.data.filter((x) => x.kind === "rental").map((x) => x.party_user_id)));
    const rp = await listRenterProfilesFor(renterIds);
    if (rp.ok) {
      const map: Record<string, RenterProfile> = {};
      rp.data.forEach((p) => { map[p.user_id] = p; });
      setRenters(map);
    }
    setPhase("ready");
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const pending = useMemo(() =>
    records.filter((r) => r.status === "review_handover" || r.status === "review_return")
      .sort((a, b) => Number(b.shortage) - Number(a.shortage)), [records]);
  const urgent = useMemo(() => records.filter((r) => r.shortage && r.status === "review_return"), [records]);

  async function act(rec: CustodyRecord, kind: "approve" | "close" | "reject" | "note", note = "") {
    setBusy(true);
    const r = kind === "approve" ? await adminApproveHandover(rec.id)
      : kind === "close" ? await adminCloseCustody(rec.id)
      : kind === "reject" ? await adminRejectCustody(rec.id, note)
      : await adminAddCustodyNote(rec.id, note);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    emitCustodyEvent({
      event: kind === "approve" ? "custody_handover_approved"
        : kind === "close" ? "custody_closed"
        : kind === "reject" ? "custody_rejected" : "custody_note_new",
      record_id: rec.id, record_no: rec.record_no, kind: rec.kind, party_name: rec.party_name,
    });
    await reload();
    flash(kind === "approve" ? t({ ar: "تم اعتماد التسليم.", en: "Handover approved." })
      : kind === "close" ? t({ ar: "أُقفل السجل.", en: "Record closed." })
      : kind === "reject" ? t({ ar: "رُفض الطلب.", en: "Request rejected." })
      : t({ ar: "أُضيفت الملاحظة.", en: "Note added." }));
  }

  if (phase === "loading") return <p className="text-stone-500 text-sm">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return <p className="text-red-400 text-sm">{t({ ar: "تعذّر التحميل — شغّل ترحيل قاعدة البيانات أولاً.", en: "Couldn't load — run the DB migration first." })}</p>;

  return (
    <div className="space-y-6">
      {/* Urgent alerts */}
      {urgent.length > 0 && (
        <div className="bg-red-950 border border-red-700 rounded-xl p-3.5 space-y-1.5">
          <div className="flex items-center gap-2 text-red-300 text-sm font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            {t({ ar: "بلاغات نقص/تلف تحتاج إجراءك", en: "Shortage/damage reports needing action" })}
          </div>
          {urgent.map((r) => (
            <div key={r.id} className="text-xs text-red-200 font-mono">
              <span dir="ltr">{r.record_no}</span> — {r.shortage_note} ({r.party_name})
            </div>
          ))}
        </div>
      )}

      {/* Action queue */}
      <section>
        <SectionTitle icon="clock">
          {t({ ar: "بانتظار إجرائك", en: "Awaiting your action" })}
          <span className="text-stone-500 text-xs font-normal"> ({pending.length})</span>
        </SectionTitle>
        {pending.length === 0 && <Empty>{t({ ar: "لا توجد سجلات بانتظار إجراء.", en: "Nothing awaiting action." })}</Empty>}
        <div className="space-y-2.5">
          {pending.map((rec) => (
            <RecordCard key={rec.id} record={rec} defaultOpen
              renterInfo={rec.kind === "rental" ? renters[rec.party_user_id] ?? null : null}>
              {() => (
                <AdminActions record={rec} busy={busy}
                  onApprove={() => void act(rec, "approve")}
                  onClose={() => void act(rec, "close")}
                  onReject={(n) => void act(rec, "reject", n)}
                  onNote={(n) => void act(rec, "note", n)} />
              )}
            </RecordCard>
          ))}
        </div>
      </section>

      {/* All records */}
      <section>
        <SectionTitle icon="pkg">
          {t({ ar: "كل السجلات", en: "All records" })}
          <span className="text-stone-500 text-xs font-normal"> ({records.length})</span>
        </SectionTitle>
        {records.length === 0 && <Empty>{t({ ar: "لا توجد سجلات بعد.", en: "No records yet." })}</Empty>}
        <div className="space-y-2.5">
          {records.map((rec) => (
            <RecordCard key={rec.id} record={rec}
              renterInfo={rec.kind === "rental" ? renters[rec.party_user_id] ?? null : null}>
              {() => (rec.status === "review_handover" || rec.status === "review_return") ? (
                <AdminActions record={rec} busy={busy}
                  onApprove={() => void act(rec, "approve")}
                  onClose={() => void act(rec, "close")}
                  onReject={(n) => void act(rec, "reject", n)}
                  onNote={(n) => void act(rec, "note", n)} />
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

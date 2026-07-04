"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin custody console v2 — urgent alerts, action queue (shortage first), all
// records. Actions: approve handover / close / reject request / REJECT CLOSURE
// with a financial claim (مطالبة → تعهد بالسداد → سند) / add note (works on ANY
// record) / soft-delete (owner-tier only). All RPC-enforced; UI gate cosmetic.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  listAllCustodyRecords, listRenterProfilesFor, adminApproveHandover, adminCloseCustody,
  adminRejectCustody, adminAddCustodyNote, adminRejectClosure, adminDeleteCustodyRecord,
  emitCustodyEvent, type CustodyRecord, type RenterProfile,
} from "@/lib/portal/custody";
import { SectionTitle, Empty, RecordCard } from "@/components/portal/custody/ui";

function AlertIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>;
}

function AdminActions({ record, busy, canDelete, onApprove, onClose, onReject, onRejectClosure, onNote, onDelete }: {
  record: CustodyRecord; busy: boolean; canDelete: boolean;
  onApprove: () => void; onClose: () => void; onReject: (note: string) => void;
  onRejectClosure: (amount: number, note: string) => void;
  onNote: (note: string) => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimAmount, setClaimAmount] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const isHandover = record.status === "review_handover";
  const isReturn = record.status === "review_return";
  const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";

  return (
    <div className="mt-3 border-t border-stone-800 pt-3 space-y-2">
      {/* Note — works on ANY record */}
      <div className="flex gap-2 items-start">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder={t({ ar: "ملاحظة للمستلِم…", en: "Note to the party…" })} className={inp} />
        <button type="button" disabled={busy}
          onClick={() => {
            if (!note.trim()) { setErr(t({ ar: "اكتب الملاحظة أولاً.", en: "Write the note first." })); return; }
            setErr(null); onNote(note.trim()); setNote("");
          }}
          className="rounded-lg bg-stone-800 border border-stone-700 disabled:opacity-50 text-stone-200 text-sm px-3 py-2 whitespace-nowrap">
          {t({ ar: "إضافة ملاحظة", en: "Add note" })}
        </button>
      </div>

      {/* Contextual primary actions */}
      {(isHandover || isReturn) && (
        <div className="flex gap-2 flex-wrap">
          {isHandover && (
            <>
              <button type="button" disabled={busy} onClick={onApprove}
                className="flex-1 min-w-[140px] rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2">
                {t({ ar: "اعتماد التسليم", en: "Approve handover" })}
              </button>
              <button type="button" disabled={busy} onClick={() => { onReject(note.trim()); setNote(""); }}
                className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-sm px-3 py-2 disabled:opacity-50">
                {t({ ar: "رفض الطلب", en: "Reject request" })}
              </button>
            </>
          )}
          {isReturn && (
            <>
              <button type="button" disabled={busy} onClick={onClose}
                className="flex-1 min-w-[140px] rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2">
                {t({ ar: "إقفال العهدة", en: "Close custody" })}
              </button>
              <button type="button" disabled={busy} onClick={() => setClaimOpen((v) => !v)}
                className={`rounded-lg text-sm px-3 py-2 disabled:opacity-50 border ${claimOpen ? "bg-red-950 border-red-600 text-red-200" : "bg-stone-900 border-red-900 text-red-400"}`}>
                {t({ ar: "رفض الإقفال — مطالبة", en: "Reject closure — claim" })}
              </button>
            </>
          )}
        </div>
      )}

      {/* Financial claim (رفض إقفال العهدة) */}
      {isReturn && claimOpen && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-3 space-y-2">
          <div className="text-xs text-red-200 font-medium">
            {t({ ar: "المطالبة المالية / التعويض المطلوب من المستلم", en: "Financial claim / required compensation" })}
          </div>
          <input value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} type="number" min={1} step="0.01" dir="ltr"
            placeholder={t({ ar: "مبلغ التعويض (ر.س)", en: "Compensation amount (SAR)" })} className={inp} />
          <textarea value={claimNote} onChange={(e) => setClaimNote(e.target.value)} rows={2}
            placeholder={t({ ar: "سبب المطالبة (نقص/تلف…) — يظهر في السند", en: "Claim reason — appears on the bond" })} className={inp} />
          <div className="text-[10.5px] text-red-200/70">
            {t({ ar: "بعد التسجيل يُطلب من المستلم التعهد بالسداد إلكترونياً، ويصدر سند بالمبلغ لصالح شركة كيان الابتكار المتميز للإنتاج الفني.",
                 en: "The party must then e-sign a payment pledge; a bond for the amount is issued in favor of Kian Al-Ebtikar Al-Mutamayz for Artistic Production." })}
          </div>
          <button type="button" disabled={busy}
            onClick={() => {
              const amt = Number(claimAmount);
              if (!amt || amt <= 0) { setErr(t({ ar: "أدخل مبلغ تعويض صحيحًا.", en: "Enter a valid amount." })); return; }
              setErr(null); onRejectClosure(amt, claimNote.trim()); setClaimOpen(false); setClaimAmount(""); setClaimNote("");
            }}
            className="w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2">
            {t({ ar: "تسجيل المطالبة ورفض الإقفال", en: "Record the claim & reject closure" })}
          </button>
        </div>
      )}

      {err && <div className="text-red-400 text-xs">{err}</div>}

      {/* Owner-only delete */}
      {canDelete && (
        <div className="pt-1">
          <button type="button" disabled={busy}
            onClick={() => { if (window.confirm(t({ ar: `حذف السجل ${record.record_no} نهائياً من النظام؟`, en: `Delete record ${record.record_no} from the system?` }))) onDelete(); }}
            className="text-[11px] text-stone-500 hover:text-red-400 underline">
            {t({ ar: "حذف السجل (للمالك فقط)", en: "Delete record (owner only)" })}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminCustodyConsole() {
  const { t } = useI18n();
  const { caps } = usePortal();
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
    records.filter((r) => ["review_handover", "review_return", "claim_pending"].includes(r.status))
      .sort((a, b) => Number(b.shortage) - Number(a.shortage)), [records]);
  const urgent = useMemo(() => records.filter((r) => r.shortage && (r.status === "review_return" || r.status === "claim_pending")), [records]);

  async function act(rec: CustodyRecord, kind: "approve" | "close" | "reject" | "note" | "reject_closure" | "delete",
    note = "", amount = 0) {
    setBusy(true);
    const r = kind === "approve" ? await adminApproveHandover(rec.id)
      : kind === "close" ? await adminCloseCustody(rec.id)
      : kind === "reject" ? await adminRejectCustody(rec.id, note)
      : kind === "reject_closure" ? await adminRejectClosure(rec.id, amount, note)
      : kind === "delete" ? await adminDeleteCustodyRecord(rec.id, note)
      : await adminAddCustodyNote(rec.id, note);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    if (kind !== "delete") {
      emitCustodyEvent({
        event: kind === "approve" ? "custody_handover_approved"
          : kind === "close" ? "custody_closed"
          : kind === "reject" ? "custody_rejected"
          : kind === "reject_closure" ? "custody_claim_pending" : "custody_note_new",
        record_id: rec.id, record_no: rec.record_no, kind: rec.kind, party_name: rec.party_name,
        urgent: kind === "reject_closure", amount: kind === "reject_closure" ? amount : undefined,
      });
    }
    await reload();
    flash(kind === "approve" ? t({ ar: "تم اعتماد التسليم.", en: "Handover approved." })
      : kind === "close" ? t({ ar: "أُقفل السجل.", en: "Record closed." })
      : kind === "reject" ? t({ ar: "رُفض الطلب.", en: "Request rejected." })
      : kind === "reject_closure" ? t({ ar: "سُجّلت المطالبة — بانتظار تعهد المستلم بالسداد.", en: "Claim recorded — awaiting the party's pledge." })
      : kind === "delete" ? t({ ar: "حُذف السجل.", en: "Record deleted." })
      : t({ ar: "أُضيفت الملاحظة.", en: "Note added." }));
  }

  if (phase === "loading") return <p className="text-stone-500 text-sm">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return <p className="text-red-400 text-sm">{t({ ar: "تعذّر التحميل — شغّل ترحيل قاعدة البيانات أولاً.", en: "Couldn't load — run the DB migration first." })}</p>;

  const renderActions = (rec: CustodyRecord) => (
    <AdminActions record={rec} busy={busy} canDelete={caps.isOwner}
      onApprove={() => void act(rec, "approve")}
      onClose={() => void act(rec, "close")}
      onReject={(n) => void act(rec, "reject", n)}
      onRejectClosure={(amt, n) => void act(rec, "reject_closure", n, amt)}
      onNote={(n) => void act(rec, "note", n)}
      onDelete={() => void act(rec, "delete", "")} />
  );

  return (
    <div className="space-y-6">
      {urgent.length > 0 && (
        <div className="bg-red-950 border border-red-700 rounded-xl p-3.5 space-y-1.5">
          <div className="flex items-center gap-2 text-red-300 text-sm font-medium">
            <AlertIcon />{t({ ar: "بلاغات نقص/تلف تحتاج إجراءك", en: "Shortage/damage reports needing action" })}
          </div>
          {urgent.map((r) => (
            <div key={r.id} className="text-xs text-red-200 font-mono">
              <span dir="ltr">{r.record_no}</span> — {r.shortage_note} ({r.party_name})
            </div>
          ))}
        </div>
      )}

      <section>
        <SectionTitle icon="clock">
          {t({ ar: "بانتظار إجرائك", en: "Awaiting your action" })}
          <span className="text-stone-500 text-xs font-normal"> ({pending.length})</span>
        </SectionTitle>
        {pending.length === 0 && <Empty>{t({ ar: "لا توجد سجلات بانتظار إجراء.", en: "Nothing awaiting action." })}</Empty>}
        <div className="space-y-2.5">
          {pending.map((rec) => (
            <RecordCard key={rec.id} record={rec} defaultOpen onChanged={() => void reload()}
              renterInfo={rec.kind === "rental" ? renters[rec.party_user_id] ?? null : null}>
              {() => renderActions(rec)}
            </RecordCard>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle icon="pkg">
          {t({ ar: "كل السجلات", en: "All records" })}
          <span className="text-stone-500 text-xs font-normal"> ({records.length})</span>
        </SectionTitle>
        {records.length === 0 && <Empty>{t({ ar: "لا توجد سجلات بعد.", en: "No records yet." })}</Empty>}
        <div className="space-y-2.5">
          {records.map((rec) => (
            <RecordCard key={rec.id} record={rec} onChanged={() => void reload()}
              renterInfo={rec.kind === "rental" ? renters[rec.party_user_id] ?? null : null}>
              {() => renderActions(rec)}
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

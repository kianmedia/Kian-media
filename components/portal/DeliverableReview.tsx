"use client";
// ════════════════════════════════════════════════════════════════════════
// Client deliverable review (S6-lite). Status-driven: the CURRENT deliverable
// status is the single source of truth for what the owner can do — old review
// records never gate the controls.
//   client_review      → Approve + Request Revision + note (project owner only)
//   revision_requested → no actions; show the submitted note, awaiting Kian
//   approved           → no actions; approved state
//   final_delivered    → no actions; final-delivered state
// Each item also has a watermarked preview (never a download). A "refresh"
// control re-pulls data so a deliverable the admin just returned to review
// reopens its controls without a full page reload (there is no realtime sync).
//
// Controlled: deliverables + reviews are fetched by the parent page; after a
// decision (or refresh) we call onChanged() so the page refetches and the
// summary cards + latest note stay in sync.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { paymentCleared, downloadState, confirmFinalReceipt, deliverableReceipt, type DownloadState, type ReceiptState } from "@/lib/portal/deliverables";
import { getValidSession } from "@/lib/portalAuth";
import { canApprove } from "@/lib/portal/projects";
import { DLV_STATUS_LABELS } from "@/components/portal/projectMeta";
import VersionHistory from "@/components/portal/VersionHistory";
import type { Deliverable, DeliverableReview as Review } from "@/lib/portal/types";

const CLIENT_VISIBLE = ["client_review", "revision_requested", "approved", "final_delivered"];

export default function DeliverableReview({
  projectId, projectName, items, reviews, onChanged,
}: { projectId: string; projectName: string; items: Deliverable[]; reviews: Review[]; onChanged: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [owner, setOwner] = useState(false);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paid, setPaid] = useState<boolean | null>(null);   // all-dues-received (project-level)
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [dlStates, setDlStates] = useState<Record<string, DownloadState>>({});

  const finalIds = items.filter((d) => d.status === "final_delivered").map((d) => d.id).join(",");
  useEffect(() => {
    let alive = true;
    (async () => { const c = await canApprove(projectId); if (alive) setOwner(c); })();
    (async () => { const r = await paymentCleared(projectId); if (alive && r.ok) setPaid(r.data); })();
    // Per-deliverable honest download state (remaining / expiry / reason).
    (async () => {
      for (const id of finalIds ? finalIds.split(",") : []) {
        const r = await downloadState(id);
        if (alive && r.ok) setDlStates((s) => ({ ...s, [id]: r.data }));
      }
    })();
    return () => { alive = false; };
  }, [projectId, finalIds]);

  // Route through the server endpoint: it enforces the gate + logs (via
  // client_download_deliverable as the user) and returns a SHORT-LIVED signed URL
  // for storage-backed finals (never a permanent public URL). 403 → gate shut.
  async function download(d: Deliverable) {
    setDlBusy(d.id); setFlash(null);
    try {
      const s = await getValidSession();
      if (!s) { setFlash({ id: d.id, kind: "err", text: t({ ar: "انتهت الجلسة — أعد تسجيل الدخول.", en: "Session expired — sign in again." }) }); setDlBusy(null); return; }
      const res = await fetch("/api/portal/deliverable-download", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ deliverableId: d.id }),
      });
      setDlBusy(null);
      if (res.status === 403) { setFlash({ id: d.id, kind: "err", text: t({ ar: "التنزيل مقفول حتى تأكيد استلام الدفعة.", en: "Download is locked until payment is confirmed." }) }); return; }
      if (!res.ok) { setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر التنزيل.", en: "Download failed." }) }); return; }
      const j = (await res.json()) as { url?: string };
      if (j.url) window.open(j.url, "_blank", "noopener,noreferrer");
    } catch { setDlBusy(null); setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر التنزيل.", en: "Download failed." }) }); }
  }

  // RLS already scopes a client to these states; filter defensively.
  const visible = items.filter((d) => CLIENT_VISIBLE.includes(d.status));
  // reviews arrive newest-first; first match per deliverable is the latest.
  const latestReview = (deliverableId: string) => reviews.find((r) => r.deliverable_id === deliverableId);

  async function refresh() {
    setRefreshing(true);
    try { await onChanged(); } finally { setRefreshing(false); }
  }


  if (visible.length === 0) return (
    <div>
      <RefreshBar onClick={refresh} busy={refreshing} t={t} />
      <P>{t({ ar: "لا توجد مخرجات جاهزة للمراجعة حالياً.", en: "No deliverables ready for review yet." })}</P>
    </div>
  );

  return (
    <div>
      <RefreshBar onClick={refresh} busy={refreshing} t={t} />
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {visible.map((d) => {
          const dl = DLV_STATUS_LABELS[d.status] ?? { ar: d.status, en: d.status };
          const note = latestReview(d.id)?.comments?.trim();
          return (
            <div key={d.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "18px" }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-white" style={{ fontSize: "15px", fontWeight: 700 }}>{d.title}</div>
                  <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginTop: "3px" }}>{d.type} · v{d.version}</div>
                </div>
                <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "6px 11px", borderRadius: "2px", whiteSpace: "nowrap" }}>{t(dl)}</span>
              </div>

              {/* Review-only notice (only while still a preview, not after final delivery) */}
              {d.status !== "final_delivered" && (
                <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,210,138,0.85)", lineHeight: 1.6, marginBottom: "12px" }}>
                  {t({ ar: "هذه نسخة معاينة للمراجعة فقط، ولا تُعد نسخة نهائية للتسليم.", en: "This is a preview copy for review only and is not the final delivery file." })}
                </p>
              )}

              {/* §2/§3 — version lineage: preview each version (watermarked, no
                  download), review the CURRENT version, and comment/annotate. */}
              <VersionHistory deliverable={d} mode="client" owner={owner} canReview={owner} onChanged={onChanged} stamp={{ projectName }} />

              {/* client_review + not owner → explain who can act */}
              {!owner && d.status === "client_review" && (
                <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6, marginTop: "8px" }}>
                  {t({ ar: "الاعتماد وطلب التعديل متاحان لمالك حساب العميل فقط.", en: "Approve / request revision is available to the client account owner only." })}
                </p>
              )}

              {/* revision_requested → no actions; show the submitted note, awaiting Kian */}
              {d.status === "revision_requested" && (
                <StateBox tone="warn">
                  <div style={{ fontWeight: 600, marginBottom: note ? "6px" : 0 }}>{t({ ar: "تم إرسال طلب التعديل — بانتظار تحديث من كيان.", en: "Revision requested — awaiting an update from Kian." })}</div>
                  {note && <div style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>{t({ ar: "ملاحظتك: ", en: "Your note: " })}{note}</div>}
                </StateBox>
              )}

              {/* approved → no actions; approved state */}
              {d.status === "approved" && (
                <StateBox tone="ok">
                  <div style={{ fontWeight: 600 }}>{t({ ar: "تم اعتماد هذا المخرَج.", en: "This deliverable is approved." })}</div>
                  {note && <div style={{ whiteSpace: "pre-wrap", opacity: 0.9, marginTop: "6px" }}>{t({ ar: "ملاحظتك: ", en: "Your note: " })}{note}</div>}
                </StateBox>
              )}

              {/* final_delivered → download unlocked ONLY when the server gate is
                  satisfied (dues cleared + release window not expired + under limit) */}
              {d.status === "final_delivered" && (
                <StateBox tone="ok">
                  <div style={{ fontWeight: 600, marginBottom: "8px" }}>{t({ ar: "تم تسليم النسخة النهائية.", en: "Final version delivered." })}</div>
                  <FinalDownload d={d} dlState={dlStates[d.id]} busy={dlBusy === d.id} onDownload={() => download(d)} t={t} />
                  {owner && <ReceiptConfirm deliverableId={d.id} t={t} />}
                </StateBox>
              )}

              {flash && flash.id === d.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
            </div>
          );
        })}
      </div>

    </div>
  );
}

// P0-1: explicit client receipt confirmation of the final files. Shown to the
// client account owner once the deliverable is final_delivered. Stores received_at
// + client identity (server-side) and notifies Admin/Owner. Idempotent.
function ReceiptConfirm({ deliverableId, t }: { deliverableId: string; t: (m: { ar: string; en: string }) => string }) {
  const [state, setState] = useState<ReceiptState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { let alive = true; void deliverableReceipt(deliverableId).then((r) => { if (alive && r.ok) setState(r.data); }); return () => { alive = false; }; }, [deliverableId]);
  async function submit() {
    if (busy) return; setBusy(true);
    const r = await confirmFinalReceipt(deliverableId, name.trim() || undefined);
    setBusy(false);
    if (r.ok) { setConfirming(false); const s = await deliverableReceipt(deliverableId); if (s.ok) setState(s.data); }
  }
  if (state?.confirmed) {
    return (
      <div className="f-sans" style={{ fontSize: "11.5px", color: "#7CFC9A", marginTop: "10px", lineHeight: 1.6 }}>
        ✓ {t({ ar: "تم تأكيد استلام الملفات النهائية", en: "Final files receipt confirmed" })}
        {state.received_at && <span dir="ltr" style={{ color: "rgba(255,255,255,0.5)" }}> · {new Date(state.received_at).toLocaleString("en-GB")}</span>}
      </div>
    );
  }
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="f-sans" style={{ marginTop: "10px", fontSize: "12px", color: "#fff", background: "rgba(124,252,154,0.14)", border: "1px solid rgba(124,252,154,0.4)", borderRadius: "4px", padding: "8px 12px", cursor: "pointer" }}>
        {t({ ar: "تأكيد استلام الملفات النهائية", en: "Confirm receipt of final files" })}
      </button>
    );
  }
  return (
    <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t({ ar: "اسمك (اختياري)", en: "Your name (optional)" })} className="f-sans" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "3px", padding: "8px 10px", color: "#fff", fontSize: "12.5px", outline: "none" }} />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-red" style={{ opacity: busy ? 0.6 : 1 }}>{busy ? "..." : t({ ar: "أؤكّد الاستلام", en: "I confirm receipt" })}</button>
        <button onClick={() => setConfirming(false)} disabled={busy} className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", background: "none", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "4px", padding: "0 12px", cursor: "pointer" }}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
      </div>
    </div>
  );
}

// Final-download control with honest state: button only when allowed; otherwise
// the exact reason (payment pending / window expired / limit reached).
function FinalDownload({ dlState, busy, onDownload, t }: {
  d: Deliverable; dlState?: DownloadState; busy: boolean; onDownload: () => void; t: (m: { ar: string; en: string }) => string;
}) {
  const reasonMsg: Record<string, { ar: string; en: string }> = {
    payment_pending: { ar: "سيتاح التنزيل بعد تأكيد استلام الدفعة.", en: "Available after payment is confirmed." },
    window_expired: { ar: "انتهت مدة إتاحة التنزيل — تواصل مع كيان لإعادة الفتح.", en: "The download window has expired — contact Kian to reopen." },
    limit_reached: { ar: "استنفدت عدد مرات التنزيل المسموح بها.", en: "You've reached the allowed number of downloads." },
    not_final: { ar: "لم تُسلَّم النسخة النهائية بعد.", en: "Not final-delivered yet." },
  };
  if (!dlState) return <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>{t({ ar: "…", en: "…" })}</div>;
  if (!dlState.allowed) return <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,210,138,0.9)", lineHeight: 1.6 }}>{t(reasonMsg[dlState.reason] ?? reasonMsg.payment_pending)}</div>;
  return (
    <div>
      <button onClick={onDownload} disabled={busy} className="btn-red" style={{ justifyContent: "center", opacity: busy ? 0.6 : 1 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginInlineEnd: "6px" }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
        <span>{busy ? "..." : t({ ar: "تنزيل النسخة النهائية", en: "Download final file" })}</span>
      </button>
      {(dlState.remaining != null || dlState.expires_at) && (
        <div className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.45)", marginTop: "6px", lineHeight: 1.6 }}>
          {dlState.remaining != null && <span dir="ltr">{t({ ar: "المتبقٍّ", en: "Remaining" })}: {dlState.remaining} </span>}
          {dlState.expires_at && <span dir="ltr"> · {t({ ar: "ينتهي", en: "Expires" })}: {new Date(dlState.expires_at).toLocaleString("en-GB")}</span>}
        </div>
      )}
    </div>
  );
}

function RefreshBar({ onClick, busy, t }: { onClick: () => void; busy: boolean; t: (m: { ar: string; en: string }) => string }) {
  return (
    <div className="flex justify-end" style={{ marginBottom: "12px" }}>
      <button onClick={onClick} disabled={busy} className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.7)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "7px 12px", borderRadius: "3px", cursor: busy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: busy ? 0.5 : 1 }}><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>
        <span>{busy ? t({ ar: "جارٍ التحديث...", en: "Refreshing..." }) : t({ ar: "تحديث الحالة", en: "Refresh status" })}</span>
      </button>
    </div>
  );
}

function StateBox({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  const c = tone === "ok"
    ? { color: "#7CFC9A", bg: "rgba(124,252,154,0.06)", bd: "rgba(124,252,154,0.25)" }
    : { color: "rgba(255,210,138,0.95)", bg: "rgba(255,210,138,0.06)", bd: "rgba(255,210,138,0.3)" };
  return (
    <div className="f-sans" style={{ fontSize: "12.5px", lineHeight: 1.6, color: c.color, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: "3px", padding: "11px 13px" }}>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-white/45" style={{ fontSize: "13.5px", lineHeight: 1.7 }}>{children}</p>;
}

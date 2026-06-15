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
import { usePortal } from "@/components/portal/PortalShell";
import { submitReview } from "@/lib/portal/deliverables";
import { canApprove } from "@/lib/portal/projects";
import { notifyReviewUpdate } from "@/lib/portal/notifyEmail";
import { DLV_STATUS_LABELS } from "@/components/portal/projectMeta";
import PreviewModal from "@/components/portal/PreviewModal";
import type { Deliverable, DeliverableReview as Review } from "@/lib/portal/types";

const CLIENT_VISIBLE = ["client_review", "revision_requested", "approved", "final_delivered"];

export default function DeliverableReview({
  projectId, projectName, items, reviews, onChanged,
}: { projectId: string; projectName: string; items: Deliverable[]; reviews: Review[]; onChanged: () => void | Promise<void> }) {
  const { t } = useI18n();
  const { profile } = usePortal();
  const [owner, setOwner] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [reviseNote, setReviseNote] = useState("");
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => { const c = await canApprove(projectId); if (alive) setOwner(c); })();
    return () => { alive = false; };
  }, [projectId]);

  // RLS already scopes a client to these states; filter defensively.
  const visible = items.filter((d) => CLIENT_VISIBLE.includes(d.status));
  // reviews arrive newest-first; first match per deliverable is the latest.
  const latestReview = (deliverableId: string) => reviews.find((r) => r.deliverable_id === deliverableId);

  async function refresh() {
    setRefreshing(true);
    try { await onChanged(); } finally { setRefreshing(false); }
  }

  async function decide(d: Deliverable, decision: "approved" | "revision_requested", note?: string) {
    setBusyId(d.id); setFlash(null);
    const r = await submitReview(d.id, decision, note);
    setBusyId(null);
    if (!r.ok) { setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر الإرسال: ", en: "Failed: " }) + r.error }); return; }
    // Email Kian/admins that the client reviewed (best-effort; never blocks the UI).
    void notifyReviewUpdate({
      projectId, projectName, deliverableTitle: d.title, action: decision, note,
      clientName: profile.full_name, clientEmail: profile.email,
    });
    setReviseFor(null); setReviseNote("");
    setFlash({ id: d.id, kind: "ok", text: decision === "approved" ? t({ ar: "تم الاعتماد ✓", en: "Approved ✓" }) : t({ ar: "تم إرسال طلب التعديل ✓", en: "Revision requested ✓" }) });
    onChanged();
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
          const url = d.vimeo_review_url || d.preview_url;
          const canReview = owner && d.status === "client_review";
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

              {/* View preview (opens in-portal modal with watermark) — never a download */}
              <button onClick={() => setPreview({ title: d.title, url })} className="btn-red" style={{ justifyContent: "center", marginBottom: canReview ? "14px" : "0" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginInlineEnd: "6px" }}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
                <span>{t({ ar: "عرض المعاينة", en: "View Preview" })}</span>
              </button>

              {/* client_review + owner → Approve / Request Revision */}
              {canReview && (
                reviseFor === d.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <textarea value={reviseNote} onChange={(e) => setReviseNote(e.target.value)} rows={3} maxLength={4000}
                      placeholder={t({ ar: "صف التعديلات المطلوبة...", en: "Describe the changes needed..." })}
                      style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "11px 13px", color: "#fff", fontSize: "13.5px", fontFamily: "var(--sans)", outline: "none", resize: "vertical", lineHeight: 1.6, colorScheme: "dark" }} />
                    <div className="flex gap-3">
                      <button onClick={() => decide(d, "revision_requested", reviseNote.trim() || undefined)} disabled={busyId === d.id} className="btn-red" style={{ justifyContent: "center", opacity: busyId === d.id ? 0.6 : 1 }}>
                        <span>{busyId === d.id ? "..." : t({ ar: "إرسال طلب التعديل", en: "Send Revision Request" })}</span>
                      </button>
                      <button onClick={() => { setReviseFor(null); setReviseNote(""); }} className="btn-ghost" style={{ justifyContent: "center" }}><span>{t({ ar: "إلغاء", en: "Cancel" })}</span></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button onClick={() => decide(d, "approved")} disabled={busyId === d.id} className="btn-red" style={{ justifyContent: "center", flex: 1, opacity: busyId === d.id ? 0.6 : 1 }}>
                      <span>{busyId === d.id ? "..." : t({ ar: "اعتماد ✓", en: "Approve ✓" })}</span>
                    </button>
                    <button onClick={() => setReviseFor(d.id)} disabled={busyId === d.id} className="btn-ghost" style={{ justifyContent: "center", flex: 1 }}>
                      <span>{t({ ar: "طلب تعديل ↺", en: "Request Revision ↺" })}</span>
                    </button>
                  </div>
                )
              )}

              {/* client_review + not owner → explain who can act */}
              {!owner && d.status === "client_review" && (
                <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
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

              {/* final_delivered → no actions; final state */}
              {d.status === "final_delivered" && (
                <StateBox tone="ok">
                  <div style={{ fontWeight: 600 }}>{t({ ar: "تم تسليم النسخة النهائية.", en: "Final version delivered." })}</div>
                </StateBox>
              )}

              {flash && flash.id === d.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
            </div>
          );
        })}
      </div>

      {preview && <PreviewModal title={preview.title} url={preview.url} onClose={() => setPreview(null)} />}
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

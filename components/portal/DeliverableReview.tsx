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
import { submitReview, paymentCleared, addComment, listComments, secondsToTimecode, timecodeToSeconds } from "@/lib/portal/deliverables";
import { getValidSession } from "@/lib/portalAuth";
import { canApprove } from "@/lib/portal/projects";
import { notifyReviewUpdate } from "@/lib/portal/notifyEmail";
import { DLV_STATUS_LABELS } from "@/components/portal/projectMeta";
import PreviewModal from "@/components/portal/PreviewModal";
import type { Deliverable, DeliverableReview as Review, ClientComment } from "@/lib/portal/types";

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
  const [paid, setPaid] = useState<boolean | null>(null);   // all-dues-received (project-level)
  const [dlBusy, setDlBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => { const c = await canApprove(projectId); if (alive) setOwner(c); })();
    (async () => { const r = await paymentCleared(projectId); if (alive && r.ok) setPaid(r.data); })();
    return () => { alive = false; };
  }, [projectId]);

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

              {/* final_delivered → download unlocked ONLY when dues are confirmed cleared */}
              {d.status === "final_delivered" && (
                <StateBox tone="ok">
                  <div style={{ fontWeight: 600, marginBottom: "8px" }}>{t({ ar: "تم تسليم النسخة النهائية.", en: "Final version delivered." })}</div>
                  {paid === true ? (
                    <button onClick={() => download(d)} disabled={dlBusy === d.id} className="btn-red" style={{ justifyContent: "center", opacity: dlBusy === d.id ? 0.6 : 1 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginInlineEnd: "6px" }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      <span>{dlBusy === d.id ? "..." : t({ ar: "تنزيل النسخة النهائية", en: "Download final file" })}</span>
                    </button>
                  ) : (
                    <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,210,138,0.9)", lineHeight: 1.6 }}>
                      {t({ ar: "سيتاح تنزيل الملفات النهائية بعد تأكيد استلام الدفعة.", en: "Final files will be available to download after payment is confirmed." })}
                    </div>
                  )}
                </StateBox>
              )}

              {/* Comments — general + per-timecode (video). Available while the item is client-visible. */}
              <CommentBox deliverable={d} owner={owner} t={t} />

              {flash && flash.id === d.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
            </div>
          );
        })}
      </div>

      {preview && <PreviewModal title={preview.title} url={preview.url} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ─── Per-deliverable comments (general + optional video timecode) ───
// Uses client_comments; RLS lets the client insert only while the deliverable is
// in client_review / revision_requested. Each image/document is its own
// deliverable, so this doubles as per-image / per-document commenting.
function CommentBox({ deliverable, owner, t }: { deliverable: Deliverable; owner: boolean; t: (m: { ar: string; en: string }) => string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ClientComment[]>([]);
  const [body, setBody] = useState("");
  const [tc, setTc] = useState("");
  const [busy, setBusy] = useState(false);
  const canComment = owner && (deliverable.status === "client_review" || deliverable.status === "revision_requested");
  async function load() { const r = await listComments(deliverable.id); if (r.ok) setRows(r.data); }
  useEffect(() => { if (open) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, deliverable.id]);
  async function add() {
    if (busy || !body.trim()) return;
    let secs: number | undefined;
    if (deliverable.type === "video" && tc.trim()) {
      const s = timecodeToSeconds(tc.trim());
      if (s === null) { return; }
      secs = s;
    }
    setBusy(true);
    const r = await addComment(deliverable.id, body.trim(), { timecodeSeconds: secs });
    setBusy(false);
    if (!r.ok) return;
    setBody(""); setTc(""); void load();
  }
  const statusLabel = (s?: string) => s === "resolved" ? t({ ar: "محلول", en: "Resolved" }) : s === "in_progress" ? t({ ar: "قيد المعالجة", en: "In progress" }) : t({ ar: "مفتوح", en: "Open" });
  return (
    <div style={{ marginTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px" }}>
      <button onClick={() => setOpen((v) => !v)} className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        {open ? "▾" : "▸"} {t({ ar: "الملاحظات والتعليقات", en: "Comments" })}{rows.length ? ` (${rows.length})` : ""}
      </button>
      {open && (
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {rows.map((c) => (
            <div key={c.id} className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.8)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "8px 10px", lineHeight: 1.6 }}>
              {c.timecode_seconds != null && <span style={{ color: "#E31E24", marginInlineEnd: "6px" }} dir="ltr">[{secondsToTimecode(c.timecode_seconds)}]</span>}
              {c.page_number != null && <span style={{ color: "#E31E24", marginInlineEnd: "6px" }} dir="ltr">[{t({ ar: "صفحة", en: "p." })} {c.page_number}]</span>}
              <span dir="auto">{c.body}</span>
              <span style={{ display: "block", fontSize: "10px", color: "rgba(255,255,255,0.35)", marginTop: "3px" }}>
                {c.author_role === "admin" ? t({ ar: "كيان", en: "Kian" }) : t({ ar: "أنت", en: "You" })}
                <span style={{ marginInlineStart: "8px", color: c.status === "resolved" ? "#7CFC9A" : c.status === "in_progress" ? "rgba(255,210,138,0.9)" : "rgba(255,255,255,0.4)" }}>· {statusLabel(c.status)}</span>
              </span>
              {c.resolution_note?.trim() && (
                <div style={{ marginTop: "6px", borderInlineStart: "2px solid rgba(124,252,154,0.4)", paddingInlineStart: "8px", fontSize: "12px", color: "rgba(124,252,154,0.9)" }}>
                  <span style={{ fontSize: "9px", letterSpacing: "0.5px", textTransform: "uppercase", opacity: 0.7 }}>{t({ ar: "ردّ كيان", en: "Kian's response" })}</span>
                  <div dir="auto" style={{ color: "rgba(255,255,255,0.85)" }}>{c.resolution_note}</div>
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.35)" }}>{t({ ar: "لا تعليقات بعد.", en: "No comments yet." })}</p>}
          {canComment && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {deliverable.type === "video" && (
                <input value={tc} onChange={(e) => setTc(e.target.value)} placeholder="mm:ss" dir="ltr" className="f-sans"
                  style={{ width: "72px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "8px", color: "#fff", fontSize: "12px", outline: "none" }} />
              )}
              <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                placeholder={t({ ar: "أضف تعليقًا…", en: "Add a comment…" })} className="f-sans"
                style={{ flex: 1, minWidth: "140px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "8px 10px", color: "#fff", fontSize: "12.5px", outline: "none" }} />
              <button onClick={() => void add()} disabled={busy || !body.trim()} className="btn-ghost" style={{ justifyContent: "center", opacity: busy || !body.trim() ? 0.5 : 1 }}>
                <span>{t({ ar: "إرسال", en: "Send" })}</span>
              </button>
            </div>
          )}
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

"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin review-deliverable management for a project (S6-lite). A prominent
// "Add Review Deliverable" button opens a modal form (admin_add_deliverable).
// New items default to allow_download=false + watermark_required=true (DB
// defaults — the RPC has no params for them, so they're enforced automatically).
// Each item shows a status control (admin_set_deliverable), a preview window,
// and the latest client note (from deliverable_reviews) if any.
//
// Controlled: deliverables + reviews are fetched by the parent page (so the
// summary cards and the client-notes section share one source); mutations call
// onChanged() to trigger a parent refetch.
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminAddDeliverable, adminSetDeliverable } from "@/lib/portal/admin";
import { notifyReviewReady } from "@/lib/portal/notifyEmail";
import { DELIVERABLE_STATUSES } from "@/components/portal/projectMeta";
import PreviewModal from "@/components/portal/PreviewModal";
import type { Deliverable, DeliverableReview, DeliverableType, DeliverableStatus } from "@/lib/portal/types";

const ADD_STATUSES = ["draft", "internal_review", "client_review"] as const;
const TYPES: { v: DeliverableType; ar: string; en: string }[] = [
  { v: "video", ar: "فيديو", en: "Video" },
  { v: "photo", ar: "صورة", en: "Image" },
  { v: "other", ar: "رابط / أخرى", en: "Link / Other" },
];

export default function AdminDeliverables({
  projectId, projectName, clientEmail, items, reviews, onChanged,
}: {
  projectId: string; projectName: string; clientEmail?: string | null;
  items: Deliverable[]; reviews: DeliverableReview[]; onChanged: () => void;
}) {
  const { t, isAr } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<{ title: string; url: string | null } | null>(null);

  // Latest client note per deliverable (reviews arrive newest-first).
  const latestNote = new Map<string, DeliverableReview>();
  for (const r of reviews) {
    if (!latestNote.has(r.deliverable_id) && r.comments?.trim()) latestNote.set(r.deliverable_id, r);
  }

  async function setStatus(d: Deliverable, status: DeliverableStatus) {
    if (status === d.status) return;
    setBusyId(d.id); setFlash(null);
    const r = await adminSetDeliverable({ deliverableId: d.id, status });
    setBusyId(null);
    if (!r.ok || !r.data) { setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر التحديث: ", en: "Update failed: " }) + (r.ok ? "blocked (workflow order)" : r.error) }); onChanged(); return; }
    // Moving to client_review → email the client that work is ready for preview.
    if (status === "client_review") void notifyReviewReady({ projectId, projectName, deliverableTitle: d.title, clientEmail });
    setFlash({ id: d.id, kind: "ok", text: t({ ar: "تم تحديث الحالة ✓", en: "Status updated ✓" }) });
    onChanged();
  }

  return (
    <div>
      {/* Prominent header + add button */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.55)" }}>
          {t({ ar: "أرفق رابط معاينة ليطّلع عليه العميل ويعتمده.", en: "Attach a preview link for the client to view and approve." })}
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-red" style={{ whiteSpace: "nowrap" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginInlineEnd: "6px" }}><path d="M12 5v14M5 12h14" /></svg>
          <span>{t({ ar: "إضافة معاينة للمراجعة", en: "Add Review Deliverable" })}</span>
        </button>
      </div>

      {/* Existing deliverables (admin sees all states) */}
      {items.length === 0 ? (
        <div className="text-center" style={{ padding: "40px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
          <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "لا توجد مخرجات بعد — أضف أول معاينة للمراجعة.", en: "No deliverables yet — add the first review item." })}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {items.map((d) => {
            const url = d.vimeo_review_url || d.preview_url;
            const note = latestNote.get(d.id);
            return (
              <div key={d.id} style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "14px 16px" }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div style={{ minWidth: 0 }}>
                    <div className="text-white" style={{ fontSize: "14px", fontWeight: 600 }}>{d.title}</div>
                    <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginTop: "3px" }}>
                      {d.type} · v{d.version} · {d.allow_download ? t({ ar: "تحميل مسموح", en: "download on" }) : t({ ar: "معاينة فقط", en: "preview only" })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {url && (
                      <button onClick={() => setPreview({ title: d.title, url })} className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.8)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "8px 12px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap" }}>
                        {t({ ar: "عرض المعاينة", en: "Preview" })}
                      </button>
                    )}
                    <select value={d.status} disabled={busyId === d.id} onChange={(e) => setStatus(d, e.target.value as DeliverableStatus)} className="f-sans"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(227,30,36,0.4)", borderRadius: "3px", padding: "8px 10px", fontSize: "12.5px", cursor: busyId === d.id ? "wait" : "pointer", colorScheme: "dark", outline: "none" }}>
                      {DELIVERABLE_STATUSES.map((s) => <option key={s.key} value={s.key} style={{ background: "#0a0a0a" }}>{isAr ? s.ar : s.en}</option>)}
                    </select>
                  </div>
                </div>

                {/* Latest client note inline (full history lives in the notes section below) */}
                {note && (
                  <div style={{ marginTop: "10px", borderInlineStart: `2px solid ${note.decision === "revision_requested" ? "rgba(227,30,36,0.5)" : "rgba(124,252,154,0.4)"}`, paddingInlineStart: "10px" }}>
                    <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: note.decision === "revision_requested" ? "#ff8a8e" : "#7CFC9A", marginBottom: "3px" }}>
                      {t({ ar: "آخر ملاحظة من العميل:", en: "Latest client note:" })}
                    </div>
                    <p className="text-white/80" style={{ fontSize: "12.5px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{note.comments}</p>
                  </div>
                )}

                {flash && flash.id === d.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <AddModal projectId={projectId} onClose={() => setShowAdd(false)} onAdded={(info) => {
        setShowAdd(false);
        // Added straight into client_review → email the client it's ready to preview.
        if (info.status === "client_review") void notifyReviewReady({ projectId, projectName, deliverableTitle: info.title, clientEmail });
        onChanged();
      }} />}
      {preview && <PreviewModal title={preview.title} url={preview.url} onClose={() => setPreview(null)} />}
    </div>
  );
}

function AddModal({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: (info: { title: string; status: string }) => void }) {
  const { t, isAr } = useI18n();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DeliverableType>("video");
  const [previewUrl, setPreviewUrl] = useState("");
  const [vimeoUrl, setVimeoUrl] = useState("");
  const [status, setStatus] = useState<(typeof ADD_STATUSES)[number]>("client_review");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    setErr("");
    if (!title.trim()) { setErr(t({ ar: "العنوان مطلوب", en: "Title required" })); return; }
    if (!previewUrl.trim() && !vimeoUrl.trim()) { setErr(t({ ar: "أضف رابط معاينة واحداً على الأقل", en: "Add at least one preview URL" })); return; }
    setAdding(true);
    const r = await adminAddDeliverable({ projectId, title: title.trim(), type, previewUrl: previewUrl.trim() || undefined, vimeoUrl: vimeoUrl.trim() || undefined, status });
    setAdding(false);
    if (!r.ok) { setErr(t({ ar: "تعذّر الإضافة: ", en: "Add failed: " }) + r.error); return; }
    onAdded({ title: title.trim(), status });
  }

  const input: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "12px 14px", color: "#fff", fontSize: "14px", fontFamily: "var(--sans)", outline: "none", colorScheme: "dark" };
  const lbl: React.CSSProperties = { display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "460px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "24px", margin: "auto" }}>
        <h3 className="text-white" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>{t({ ar: "إضافة معاينة للمراجعة", en: "Add Review Deliverable" })}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
          <div><label style={lbl}>{t({ ar: "العنوان *", en: "Title *" })}</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={input} /></div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div><label style={lbl}>{t({ ar: "النوع", en: "Type" })}</label>
              <select value={type} onChange={(e) => setType(e.target.value as DeliverableType)} style={input}>
                {TYPES.map((x) => <option key={x.v} value={x.v} style={{ background: "#0a0a0a" }}>{isAr ? x.ar : x.en}</option>)}
              </select></div>
            <div><label style={lbl}>{t({ ar: "الحالة", en: "Status" })}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as (typeof ADD_STATUSES)[number])} style={input}>
                {ADD_STATUSES.map((s) => { const m = DELIVERABLE_STATUSES.find((x) => x.key === s)!; return <option key={s} value={s} style={{ background: "#0a0a0a" }}>{isAr ? m.ar : m.en}</option>; })}
              </select></div>
          </div>
          <div><label style={lbl}>{t({ ar: "رابط المعاينة", en: "Preview URL" })}</label><input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} type="url" dir="ltr" placeholder="https://youtube.com/... / image / video" style={input} /></div>
          <div><label style={lbl}>{t({ ar: "رابط Vimeo للمراجعة (اختياري)", en: "Vimeo Review URL (optional)" })}</label><input value={vimeoUrl} onChange={(e) => setVimeoUrl(e.target.value)} type="url" dir="ltr" placeholder="https://vimeo.com/..." style={input} /></div>

          {/* Fixed review-only settings (enforced by DB defaults) */}
          <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(124,252,154,0.8)", background: "rgba(124,252,154,0.06)", border: "1px solid rgba(124,252,154,0.25)", borderRadius: "3px", padding: "10px 12px", lineHeight: 1.6 }}>
            ✓ {t({ ar: "نسخة معاينة فقط — بدون تحميل، مع علامة مائية (مفعّلة افتراضياً).", en: "Preview only — no download, watermark on (enforced by default)." })}
          </div>
          {err && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>}
          <p className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
            {t({ ar: "اختيار «مراجعة العميل» يُشعر العميل تلقائياً. (الإصدار يبدأ من v1.)", en: "Choosing “Client Review” notifies the client automatically. (Version starts at v1.)" })}
          </p>
          <div className="flex gap-3">
            <button onClick={add} disabled={adding} className="btn-red" style={{ flex: 1, justifyContent: "center", opacity: adding ? 0.6 : 1 }}><span>{adding ? "..." : t({ ar: "حفظ", en: "Save" })}</span></button>
            <button onClick={onClose} className="btn-ghost" style={{ justifyContent: "center" }}><span>{t({ ar: "إلغاء", en: "Cancel" })}</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

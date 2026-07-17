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
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminAddDeliverable, adminSetDeliverable, adminSoftDeleteDeliverable, adminConfirmProjectPayment, adminRevokeProjectPayment, projectPaymentCleared, adminSetReleasePolicy, type ReleaseWindow } from "@/lib/portal/admin";
import { notifyReviewReady, notifyFinalDelivered } from "@/lib/portal/notifyEmail";
import { listCommentsForDeliverables, resolveNote, secondsToTimecode } from "@/lib/portal/deliverables";
import { DELIVERABLE_STATUSES } from "@/components/portal/projectMeta";
import PreviewModal from "@/components/portal/PreviewModal";
import type { Deliverable, DeliverableReview, DeliverableType, DeliverableStatus, ClientComment, NoteStatus } from "@/lib/portal/types";

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
  const [editing, setEditing] = useState<Deliverable | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string | null } | null>(null);
  // Top-level notice for delete (the deleted row is removed from the list, so its
  // inline flash would never render — this shows above the list instead).
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const showNotice = (kind: "ok" | "err", text: string) => { setNotice({ kind, text }); window.setTimeout(() => setNotice(null), 4000); };

  // Latest client note per deliverable (reviews arrive newest-first).
  const latestNote = new Map<string, DeliverableReview>();
  for (const r of reviews) {
    if (!latestNote.has(r.deliverable_id) && r.comments?.trim()) latestNote.set(r.deliverable_id, r);
  }

  // Fetch client_comments (general/timecode/page notes) — the piece no admin view
  // showed before. Grouped by deliverable for the per-item NotesPanel.
  const [comments, setComments] = useState<ClientComment[]>([]);
  const ids = items.map((d) => d.id).join(",");
  const reloadComments = () => { if (items.length) void listCommentsForDeliverables(items.map((d) => d.id)).then((r) => { if (r.ok) setComments(r.data); }); };
  useEffect(reloadComments, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const commentsByDlv = new Map<string, ClientComment[]>();
  for (const c of comments) { const a = commentsByDlv.get(c.deliverable_id) ?? []; a.push(c); commentsByDlv.set(c.deliverable_id, a); }

  async function setStatus(d: Deliverable, status: DeliverableStatus) {
    if (status === d.status) return;
    setBusyId(d.id); setFlash(null);
    const r = await adminSetDeliverable({ deliverableId: d.id, status });
    setBusyId(null);
    if (!r.ok || !r.data) { setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر التحديث: ", en: "Update failed: " }) + (r.ok ? "blocked (workflow order)" : r.error) }); onChanged(); return; }
    // Status-change emails (best-effort; never block the UI).
    if (status === "client_review") void notifyReviewReady({ projectId, projectName, deliverableTitle: d.title, clientEmail });
    else if (status === "final_delivered") void notifyFinalDelivered({ projectId, projectName, deliverableTitle: d.title, clientEmail });
    setFlash({ id: d.id, kind: "ok", text: t({ ar: "تم تحديث الحالة ✓", en: "Status updated ✓" }) });
    onChanged();
  }

  async function del(d: Deliverable) {
    if (!window.confirm(t({ ar: "هل أنت متأكد من حذف رابط المعاينة؟", en: "Delete this preview link?" }))) return;
    setBusyId(d.id); setFlash(null); setNotice(null);
    const r = await adminSoftDeleteDeliverable(d.id);
    setBusyId(null);
    // Success ONLY when a row was actually soft-deleted (r.data === true). r.data
    // false/null means nothing changed → keep the row visible + show the error.
    if (!r.ok || r.data !== true) {
      console.error("[delete-deliverable]", r.ok ? "no row updated (id missing / already deleted)" : r.error);
      showNotice("err", t({ ar: "تعذر حذف المعاينة. حاول مرة أخرى.", en: "Couldn't delete the preview. Please try again." }));
      return;
    }
    showNotice("ok", t({ ar: "تم حذف المعاينة", en: "Preview deleted" }));
    onChanged(); // refetch → the (now is_deleted=true) row is filtered out of the list
  }

  return (
    <div>
      {/* Payment-release gate: final downloads stay locked for the client until an
          admin confirms all dues received (independent of Zoho/finance). */}
      <PaymentGateCard projectId={projectId} t={t} />

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

      {notice && (
        <div className="f-sans" style={{ fontSize: "12.5px", marginBottom: "12px", padding: "9px 12px", borderRadius: "3px",
          color: notice.kind === "ok" ? "#7CFC9A" : "#ff8a8e",
          background: notice.kind === "ok" ? "rgba(124,252,154,0.08)" : "rgba(227,30,36,0.08)",
          border: `1px solid ${notice.kind === "ok" ? "rgba(124,252,154,0.3)" : "rgba(227,30,36,0.3)"}` }}>
          {notice.text}
        </div>
      )}

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
                    <button onClick={() => setEditing(d)} disabled={busyId === d.id} className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.8)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "8px 12px", borderRadius: "3px", cursor: busyId === d.id ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                      {t({ ar: "تعديل", en: "Edit" })}
                    </button>
                    <button onClick={() => void del(d)} disabled={busyId === d.id} className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "#ff9ea1", background: "none", border: "1px solid rgba(227,30,36,0.4)", padding: "8px 12px", borderRadius: "3px", cursor: busyId === d.id ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                      {t({ ar: "حذف", en: "Delete" })}
                    </button>
                    <div>
                      <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>{t({ ar: "حالة المخرج", en: "Deliverable Status" })}</div>
                      <select value={d.status} disabled={busyId === d.id} onChange={(e) => setStatus(d, e.target.value as DeliverableStatus)} className="f-sans"
                        style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(227,30,36,0.4)", borderRadius: "3px", padding: "8px 10px", fontSize: "12.5px", cursor: busyId === d.id ? "wait" : "pointer", colorScheme: "dark", outline: "none" }}>
                        {DELIVERABLE_STATUSES.map((s) => <option key={s.key} value={s.key} style={{ background: "#0a0a0a" }}>{isAr ? s.ar : s.en}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Full note thread under THIS deliverable: revision-request note(s)
                    + every client comment (general/timecode/page), each resolvable
                    with a Kian response — this is the §1 fix. */}
                <NotesPanel deliverable={d} reviews={reviews.filter((r) => r.deliverable_id === d.id)} comments={commentsByDlv.get(d.id) ?? []} onResolved={reloadComments} t={t} />

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
      {editing && <EditModal deliverable={editing} onClose={() => setEditing(null)} onSaved={() => {
        setEditing(null);
        setFlash({ id: editing.id, kind: "ok", text: t({ ar: "تم حفظ التعديلات ✓", en: "Changes saved ✓" }) });
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
    if (!r.ok) {
      // Never surface a raw DB error (e.g. the recipient_shape constraint) to the UI.
      console.error("[add-deliverable]", r.error);
      setErr(t({ ar: "تعذّرت إضافة المعاينة. حدّث الصفحة وحاول مرة أخرى.", en: "Couldn't add the preview. Refresh and try again." }));
      return;
    }
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
            {t({ ar: "اختيار «مراجعة العميل» يُشعر العميل تلقائياً إذا كان مرتبطاً بحساب. للمشاريع غير المرتبطة تُحفظ المعاينة دون إرسال إشعار. (الإصدار يبدأ من v1.)", en: "Choosing “Client Review” notifies the client automatically if they’re linked to an account. For unlinked projects the preview is saved without a notification. (Version starts at v1.)" })}
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

// Edit an EXISTING preview: title / type / preview URL / vimeo URL. Status is
// managed by the row's own status control (kept separate to avoid duplicating the
// client-notification flow). Requires docs/portal_deliverable_edit_delete_RUNME.sql.
function EditModal({ deliverable, onClose, onSaved }: { deliverable: Deliverable; onClose: () => void; onSaved: () => void }) {
  const { t, isAr } = useI18n();
  const [title, setTitle] = useState(deliverable.title ?? "");
  const [type, setType] = useState<DeliverableType>(deliverable.type ?? "video");
  const [previewUrl, setPreviewUrl] = useState(deliverable.preview_url ?? "");
  const [vimeoUrl, setVimeoUrl] = useState(deliverable.vimeo_review_url ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function validUrl(u: string): boolean {
    if (!u.trim()) return true; // optional field
    try { const p = new URL(u.trim()); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; }
  }

  async function save() {
    setErr("");
    if (!title.trim()) { setErr(t({ ar: "العنوان مطلوب", en: "Title required" })); return; }
    if (!previewUrl.trim() && !vimeoUrl.trim()) { setErr(t({ ar: "أضف رابط معاينة واحداً على الأقل", en: "Add at least one preview URL" })); return; }
    if (!validUrl(previewUrl) || !validUrl(vimeoUrl)) { setErr(t({ ar: "الرجاء إدخال رابط صحيح (http/https).", en: "Please enter a valid http/https URL." })); return; }
    setSaving(true);
    const r = await adminSetDeliverable({
      deliverableId: deliverable.id,
      title: title.trim(),
      type,
      previewUrl: previewUrl.trim(),
      vimeoUrl: vimeoUrl.trim(),
    });
    setSaving(false);
    if (!r.ok || !r.data) {
      console.error("[edit-deliverable]", r.ok ? "no row" : r.error);
      setErr(t({ ar: "تعذّر حفظ التعديلات. حدّث الصفحة وحاول مرة أخرى.", en: "Couldn't save changes. Refresh and try again." }));
      return;
    }
    onSaved();
  }

  const input: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "12px 14px", color: "#fff", fontSize: "14px", fontFamily: "var(--sans)", outline: "none", colorScheme: "dark" };
  const lbl: React.CSSProperties = { display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "460px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "24px", margin: "auto" }}>
        <h3 className="text-white" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>{t({ ar: "تعديل المعاينة", en: "Edit Preview" })}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
          <div><label style={lbl}>{t({ ar: "العنوان *", en: "Title *" })}</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={input} /></div>
          <div><label style={lbl}>{t({ ar: "النوع", en: "Type" })}</label>
            <select value={type} onChange={(e) => setType(e.target.value as DeliverableType)} style={input}>
              {TYPES.map((x) => <option key={x.v} value={x.v} style={{ background: "#0a0a0a" }}>{isAr ? x.ar : x.en}</option>)}
            </select></div>
          <div><label style={lbl}>{t({ ar: "رابط المعاينة", en: "Preview URL" })}</label><input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} type="url" dir="ltr" placeholder="https://youtube.com/... / image / video" style={input} /></div>
          <div><label style={lbl}>{t({ ar: "رابط Vimeo للمراجعة (اختياري)", en: "Vimeo Review URL (optional)" })}</label><input value={vimeoUrl} onChange={(e) => setVimeoUrl(e.target.value)} type="url" dir="ltr" placeholder="https://vimeo.com/..." style={input} /></div>
          <p className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
            {t({ ar: "الحالة تُدار من قائمة «حالة المخرج» في القائمة.", en: "Status is managed from the row’s status control." })}
          </p>
          {err && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>}
          <div className="flex gap-3">
            <button onClick={save} disabled={saving} className="btn-red" style={{ flex: 1, justifyContent: "center", opacity: saving ? 0.6 : 1 }}><span>{saving ? "..." : t({ ar: "حفظ", en: "Save" })}</span></button>
            <button onClick={onClose} className="btn-ghost" style={{ justifyContent: "center" }}><span>{t({ ar: "إلغاء", en: "Cancel" })}</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Project payment-release control (admin only) ───
// Confirms "all client dues received" → unlocks client final downloads for any
// deliverable already at final_delivered. Revoke relocks. Fully audited server-side.
function PaymentGateCard({ projectId, t }: { projectId: string; t: (m: { ar: string; en: string }) => string }) {
  const [cleared, setCleared] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => { void projectPaymentCleared(projectId).then((r) => { if (r.ok) setCleared(r.data); }); };
  useEffect(load, [projectId]);
  async function confirm() {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await adminConfirmProjectPayment(projectId, note.trim() || undefined);
    setBusy(false);
    if (!r.ok) { setMsg(t({ ar: "تعذّر التأكيد.", en: "Failed." })); return; }
    setNote(""); setMsg(t({ ar: "تم تأكيد استلام كامل الدفعة — التنزيل النهائي مُتاح للعميل.", en: "Payment confirmed — client final download unlocked." })); load();
  }
  async function revoke() {
    if (busy) return;
    if (!window.confirm(t({ ar: "سحب تأكيد الدفعة سيُعيد قفل التنزيل النهائي للعميل. متابعة؟", en: "Revoke will re-lock the client's final download. Continue?" }))) return;
    setBusy(true); setMsg(null);
    const r = await adminRevokeProjectPayment(projectId, note.trim() || undefined);
    setBusy(false);
    if (!r.ok) { setMsg(t({ ar: "تعذّر السحب.", en: "Failed." })); return; }
    setNote(""); setMsg(t({ ar: "أُعيد قفل التنزيل النهائي.", en: "Final download re-locked." })); load();
  }
  const [win, setWin] = useState<ReleaseWindow>("none");
  const [lim, setLim] = useState<string>("");
  async function savePolicy() {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await adminSetReleasePolicy(projectId, win, lim.trim() ? Math.max(1, Number(lim)) : null);
    setBusy(false);
    setMsg(r.ok ? t({ ar: "حُفظت سياسة التحرير.", en: "Release policy saved." }) : t({ ar: "تعذّر الحفظ.", en: "Failed." }));
  }
  const on = cleared === true;
  return (
    <div style={{ marginBottom: "16px", padding: "14px 16px", borderRadius: "4px",
      background: on ? "rgba(124,252,154,0.05)" : "rgba(255,210,138,0.05)",
      border: `1px solid ${on ? "rgba(124,252,154,0.28)" : "rgba(255,210,138,0.3)"}` }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: "4px" }}>
            {t({ ar: "بوابة تحرير التسليم النهائي", en: "Final-delivery release gate" })}
          </div>
          <div className="f-sans" style={{ fontSize: "13.5px", fontWeight: 600, color: on ? "#7CFC9A" : "rgba(255,210,138,0.95)" }}>
            {cleared === null ? t({ ar: "…", en: "…" }) : on
              ? t({ ar: "✓ كامل الدفعة مُستلَم — التنزيل النهائي متاح للعميل", en: "✓ Payment received — client final download unlocked" })
              : t({ ar: "الدفعة غير مؤكَّدة — التنزيل النهائي مقفول للعميل", en: "Payment not confirmed — client final download locked" })}
          </div>
          <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "4px", lineHeight: 1.6 }}>
            {t({ ar: "التنزيل النهائي يتطلب: حالة المخرَج «تم التسليم» + تأكيدك لاستلام كامل مستحقات العميل. مستقل عن Zoho.", en: "Final download requires deliverable status = final_delivered AND this confirmation. Independent of Zoho." })}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap" style={{ maxWidth: "100%" }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t({ ar: "ملاحظة الدفعة (اختياري)", en: "Payment note (optional)" })}
            className="f-sans" style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "3px", padding: "8px 11px", fontSize: "12px", outline: "none", minWidth: "160px" }} />
          {on ? (
            <button onClick={revoke} disabled={busy} className="f-sans" style={{ fontSize: "12px", color: "#ff9ea1", background: "none", border: "1px solid rgba(227,30,36,0.45)", borderRadius: "3px", padding: "9px 14px", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
              {t({ ar: "سحب التأكيد (إعادة القفل)", en: "Revoke (re-lock)" })}
            </button>
          ) : (
            <button onClick={confirm} disabled={busy} className="btn-red" style={{ whiteSpace: "nowrap" }}>
              <span>{busy ? "…" : t({ ar: "تأكيد استلام كامل الدفعة", en: "Full payment received" })}</span>
            </button>
          )}
        </div>
      </div>
      {/* Release policy: window (expiry) + download limit — enforced server-side. */}
      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>{t({ ar: "سياسة التحرير", en: "Release policy" })}</span>
        <select value={win} onChange={(e) => setWin(e.target.value as ReleaseWindow)} className="f-sans" style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "3px", padding: "7px 9px", fontSize: "11.5px", colorScheme: "dark", outline: "none" }}>
          <option value="none">{t({ ar: "بلا انتهاء", en: "No expiry" })}</option>
          <option value="24h">{t({ ar: "24 ساعة", en: "24 hours" })}</option>
          <option value="3d">{t({ ar: "3 أيام", en: "3 days" })}</option>
          <option value="7d">{t({ ar: "7 أيام", en: "7 days" })}</option>
          <option value="30d">{t({ ar: "30 يومًا", en: "30 days" })}</option>
        </select>
        <input value={lim} onChange={(e) => setLim(e.target.value)} type="number" min={1} placeholder={t({ ar: "حدّ التنزيل (فارغ=غير محدود)", en: "Download limit (blank=unlimited)" })} className="f-sans"
          style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "3px", padding: "7px 9px", fontSize: "11.5px", width: "150px", outline: "none" }} dir="ltr" />
        <button onClick={savePolicy} disabled={busy} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "3px", padding: "7px 12px", cursor: busy ? "wait" : "pointer" }}>{t({ ar: "حفظ السياسة", en: "Save policy" })}</button>
        <span className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>{t({ ar: "«بلا انتهاء» = يبقى مفتوحًا، لكن كل رابط تنزيل يبقى قصير الأجل.", en: "\"No expiry\" keeps access open; each link is still short-lived." })}</span>
      </div>

      {msg && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: "rgba(255,255,255,0.7)" }}>{msg}</div>}
    </div>
  );
}

// ─── Full note thread under a deliverable (§1): revision requests + all client
// comments (general / timecode / page / position), each resolvable with a Kian
// response. Comments persist across versions (never deleted on new upload). ───
type Tf = (m: { ar: string; en: string }) => string;
function NotesPanel({ deliverable, reviews, comments, onResolved, t }: {
  deliverable: Deliverable; reviews: DeliverableReview[]; comments: ClientComment[]; onResolved: () => void; t: Tf;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const revisionReviews = reviews.filter((r) => r.decision === "revision_requested" && (r.comments?.trim() || true));
  const openCount = comments.filter((c) => c.status !== "resolved").length + revisionReviews.filter((r) => r.status !== "resolved").length;
  const resolvedCount = comments.filter((c) => c.status === "resolved").length + revisionReviews.filter((r) => r.status === "resolved").length;
  const total = comments.length + revisionReviews.length;
  if (total === 0) return null;

  async function resolve(kind: "comment" | "review", id: string, status: NoteStatus, respondEl?: HTMLTextAreaElement | null) {
    setBusy(id);
    const r = await resolveNote(kind, id, status, respondEl?.value.trim() || undefined);
    setBusy(null);
    if (r.ok) { if (respondEl) respondEl.value = ""; onResolved(); }
  }
  const stColor = (s?: string) => s === "resolved" ? "#7CFC9A" : s === "in_progress" ? "rgba(255,210,138,0.95)" : "#ff8a8e";
  const stLabel = (s?: string) => s === "resolved" ? t({ ar: "محلول", en: "Resolved" }) : s === "in_progress" ? t({ ar: "قيد المعالجة", en: "In progress" }) : t({ ar: "مفتوح", en: "Open" });

  const Row = ({ id, kind, badge, badgeColor, body, meta, status, resolution }: {
    id: string; kind: "comment" | "review"; badge: string; badgeColor: string; body: string; meta: string; status?: string; resolution?: string | null;
  }) => {
    const ref = { el: null as HTMLTextAreaElement | null };
    return (
      <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "10px 12px" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: "5px" }}>
          <span className="f-sans" style={{ fontSize: "9px", letterSpacing: "0.5px", textTransform: "uppercase", color: badgeColor }}>{badge}</span>
          <span className="f-sans" style={{ fontSize: "10px", color: stColor(status) }}>● {stLabel(status)}</span>
        </div>
        <p className="text-white/85" style={{ fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" }} dir="auto">{body || t({ ar: "(بدون نص)", en: "(no text)" })}</p>
        <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>{meta}</div>
        {resolution?.trim() && (
          <div style={{ marginTop: "6px", borderInlineStart: "2px solid rgba(124,252,154,0.4)", paddingInlineStart: "8px", fontSize: "12px", color: "rgba(255,255,255,0.8)" }}>
            <span style={{ fontSize: "9px", textTransform: "uppercase", color: "#7CFC9A" }}>{t({ ar: "ردّ كيان", en: "Kian response" })}</span>
            <div dir="auto">{resolution}</div>
          </div>
        )}
        {status !== "resolved" && (
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <textarea ref={(e) => { ref.el = e; }} rows={2} placeholder={t({ ar: "ردّ/حلّ كيان (اختياري)…", en: "Kian response/resolution (optional)…" })} className="f-sans"
              style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "8px 10px", color: "#fff", fontSize: "12.5px", outline: "none", resize: "vertical", colorScheme: "dark" }} />
            <div className="flex gap-2 flex-wrap">
              {status !== "in_progress" && <button disabled={busy === id} onClick={() => resolve(kind, id, "in_progress", ref.el)} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,210,138,0.95)", background: "none", border: "1px solid rgba(255,210,138,0.35)", borderRadius: "3px", padding: "7px 12px", cursor: "pointer" }}>{t({ ar: "قيد المعالجة", en: "In progress" })}</button>}
              <button disabled={busy === id} onClick={() => resolve(kind, id, "resolved", ref.el)} className="f-sans" style={{ fontSize: "11px", color: "#7CFC9A", background: "none", border: "1px solid rgba(124,252,154,0.35)", borderRadius: "3px", padding: "7px 12px", cursor: "pointer" }}>{busy === id ? "…" : t({ ar: "وضع كمحلول + إرسال الرد", en: "Resolve + send response" })}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: "8px" }}>
        {t({ ar: "ملاحظات العميل وحلّها", en: "Client notes & resolution" })} —
        <span style={{ color: "#ff8a8e" }}> {openCount} {t({ ar: "مفتوح", en: "open" })}</span> ·
        <span style={{ color: "#7CFC9A" }}> {resolvedCount} {t({ ar: "محلول", en: "resolved" })}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {revisionReviews.map((r) => (
          <Row key={r.id} id={r.id} kind="review" badge={t({ ar: "طلب تعديل", en: "Revision request" })} badgeColor="#ff8a8e"
            body={r.comments ?? ""} status={r.status}
            meta={`${t({ ar: "قرار", en: "decision" })} · ${new Date(r.created_at).toLocaleString("en-GB")}`} resolution={r.resolution_note} />
        ))}
        {comments.map((c) => (
          <Row key={c.id} id={c.id} kind="comment"
            badge={c.timecode_seconds != null ? `${t({ ar: "تعليق", en: "Comment" })} · ${secondsToTimecode(c.timecode_seconds)}` : c.page_number != null ? `${t({ ar: "تعليق · صفحة", en: "Comment · p." })} ${c.page_number}` : t({ ar: "تعليق", en: "Comment" })}
            badgeColor="rgba(255,255,255,0.6)" body={c.body} status={c.status}
            meta={`${c.author_role === "admin" ? t({ ar: "كيان", en: "Kian" }) : t({ ar: "العميل", en: "Client" })} · ${new Date(c.created_at).toLocaleString("en-GB")}`} resolution={c.resolution_note} />
        ))}
      </div>
    </div>
  );
}

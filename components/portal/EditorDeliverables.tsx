"use client";
// ════════════════════════════════════════════════════════════════════════
// Editor deliverable panel (مونتير). Assigned editors add review previews and
// move review status via the staff-safe RPCs (staff_add_deliverable /
// staff_set_deliverable). final_delivered / archived are NOT offered and are
// hard-blocked by the DB (can_final_deliver = owner/admin/manager only). Editors
// also see the latest client note (read). Preview opens the watermarked modal.
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { staffAddDeliverable, staffSetDeliverable } from "@/lib/portal/admin";
import { DELIVERABLE_STATUSES } from "@/components/portal/projectMeta";
import PreviewModal from "@/components/portal/PreviewModal";
import DeliverableNotesPanel from "@/components/portal/DeliverableNotesPanel";
import type { Deliverable, DeliverableReview as Review, DeliverableType } from "@/lib/portal/types";

// Statuses an editor may set (NO final_delivered / archived).
const EDITOR_SET = ["draft", "internal_review", "client_review", "revision_requested", "approved"];
const EDITOR_ADD = ["draft", "internal_review", "client_review"] as const;
const TYPES: { v: DeliverableType; ar: string; en: string }[] = [
  { v: "video", ar: "فيديو", en: "Video" },
  { v: "photo", ar: "صورة", en: "Image" },
  { v: "other", ar: "رابط / أخرى", en: "Link / Other" },
];

export default function EditorDeliverables({
  projectId, items, reviews, onChanged,
}: { projectId: string; items: Deliverable[]; reviews: Review[]; onChanged: () => void }) {
  const { t, isAr } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<{ title: string; url: string | null } | null>(null);

  const setOpts = DELIVERABLE_STATUSES.filter((s) => EDITOR_SET.includes(s.key));

  async function setStatus(d: Deliverable, status: string) {
    if (status === d.status) return;
    setBusyId(d.id); setFlash(null);
    const r = await staffSetDeliverable({ deliverableId: d.id, status: status as never });
    setBusyId(null);
    if (!r.ok || !r.data) { setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر التحديث: ", en: "Update failed: " }) + (r.ok ? "blocked" : r.error) }); onChanged(); return; }
    setFlash({ id: d.id, kind: "ok", text: t({ ar: "تم تحديث الحالة ✓", en: "Status updated ✓" }) });
    onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.55)" }}>
          {t({ ar: "أضف معاينة للمراجعة وحدّث حالتها. التسليم النهائي يتم من الإدارة.", en: "Add a review preview and update its status. Final delivery is done by management." })}
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-red" style={{ whiteSpace: "nowrap" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginInlineEnd: "6px" }}><path d="M12 5v14M5 12h14" /></svg>
          <span>{t({ ar: "إضافة معاينة", en: "Add Preview" })}</span>
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center" style={{ padding: "40px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
          <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "لا توجد مخرجات بعد.", en: "No deliverables yet." })}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {items.map((d) => {
            const url = d.vimeo_review_url || d.preview_url;
            return (
              <div key={d.id} style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "14px 16px" }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div style={{ minWidth: 0 }}>
                    <div className="text-white" style={{ fontSize: "14px", fontWeight: 600 }}>{d.title}</div>
                    <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginTop: "3px" }}>{d.type} · v{d.version}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {url && (
                      <button onClick={() => setPreview({ title: d.title, url })} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.8)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "8px 12px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap" }}>{t({ ar: "عرض المعاينة", en: "Preview" })}</button>
                    )}
                    <div>
                      <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>{t({ ar: "حالة المخرج", en: "Status" })}</div>
                      {/* final_delivered is intentionally absent; if the item is already final, show it read-only */}
                      {d.status === "final_delivered" || d.status === "archived" ? (
                        <span className="f-sans" style={{ fontSize: "12px", color: "rgba(124,252,154,0.85)" }}>{isAr ? "تم التسليم النهائي" : "Final delivered"}</span>
                      ) : (
                        <select value={d.status} disabled={busyId === d.id} onChange={(e) => setStatus(d, e.target.value)} className="f-sans"
                          style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(227,30,36,0.4)", borderRadius: "3px", padding: "8px 10px", fontSize: "12.5px", cursor: busyId === d.id ? "wait" : "pointer", colorScheme: "dark", outline: "none" }}>
                          {setOpts.map((s) => <option key={s.key} value={s.key} style={{ background: "#0a0a0a" }}>{isAr ? s.ar : s.en}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
                {/* Every client comment (revision requests + timecode/page/pin
                    annotations) grouped by version, resolvable by staff. */}
                <DeliverableNotesPanel deliverable={d} reviews={reviews} canResolve t={t} />
                {flash && flash.id === d.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <AddModal projectId={projectId} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); onChanged(); }} />}
      {preview && <PreviewModal title={preview.title} url={preview.url} onClose={() => setPreview(null)} />}
    </div>
  );
}

function AddModal({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: () => void }) {
  const { t, isAr } = useI18n();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DeliverableType>("video");
  const [previewUrl, setPreviewUrl] = useState("");
  const [vimeoUrl, setVimeoUrl] = useState("");
  const [status, setStatus] = useState<(typeof EDITOR_ADD)[number]>("client_review");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    setErr("");
    if (!title.trim()) { setErr(t({ ar: "العنوان مطلوب", en: "Title required" })); return; }
    if (!previewUrl.trim() && !vimeoUrl.trim()) { setErr(t({ ar: "أضف رابط معاينة واحداً على الأقل", en: "Add at least one preview URL" })); return; }
    setAdding(true);
    const r = await staffAddDeliverable({ projectId, title: title.trim(), type, previewUrl: previewUrl.trim() || undefined, vimeoUrl: vimeoUrl.trim() || undefined, status });
    setAdding(false);
    if (!r.ok) { setErr(t({ ar: "تعذّر الإضافة: ", en: "Add failed: " }) + r.error); return; }
    onAdded();
  }

  const input: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "12px 14px", color: "#fff", fontSize: "14px", fontFamily: "var(--sans)", outline: "none", colorScheme: "dark" };
  const lbl: React.CSSProperties = { display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "460px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "24px", margin: "auto" }}>
        <h3 className="text-white" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>{t({ ar: "إضافة معاينة للمراجعة", en: "Add Review Preview" })}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
          <div><label style={lbl}>{t({ ar: "العنوان *", en: "Title *" })}</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={input} /></div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div><label style={lbl}>{t({ ar: "النوع", en: "Type" })}</label>
              <select value={type} onChange={(e) => setType(e.target.value as DeliverableType)} style={input}>
                {TYPES.map((x) => <option key={x.v} value={x.v} style={{ background: "#0a0a0a" }}>{isAr ? x.ar : x.en}</option>)}
              </select></div>
            <div><label style={lbl}>{t({ ar: "الحالة", en: "Status" })}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as (typeof EDITOR_ADD)[number])} style={input}>
                {EDITOR_ADD.map((s) => { const m = DELIVERABLE_STATUSES.find((x) => x.key === s)!; return <option key={s} value={s} style={{ background: "#0a0a0a" }}>{isAr ? m.ar : m.en}</option>; })}
              </select></div>
          </div>
          <div><label style={lbl}>{t({ ar: "رابط المعاينة", en: "Preview URL" })}</label><input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} type="url" dir="ltr" placeholder="https://youtube.com/... / image / video" style={input} /></div>
          <div><label style={lbl}>{t({ ar: "رابط Vimeo للمراجعة (اختياري)", en: "Vimeo Review URL (optional)" })}</label><input value={vimeoUrl} onChange={(e) => setVimeoUrl(e.target.value)} type="url" dir="ltr" placeholder="https://vimeo.com/..." style={input} /></div>
          <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(124,252,154,0.8)", background: "rgba(124,252,154,0.06)", border: "1px solid rgba(124,252,154,0.25)", borderRadius: "3px", padding: "10px 12px", lineHeight: 1.6 }}>
            ✓ {t({ ar: "نسخة معاينة فقط — التسليم النهائي من الإدارة.", en: "Preview only — final delivery is done by management." })}
          </div>
          {err && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>}
          <div className="flex gap-3">
            <button onClick={add} disabled={adding} className="btn-red" style={{ flex: 1, justifyContent: "center", opacity: adding ? 0.6 : 1 }}><span>{adding ? "..." : t({ ar: "حفظ", en: "Save" })}</span></button>
            <button onClick={onClose} className="btn-ghost" style={{ justifyContent: "center" }}><span>{t({ ar: "إلغاء", en: "Cancel" })}</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

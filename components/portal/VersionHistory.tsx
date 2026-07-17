"use client";
// ════════════════════════════════════════════════════════════════════════
// §2 True deliverable versioning UI (client + admin). Shows the full version
// lineage (V1/V2/…/Final) for one deliverable: current vs previous, per-version
// decision, revision reason, uploader/time, note, open/resolved comment counts,
// and which prior comments a new version addresses.
//   client mode: preview any version; approve / request-revision on the CURRENT
//                version while the deliverable is in client_review (owner only).
//   admin  mode: add a new version (never overwrites), mark an approved version
//                as Final.
// Preview + inline annotations are handled by AnnotationViewer (§3).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listVersionSummary, addDeliverableVersion, reviewVersion, setFinalVersion, type VersionSummary } from "@/lib/portal/deliverables";
import AnnotationViewer from "@/components/portal/AnnotationViewer";
import type { Deliverable } from "@/lib/portal/types";

const DECISION = {
  pending: { ar: "بانتظار المراجعة", en: "Pending", c: "rgba(255,255,255,0.5)" },
  approved: { ar: "معتمدة", en: "Approved", c: "#7CFC9A" },
  revision_requested: { ar: "طلب تعديل", en: "Revision requested", c: "#ff8a8e" },
};

export default function VersionHistory({
  deliverable, mode, owner, canReview, onChanged,
}: {
  deliverable: Deliverable; mode: "client" | "admin"; owner?: boolean; canReview?: boolean; onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [viewing, setViewing] = useState<VersionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [reviseNote, setReviseNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ preview_url: "", preview_type: "video", note: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listVersionSummary(deliverable.id);
    if (r.ok) setVersions(r.data);
  }, [deliverable.id]);
  useEffect(() => { void load(); }, [load]);

  const current = versions.find((v) => v.is_current);
  async function decide(v: VersionSummary, decision: "approved" | "revision_requested", note?: string) {
    setBusy(true); setMsg(null);
    const r = await reviewVersion(v.id, decision, note);
    setBusy(false);
    if (!r.ok) { setMsg(t({ ar: "تعذّر الإرسال.", en: "Failed." })); return; }
    setReviseFor(null); setReviseNote("");
    await load(); onChanged?.();
  }
  async function addVersion() {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await addDeliverableVersion(deliverable.id, {
      preview_url: addForm.preview_url.trim() || null, preview_type: addForm.preview_type,
      vimeo_review_url: addForm.preview_type === "video" ? addForm.preview_url.trim() || null : null,
      note: addForm.note.trim() || null,
    });
    setBusy(false);
    if (!r.ok) { setMsg(t({ ar: "تعذّرت الإضافة.", en: "Failed." })); return; }
    setAdding(false); setAddForm({ preview_url: "", preview_type: "video", note: "" });
    await load(); onChanged?.();
  }
  async function markFinal(v: VersionSummary) {
    if (!window.confirm(t({ ar: `تعيين ${v.label} كنسخة نهائية للتسليم؟`, en: "Set as Final delivery version?" }))) return;
    setBusy(true);
    const r = await setFinalVersion(deliverable.id, v.id);
    setBusy(false);
    if (!r.ok) { setMsg(t({ ar: "تعذّر التعيين — يجب أن تكون النسخة معتمدة.", en: "Failed — version must be approved." })); return; }
    await load(); onChanged?.();
  }

  return (
    <div style={{ marginTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px" }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: "8px" }}>
        <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
          {t({ ar: "سجلّ النسخ", en: "Version history" })} ({versions.length})
        </span>
        {mode === "admin" && deliverable.status !== "final_delivered" && (
          <button onClick={() => setAdding((v) => !v)} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "3px", padding: "6px 11px", cursor: "pointer" }}>
            + {t({ ar: "نسخة جديدة", en: "New version" })}
          </button>
        )}
      </div>

      {adding && mode === "admin" && (
        <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "3px", padding: "10px", marginBottom: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <input value={addForm.preview_url} onChange={(e) => setAddForm({ ...addForm, preview_url: e.target.value })} placeholder={t({ ar: "رابط المعاينة / Vimeo", en: "Preview / Vimeo URL" })} className="f-sans" dir="ltr" style={inp} />
          <div className="flex gap-2 flex-wrap">
            <select value={addForm.preview_type} onChange={(e) => setAddForm({ ...addForm, preview_type: e.target.value })} className="f-sans" style={{ ...inp, colorScheme: "dark", width: "auto" }}>
              {["video", "image", "pdf", "office", "other"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <input value={addForm.note} onChange={(e) => setAddForm({ ...addForm, note: e.target.value })} placeholder={t({ ar: "ملاحظة النسخة", en: "Version note" })} className="f-sans" style={{ ...inp, flex: 1 }} />
            <button onClick={addVersion} disabled={busy} className="btn-red" style={{ whiteSpace: "nowrap" }}><span>{busy ? "…" : t({ ar: "إضافة النسخة", en: "Add version" })}</span></button>
          </div>
          <span className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>{t({ ar: "لا تستبدل النسخة السابقة — تبقى متاحة للمعاينة فقط.", en: "Never overwrites the previous version — it stays preview-only." })}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {versions.map((v) => {
          const dec = DECISION[v.decision];
          return (
            <div key={v.id} style={{ background: v.is_current ? "rgba(227,30,36,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${v.is_current ? "rgba(227,30,36,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: "3px", padding: "9px 11px" }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white" style={{ fontSize: "13px", fontWeight: 700 }}>{v.label}</span>
                  {v.is_current && <span className="f-sans" style={{ fontSize: "9px", color: "#E31E24", border: "1px solid rgba(227,30,36,0.4)", borderRadius: "2px", padding: "2px 6px" }}>{t({ ar: "النسخة الحالية", en: "Current" })}</span>}
                  {v.is_final && <span className="f-sans" style={{ fontSize: "9px", color: "#7CFC9A", border: "1px solid rgba(124,252,154,0.4)", borderRadius: "2px", padding: "2px 6px" }}>{t({ ar: "نهائية", en: "Final" })}</span>}
                  <span className="f-sans" style={{ fontSize: "11px", color: dec.c }}>● {t(dec)}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>
                    {v.open_comments > 0 && <span style={{ color: "#ff8a8e" }}>{v.open_comments} {t({ ar: "مفتوح", en: "open" })} </span>}
                    <span style={{ color: "#7CFC9A" }}>{v.resolved_comments} {t({ ar: "محلول", en: "resolved" })}</span>
                  </span>
                  {(v.preview_url || v.vimeo_review_url) && (
                    <button onClick={() => setViewing(v)} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", background: "none", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "3px", padding: "5px 10px", cursor: "pointer" }}>{t({ ar: "معاينة", en: "Preview" })}</button>
                  )}
                  {mode === "admin" && v.decision === "approved" && !v.is_final && deliverable.status !== "final_delivered" && (
                    <button onClick={() => markFinal(v)} disabled={busy} className="f-sans" style={{ fontSize: "11px", color: "#7CFC9A", background: "none", border: "1px solid rgba(124,252,154,0.35)", borderRadius: "3px", padding: "5px 10px", cursor: "pointer" }}>{t({ ar: "تعيين كنهائية", en: "Set Final" })}</button>
                  )}
                </div>
              </div>
              <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
                {v.uploaded_by_name ? `${v.uploaded_by_name} · ` : ""}<span dir="ltr">{new Date(v.uploaded_at).toLocaleString("en-GB")}</span>
                {v.addressed_comment_ids.length > 0 && ` · ${t({ ar: "تعالج", en: "addresses" })} ${v.addressed_comment_ids.length} ${t({ ar: "تعليقًا", en: "comments" })}`}
              </div>
              {v.note && <div className="text-white/70" style={{ fontSize: "12px", marginTop: "3px" }}>{v.note}</div>}
              {v.decision === "revision_requested" && v.revision_reason && (
                <div style={{ marginTop: "5px", borderInlineStart: "2px solid rgba(227,30,36,0.5)", paddingInlineStart: "8px", fontSize: "12px", color: "rgba(255,138,142,0.95)" }}>{v.revision_reason}</div>
              )}
              {/* Client review controls: CURRENT version only, during client_review */}
              {mode === "client" && v.is_current && canReview && owner && deliverable.status === "client_review" && (
                reviseFor === v.id ? (
                  <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <textarea value={reviseNote} onChange={(e) => setReviseNote(e.target.value)} rows={2} placeholder={t({ ar: "صف التعديلات المطلوبة…", en: "Describe the changes…" })} style={{ ...inp, resize: "vertical" }} />
                    <div className="flex gap-2">
                      <button onClick={() => decide(v, "revision_requested", reviseNote.trim() || undefined)} disabled={busy || !reviseNote.trim()} className="btn-red"><span>{t({ ar: "إرسال طلب التعديل", en: "Send revision" })}</span></button>
                      <button onClick={() => { setReviseFor(null); setReviseNote(""); }} className="btn-ghost"><span>{t({ ar: "إلغاء", en: "Cancel" })}</span></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2" style={{ marginTop: "8px" }}>
                    <button onClick={() => decide(v, "approved")} disabled={busy} className="btn-red" style={{ flex: 1, justifyContent: "center" }}><span>{t({ ar: "اعتماد هذه النسخة ✓", en: "Approve this version ✓" })}</span></button>
                    <button onClick={() => setReviseFor(v.id)} disabled={busy} className="btn-ghost" style={{ flex: 1, justifyContent: "center" }}><span>{t({ ar: "طلب تعديل ↺", en: "Request revision ↺" })}</span></button>
                  </div>
                )
              )}
            </div>
          );
        })}
        {versions.length === 0 && <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.35)" }}>{t({ ar: "لا نسخ بعد.", en: "No versions yet." })}</p>}
      </div>
      {msg && <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: "rgba(255,255,255,0.7)" }}>{msg}</div>}
      {viewing && (
        <AnnotationViewer
          deliverableId={deliverable.id} version={viewing} deliverableType={deliverable.type}
          canComment={mode === "client" && !!owner && (deliverable.status === "client_review" || deliverable.status === "revision_requested")}
          onClose={() => { setViewing(null); void load(); }} />
      )}
    </div>
  );
}

const inp: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "8px 10px", color: "#fff", fontSize: "12.5px", outline: "none", fontFamily: "var(--sans)", colorScheme: "dark", width: "100%" };

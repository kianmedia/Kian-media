"use client";
// ════════════════════════════════════════════════════════════════════════
// Client deliverable review (S6-lite). Each client-visible deliverable shows a
// "عرض المعاينة / View Preview" button that opens an in-portal PreviewModal
// (embed + Kian watermark) — NEVER a download. The project owner can Approve /
// Request Revision via submitReview (RLS: client_owner + status client_review;
// trigger flips status + notifies admins).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listDeliverables, submitReview } from "@/lib/portal/deliverables";
import { canApprove } from "@/lib/portal/projects";
import { DLV_STATUS_LABELS } from "@/components/portal/projectMeta";
import PreviewModal from "@/components/portal/PreviewModal";
import type { Deliverable } from "@/lib/portal/types";

const CLIENT_VISIBLE = ["client_review", "revision_requested", "approved", "final_delivered"];

export default function DeliverableReview({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<Deliverable[]>([]);
  const [owner, setOwner] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [reviseNote, setReviseNote] = useState("");
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string | null } | null>(null);

  async function load() {
    const r = await listDeliverables(projectId);
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setItems(r.data.filter((d) => CLIENT_VISIBLE.includes(d.status)));
    setPhase("ready");
  }
  useEffect(() => {
    let alive = true;
    (async () => { await load(); const c = await canApprove(projectId); if (alive) setOwner(c); })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function decide(d: Deliverable, decision: "approved" | "revision_requested", note?: string) {
    setBusyId(d.id); setFlash(null);
    const r = await submitReview(d.id, decision, note);
    setBusyId(null);
    if (!r.ok) { setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر الإرسال: ", en: "Failed: " }) + r.error }); return; }
    setReviseFor(null); setReviseNote("");
    setFlash({ id: d.id, kind: "ok", text: decision === "approved" ? t({ ar: "تم الاعتماد ✓", en: "Approved ✓" }) : t({ ar: "تم إرسال طلب التعديل ✓", en: "Revision requested ✓" }) });
    void load();
  }

  if (phase === "loading") return <P>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</P>;
  if (phase === "error") return <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>;
  if (items.length === 0) return <P>{t({ ar: "لا توجد مخرجات جاهزة للمراجعة حالياً.", en: "No deliverables ready for review yet." })}</P>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {items.map((d) => {
        const dl = DLV_STATUS_LABELS[d.status] ?? { ar: d.status, en: d.status };
        const url = d.vimeo_review_url || d.preview_url;
        const canReview = owner && d.status === "client_review";
        return (
          <div key={d.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "18px" }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-white" style={{ fontSize: "15px", fontWeight: 700 }}>{d.title}</div>
                <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginTop: "3px" }}>{d.type} · v{d.version}</div>
              </div>
              <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "6px 11px", borderRadius: "2px", whiteSpace: "nowrap" }}>{t(dl)}</span>
            </div>

            {/* Review-only notice */}
            <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,210,138,0.85)", lineHeight: 1.6, marginBottom: "12px" }}>
              {t({ ar: "هذه نسخة معاينة للمراجعة فقط، ولا تُعد نسخة نهائية للتسليم.", en: "This is a preview copy for review only and is not the final delivery file." })}
            </p>

            {/* View preview (opens in-portal modal with watermark) — never a download */}
            <button onClick={() => setPreview({ title: d.title, url })} className="btn-red" style={{ justifyContent: "center", marginBottom: canReview ? "14px" : "0" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginInlineEnd: "6px" }}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
              <span>{t({ ar: "عرض المعاينة", en: "View Preview" })}</span>
            </button>

            {/* Approve / Request revision — owner only, during client_review */}
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
            {!owner && d.status === "client_review" && (
              <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                {t({ ar: "الاعتماد وطلب التعديل متاحان لمالك حساب العميل فقط.", en: "Approve / request revision is available to the client account owner only." })}
              </p>
            )}
            {flash && flash.id === d.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
          </div>
        );
      })}

      {preview && <PreviewModal title={preview.title} url={preview.url} onClose={() => setPreview(null)} />}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-white/45" style={{ fontSize: "13.5px", lineHeight: 1.7 }}>{children}</p>;
}

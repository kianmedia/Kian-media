"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin-only "Client notes & revision requests" section. Surfaces every
// deliverable_reviews row for this project's deliverables — the exact note a
// client wrote when approving or requesting a revision — which previously had
// no UI on the admin side. Reviewer identity is resolved from profiles
// (admin-all RLS). Read-only; clients/leads never render this component.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminListSenders, type SenderProfile } from "@/lib/portal/admin";
import { REVIEW_DECISION_LABELS, deliverableStatusLabel } from "@/components/portal/projectMeta";
import type { Deliverable, DeliverableReview } from "@/lib/portal/types";

export default function AdminClientNotes({
  deliverables, reviews, loading,
}: { deliverables: Deliverable[]; reviews: DeliverableReview[]; loading: boolean }) {
  const { t, isAr } = useI18n();
  const [senders, setSenders] = useState<Record<string, SenderProfile>>({});

  useEffect(() => {
    const ids = Array.from(new Set(reviews.map((r) => r.reviewer_id)));
    if (ids.length === 0) { setSenders({}); return; }
    let alive = true;
    (async () => {
      const r = await adminListSenders(ids);
      if (!alive || !r.ok) return;
      setSenders(Object.fromEntries(r.data.map((p) => [p.id, p])));
    })();
    return () => { alive = false; };
  }, [reviews]);

  if (loading) return <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>;

  if (reviews.length === 0) {
    return <p className="text-white/45" style={{ fontSize: "13.5px", lineHeight: 1.7 }}>{t({ ar: "لا توجد ملاحظات من العميل حتى الآن", en: "No client notes yet" })}</p>;
  }

  const dlvById = new Map(deliverables.map((d) => [d.id, d]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {reviews.map((r) => {
        const d = dlvById.get(r.deliverable_id);
        const who = senders[r.reviewer_id];
        const decision = REVIEW_DECISION_LABELS[r.decision] ?? { ar: r.decision, en: r.decision };
        const isRevision = r.decision === "revision_requested";
        return (
          <div key={r.id} style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${isRevision ? "rgba(227,30,36,0.3)" : "rgba(124,252,154,0.22)"}`, borderRadius: "3px", padding: "14px 16px" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: "8px" }}>
              <div style={{ minWidth: 0 }}>
                <div className="text-white" style={{ fontSize: "13.5px", fontWeight: 600 }}>
                  {who ? (who.full_name || who.email) : t({ ar: "عميل", en: "Client" })}
                  {who?.full_name && who.email && <span className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginInlineStart: "8px", direction: "ltr", unicodeBidi: "plaintext" }}>{who.email}</span>}
                </div>
                <div className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
                  {d ? `${d.title} · v${d.version}` : t({ ar: "مخرَج محذوف", en: "Deleted deliverable" })}
                </div>
              </div>
              <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: isRevision ? "#ff8a8e" : "#7CFC9A", background: isRevision ? "rgba(227,30,36,0.1)" : "rgba(124,252,154,0.08)", border: `1px solid ${isRevision ? "rgba(227,30,36,0.3)" : "rgba(124,252,154,0.25)"}`, padding: "5px 10px", borderRadius: "2px", whiteSpace: "nowrap" }}>
                {isAr ? decision.ar : decision.en}
              </span>
            </div>

            {r.comments?.trim() ? (
              <p className="text-white/85" style={{ fontSize: "13.5px", lineHeight: 1.7, whiteSpace: "pre-wrap", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "3px", padding: "10px 12px" }}>{r.comments}</p>
            ) : (
              <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>{t({ ar: "بدون ملاحظة نصية.", en: "No written note." })}</p>
            )}

            <div className="f-sans flex items-center gap-3 flex-wrap" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>
              <span style={{ direction: "ltr", unicodeBidi: "plaintext" }}>{new Date(r.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")} · {new Date(r.created_at).toLocaleTimeString(isAr ? "ar-SA" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
              {d && <span>{t({ ar: "الحالة الحالية: ", en: "Current status: " })}{isAr ? deliverableStatusLabel(d.status).ar : deliverableStatusLabel(d.status).en}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

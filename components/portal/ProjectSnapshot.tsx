"use client";
// One authoritative operational snapshot (P0-1/2/3) — lifecycle timeline with real
// completed/current/upcoming states + shooting/review/delivery status cards, all
// derived server-side so no card can contradict the progress. Same for admin & client.
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { projectSnapshot, type OperationalSnapshot } from "@/lib/portal/projects";
import { lifecycleTimeline, type LifecycleStepState } from "@/lib/project-core/lifecycle";

const SHOOTING: Record<string, { ar: string; en: string; c: string }> = {
  not_required: { ar: "غير مطلوب", en: "Not required", c: "rgba(255,255,255,0.5)" },
  not_started: { ar: "لم يبدأ التصوير", en: "Not started", c: "rgba(255,255,255,0.5)" },
  scheduled: { ar: "مجدول", en: "Scheduled", c: "rgba(255,210,138,0.9)" },
  in_progress: { ar: "جاري التصوير", en: "Filming", c: "rgba(255,210,138,0.95)" },
  completed: { ar: "اكتمل التصوير", en: "Completed", c: "#7CFC9A" },
};
const REVIEW: Record<string, { ar: string; en: string; c: string }> = {
  not_started: { ar: "لم تبدأ المراجعة", en: "Not started", c: "rgba(255,255,255,0.5)" },
  internal_review: { ar: "مراجعة داخلية", en: "Internal review", c: "rgba(255,210,138,0.9)" },
  awaiting_client_review: { ar: "بانتظار مراجعتك", en: "Awaiting your review", c: "rgba(140,190,255,0.95)" },
  revision_requested: { ar: "طلب تعديل", en: "Revision requested", c: "#ff8a8e" },
  approved: { ar: "معتمد", en: "Approved", c: "#7CFC9A" },
};
const DELIVERY: Record<string, { ar: string; en: string; c: string }> = {
  not_ready: { ar: "غير جاهز", en: "Not ready", c: "rgba(255,255,255,0.5)" },
  ready_for_delivery: { ar: "جاهز للتسليم", en: "Ready to deliver", c: "rgba(255,210,138,0.9)" },
  payment_pending: { ar: "بانتظار الدفع", en: "Payment pending", c: "rgba(255,210,138,0.95)" },
  released: { ar: "تم فتح الوصول", en: "Released", c: "#7CFC9A" },
  delivered: { ar: "تم التسليم", en: "Delivered", c: "#7CFC9A" },
  revoked: { ar: "الوصول موقوف", en: "Access revoked", c: "#ff8a8e" },
};

export default function ProjectSnapshot({ projectId, refreshSignal, onCurrentStage }: { projectId: string; refreshSignal?: number; onCurrentStage?: (coreStage: string | null) => void }) {
  const { t, isAr } = useI18n();
  const [s, setS] = useState<OperationalSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await projectSnapshot(projectId);
    // current_phase = project_core.core_stage (the single source of truth) — lift it
    // so the header badge shows the exact 13-stage lifecycle name, not a stale one.
    if (r.ok) { setS(r.data); setErr(null); onCurrentStage?.(r.data.current_phase); } else setErr(r.error);
  }, [projectId, onCurrentStage]);
  useEffect(() => { void load(); }, [load, refreshSignal]);

  if (err) return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "تعذّر تحميل حالة المشروع.", en: "Couldn't load the project status." })}</p>;
  if (!s) return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;

  // Timeline is derived DIRECTLY from core_stage (current_phase) — never from
  // projects.status, deliverables, or progress. Going back a stage lowers it at once.
  const steps = lifecycleTimeline(s.current_phase);
  const stepStyle = (st: LifecycleStepState) => {
    switch (st) {
      case "completed": return { dot: "#7CFC9A", ring: "#7CFC9A", line: "#7CFC9A", label: "rgba(255,255,255,0.85)", mark: "✓" };
      case "current": return { dot: "#E31E24", ring: "#E31E24", line: "rgba(255,255,255,0.12)", label: "#fff", mark: "●" };
      default: return { dot: "rgba(255,255,255,0.18)", ring: "rgba(255,255,255,0.2)", line: "rgba(255,255,255,0.1)", label: "rgba(255,255,255,0.35)", mark: "" };
    }
  };

  const Card = ({ label, m }: { label: { ar: string; en: string }; m: { ar: string; en: string; c: string } }) => (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "12px 14px" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: "5px" }}>{t(label)}</div>
      <div className="f-sans" style={{ fontSize: "13.5px", fontWeight: 600, color: m.c }}>{t(m)}</div>
    </div>
  );

  return (
    <div>
      {/* Lifecycle timeline — real states, scrolls on narrow screens */}
      <div style={{ overflowX: "auto", paddingBottom: "4px", marginBottom: "18px" }}>
        <div className="flex items-start" dir="ltr" style={{ minWidth: `${steps.length * 82}px`, gap: 0 }}>
          {steps.map((step, i) => {
            const st = stepStyle(step.state);
            const isLast = i === steps.length - 1;
            return (
              <div key={step.key} className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center" style={{ width: "100%" }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: step.state === "completed" ? st.dot : "transparent", border: `2px solid ${st.ring}`, color: step.state === "completed" ? "#0a0a0a" : st.dot, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{st.mark}</span>
                  {!isLast && <div style={{ height: 2, flex: 1, background: st.line }} />}
                </div>
                <div className="f-sans" style={{ marginTop: 8, paddingInlineEnd: 8, fontSize: 9.5, lineHeight: 1.4, color: st.label, direction: isAr ? "rtl" : "ltr", textAlign: isAr ? "right" : "left" }}>
                  {isAr ? step.ar : step.en}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status cards — never contradict the progress/lifecycle */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "10px" }}>
        <Card label={{ ar: "حالة التصوير", en: "Shooting" }} m={SHOOTING[s.shooting_status] ?? SHOOTING.not_started} />
        <Card label={{ ar: "حالة المراجعة", en: "Review" }} m={REVIEW[s.review_status] ?? REVIEW.not_started} />
        <Card label={{ ar: "حالة التسليم", en: "Delivery" }} m={DELIVERY[s.delivery_status] ?? DELIVERY.not_ready} />
        {s.unresolved_comments > 0 && (
          <div style={{ background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "4px", padding: "12px 14px" }}>
            <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: "5px" }}>{t({ ar: "تعليقات مفتوحة", en: "Open comments" })}</div>
            <div className="f-sans" style={{ fontSize: "13.5px", fontWeight: 700, color: "#ff8a8e" }} dir="ltr">{s.unresolved_comments}</div>
          </div>
        )}
      </div>
    </div>
  );
}

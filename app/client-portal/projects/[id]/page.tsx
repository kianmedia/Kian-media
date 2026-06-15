"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/projects/[id] — project detail (S3 minimal).
// Read-only overview: timeline, delivery/review status, shoot date,
// client-visible deliverables, and a minimal project-messages list.
// Full interactive workspace (review actions, chat composer, notes) = S7/S8.
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { getProject, listChat } from "@/lib/portal/projects";
import {
  STATUS_STEPS, projectStatusLabel, DELIVERY_LABELS, REVISION_LABELS,
} from "@/components/portal/projectMeta";
import DeliverableReview from "@/components/portal/DeliverableReview";
import AdminDeliverables from "@/components/portal/AdminDeliverables";
import type { Project, ProjectMessage } from "@/lib/portal/types";

export default function ProjectDetailPage() {
  const { t, isAr } = useI18n();
  const { profile } = usePortal();
  const isAdmin = profile.account_type === "admin";
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [phase, setPhase] = useState<"loading" | "error" | "notfound" | "ready">("loading");
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const pr = await getProject(id);
      if (!alive) return;
      if (!pr.ok) { setErr(pr.error); setPhase("error"); return; }
      if (!pr.data) { setPhase("notfound"); return; }
      setProject(pr.data);

      // Chat is non-fatal. Deliverables are loaded by the role-aware sub-component.
      const ch = await listChat(id);
      if (!alive) return;
      if (ch.ok) setMessages(ch.data);
      setPhase("ready");
    })();
    return () => { alive = false; };
  }, [id]);

  const back = (
    <Link href="/client-portal/projects" className="f-sans inline-flex items-center gap-2 mb-8"
      style={{ fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", textDecoration: "none" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "none" : "scaleX(-1)" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
      {t({ ar: "العودة للمشاريع", en: "Back to Projects" })}
    </Link>
  );

  if (phase === "loading") {
    return <div>{back}<div className="f-sans text-center" style={{ padding: "60px 0", fontSize: "12px", letterSpacing: "3px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div></div>;
  }
  if (phase === "notfound") {
    return <div>{back}<div className="text-center" style={{ padding: "60px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}><p className="text-white/55" style={{ fontSize: "15px" }}>{t({ ar: "المشروع غير موجود أو لا تملك صلاحية الوصول إليه.", en: "Project not found, or you don't have access to it." })}</p></div></div>;
  }
  if (phase === "error") {
    return <div>{back}<div className="f-sans" style={{ padding: "16px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{t({ ar: "تعذّر التحميل: ", en: "Couldn't load: " })}{err}</div></div>;
  }

  const p = project!;
  const stepIndex = Math.max(0, STATUS_STEPS.findIndex((s) => s.key === p.status));
  const statusLabel = projectStatusLabel(p.status);
  const delivery = DELIVERY_LABELS[p.delivery_status || "pending"] || DELIVERY_LABELS.pending;
  const revision = REVISION_LABELS[p.revision_status || "none"] || REVISION_LABELS.none;

  return (
    <div>
      {back}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-9">
        <h1 className="text-white" style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)", lineHeight: 1.25 }}>
          {p.project_name}
        </h1>
        <span className="f-sans" style={{ fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "8px 15px", borderRadius: "2px", whiteSpace: "nowrap" }}>
          {t(statusLabel)}
        </span>
      </div>

      {/* Timeline */}
      <Section title={t({ ar: "مراحل المشروع", en: "Project Timeline" })}>
        <div className="flex items-center" dir="ltr" style={{ gap: 0 }}>
          {STATUS_STEPS.map((s, i) => {
            const done = i <= stepIndex;
            return (
              <div key={s.key} className="flex items-center" style={{ flex: i === STATUS_STEPS.length - 1 ? "0 0 auto" : "1 1 0%" }}>
                <div style={{ width: "14px", height: "14px", borderRadius: "50%", flexShrink: 0, background: done ? "#E31E24" : "rgba(255,255,255,0.08)", border: `2px solid ${done ? "#E31E24" : "rgba(255,255,255,0.2)"}`, boxShadow: done ? "0 0 10px rgba(227,30,36,0.5)" : "none" }} />
                {i < STATUS_STEPS.length - 1 && (
                  <div style={{ height: "2px", flex: 1, background: i < stepIndex ? "#E31E24" : "rgba(255,255,255,0.1)" }} />
                )}
              </div>
            );
          })}
        </div>
        <div className="hidden md:flex" dir="ltr" style={{ marginTop: "10px" }}>
          {STATUS_STEPS.map((s, i) => (
            <div key={s.key} className="f-sans" style={{ flex: i === STATUS_STEPS.length - 1 ? "0 0 auto" : "1 1 0%", fontSize: "9.5px", letterSpacing: "0.3px", color: i <= stepIndex ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.3)", textAlign: i === STATUS_STEPS.length - 1 ? "right" : "left", paddingInlineEnd: "6px" }}>
              {t({ ar: s.ar, en: s.en })}
            </div>
          ))}
        </div>
      </Section>

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-9">
        <Detail label={t({ ar: "تاريخ التصوير", en: "Shooting Date" })} value={p.shooting_date || t({ ar: "لم يُحدد بعد", en: "Not set yet" })} />
        <Detail label={t({ ar: "حالة التسليم", en: "Delivery Status" })} value={t(delivery)} />
        <Detail label={t({ ar: "حالة المراجعات", en: "Revision Status" })} value={t(revision)} />
      </div>

      {/* Deliverables — admin manages; client reviews (preview modal + approve/revise) */}
      <Section title={isAdmin ? t({ ar: "إدارة مخرجات المراجعة", en: "Manage Review Deliverables" }) : t({ ar: "المراجعة", en: "Review" })}>
        {isAdmin ? <AdminDeliverables projectId={id} /> : <DeliverableReview projectId={id} />}
      </Section>

      {/* Project messages (minimal list) */}
      <Section title={t({ ar: "محادثة المشروع", en: "Project Messages" })}>
        {messages.length === 0 ? (
          <p className="text-white/45" style={{ fontSize: "13.5px", lineHeight: 1.7 }}>
            {t({ ar: "لا توجد رسائل في هذا المشروع بعد.", en: "No messages on this project yet." })}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {messages.map((m) => {
              const mine = m.sender_role === "client";
              return (
                <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", padding: "11px 14px", borderRadius: "8px", background: mine ? "rgba(227,30,36,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${mine ? "rgba(227,30,36,0.25)" : "rgba(255,255,255,0.08)"}` }}>
                  <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>
                    {mine ? t({ ar: "أنت", en: "You" }) : t({ ar: "كيان ميديا", en: "Kian Media" })}
                  </div>
                  <div className="text-white/80" style={{ fontSize: "13.5px", lineHeight: 1.6 }}>{m.body}</div>
                </div>
              );
            })}
            <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", lineHeight: 1.7, marginTop: "4px" }}>
              {t({ ar: "إرسال الرسائل — قادم في تحديث البوابة القادم.", en: "Sending messages — coming in the next portal update." })}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "30px" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600, marginBottom: "14px" }}>{title}</div>
      <div style={{ padding: "20px 22px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px" }}>
        {children}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "14px 16px", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1.5px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
      <div className="text-white" style={{ fontSize: "14.5px", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/projects/[id] — project detail.
// Overview: timeline, computed summary cards (delivery/review derived from live
// deliverable + review data), role-aware deliverables block (admin manages /
// client reviews), an admin-only client-notes section, and project messages.
// Deliverables + reviews are fetched once here and shared with the children so
// the summary cards stay in sync with every add/status/approval action.
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { getProject, listChat } from "@/lib/portal/projects";
import { listDeliverables, listReviewsForDeliverables } from "@/lib/portal/deliverables";
import { adminListClientsByIds, adminListProjectMembers, adminListSenders, type SenderProfile } from "@/lib/portal/admin";
import { lifecycleLabel } from "@/lib/project-core/lifecycle";
import ProjectSnapshot from "@/components/portal/ProjectSnapshot";
import { PROJECT_STAFF_ROLES } from "@/lib/portal/roles";
import DeliverableReview from "@/components/portal/DeliverableReview";
import AdminDeliverables from "@/components/portal/AdminDeliverables";
import TimelineView from "@/components/portal/TimelineView";
import PreProductionCenter from "@/components/portal/PreProductionCenter";
import ProjectProgressBar from "@/components/portal/ProjectProgressBar";
import EditorDeliverables from "@/components/portal/EditorDeliverables";
import AdminClientNotes from "@/components/portal/AdminClientNotes";
import AdminProjectStage from "@/components/portal/AdminProjectStage";
import type { Project, ProjectMessage, Deliverable, DeliverableReview as Review, ProjectMember } from "@/lib/portal/types";

export default function ProjectDetailPage() {
  const { t, isAr } = useI18n();
  const { profile, caps } = usePortal();
  const isAdmin = profile.account_type === "admin";              // owner: full admin writes
  // Staff who manage review deliverables via the staff-safe RPCs (never final_delivered):
  const canEditDlv = caps.isEditor || caps.view === "manager" || caps.view === "super_admin";
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [phase, setPhase] = useState<"loading" | "error" | "notfound" | "ready">("loading");
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [err, setErr] = useState("");
  // Current lifecycle stage = project_core.core_stage, surfaced by ProjectSnapshot
  // (its current_phase). Single source of truth for the header badge + timeline.
  const [coreStage, setCoreStage] = useState<string | null>(null);

  // Shared deliverable/review data (powers the summary cards + both sub-views).
  const [dlvPhase, setDlvPhase] = useState<"loading" | "ready" | "error">("loading");
  const [dlvs, setDlvs] = useState<Deliverable[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  // Client email — admin only, for the "ready for preview" email recipient.
  const [clientEmail, setClientEmail] = useState<string | null>(null);

  const loadDeliverables = useCallback(async () => {
    const dr = await listDeliverables(id);
    if (!dr.ok) { setDlvPhase("error"); return; }
    setDlvs(dr.data);
    const rr = await listReviewsForDeliverables(dr.data.map((d) => d.id));
    setReviews(rr.ok ? rr.data : []);
    setDlvPhase("ready");
  }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const pr = await getProject(id);
      if (!alive) return;
      if (!pr.ok) { setErr(pr.error); setPhase("error"); return; }
      if (!pr.data) { setPhase("notfound"); return; }
      setProject(pr.data);

      // Chat is non-fatal.
      const ch = await listChat(id);
      if (!alive) return;
      if (ch.ok) setMessages(ch.data);
      setPhase("ready");
    })();
    return () => { alive = false; };
  }, [id]);

  useEffect(() => { void loadDeliverables(); }, [loadDeliverables]);

  // Resolve the client's email (admin only) so the "ready for preview" email has
  // a recipient. Clients never run this (admin-only RLS on the clients table).
  useEffect(() => {
    if (!isAdmin || !project?.client_id) return;
    let alive = true;
    (async () => {
      const r = await adminListClientsByIds([project.client_id]);
      if (alive && r.ok) setClientEmail(r.data[0]?.email ?? null);
    })();
    return () => { alive = false; };
  }, [isAdmin, project?.client_id]);

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
  // Header badge = the current lifecycle stage from core_stage (single source of
  // truth), surfaced by ProjectSnapshot — NOT the legacy computeTimelineIndex/status.
  const statusLabel = lifecycleLabel(coreStage);

  return (
    <div>
      {back}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-9">
        <h1 className="text-white" style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)", lineHeight: 1.25 }}>
          {p.project_name}
        </h1>
        {coreStage && (
          <span className="f-sans" style={{ fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "8px 15px", borderRadius: "2px", whiteSpace: "nowrap" }}>
            {t(statusLabel)}
          </span>
        )}
      </div>

      {/* Authoritative overall progress (P0-9) — same value admin & client see */}
      <div style={{ maxWidth: "560px", marginBottom: "28px" }}>
        <ProjectProgressBar projectId={id} />
      </div>

      {/* Authoritative lifecycle timeline (states) + shooting/review/delivery cards,
          all from project_operational_snapshot — no card can contradict the progress. */}
      <Section title={t({ ar: "مرحلة المشروع", en: "Project Stage" })}>
        <ProjectSnapshot projectId={id} onCurrentStage={setCoreStage} />
      </Section>

      {/* Admin-only: read-only stage mirror (stage is set via the Project Core lifecycle) */}
      {isAdmin && (
        <Section title={t({ ar: "مرحلة المشروع (مشتقّة من دورة الحياة)", en: "Project Stage (derived from lifecycle)" })}>
          <AdminProjectStage current={p.status} />
        </Section>
      )}

      {/* Assigned staff (admin area: owner/super_admin/manager) */}
      {caps.isAdminArea && (
        <Section title={t({ ar: "الطاقم المكلّف", en: "Assigned Staff" })}>
          <AssignedStaff projectId={id} />
        </Section>
      )}

      {/* §4 Pre-production center — staff manage; client sees only shared items */}
      <Section title={t({ ar: "مركز ما قبل الإنتاج", en: "Pre-Production" })}>
        <PreProductionCenter projectId={id} canManage={isAdmin || canEditDlv} projectName={p.project_name} />
      </Section>

      {/* Deliverables — owner manages (full); editor/manager manage via staff RPCs
          (no final delivery); everyone else reviews (preview modal + approve/revise). */}
      <Section title={(isAdmin || canEditDlv) ? t({ ar: "إدارة مخرجات المراجعة", en: "Manage Review Deliverables" }) : t({ ar: "المراجعة", en: "Review" })}>
        {dlvPhase === "loading" ? (
          <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>
        ) : dlvPhase === "error" ? (
          <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل المخرجات.", en: "Couldn't load deliverables." })}</div>
        ) : isAdmin ? (
          <AdminDeliverables projectId={id} projectName={p.project_name} clientEmail={clientEmail} items={dlvs} reviews={reviews} onChanged={loadDeliverables} />
        ) : canEditDlv ? (
          <EditorDeliverables projectId={id} items={dlvs} reviews={reviews} onChanged={loadDeliverables} />
        ) : (
          <DeliverableReview projectId={id} projectName={p.project_name} items={dlvs} reviews={reviews} onChanged={loadDeliverables} />
        )}
      </Section>

      {/* Client notes & revision requests — owner + assigned editors/managers */}
      {(isAdmin || canEditDlv) && (
        <Section title={t({ ar: "ملاحظات العميل وطلبات التعديل", en: "Client Notes & Revision Requests" })}>
          <AdminClientNotes deliverables={dlvs} reviews={reviews} loading={dlvPhase === "loading"} />
        </Section>
      )}

      {/* §6 Project timeline — role-scoped (client sees only client-visible events) */}
      <Section title={t({ ar: "سجلّ المشروع الزمني", en: "Project Timeline" })}>
        <TimelineView projectId={id} />
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

// Read-only list of Kian staff assigned to this project (kian_* members). Names
// resolve from profiles when readable; assignment itself is done on the Staff page.
function AssignedStaff({ projectId }: { projectId: string }) {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = useState<{ member: ProjectMember; name: string }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await adminListProjectMembers(projectId);
      if (!alive) return;
      if (!r.ok) { setPhase("error"); return; }
      const kian = r.data.filter((m) => m.role.startsWith("kian_"));
      let senders: Record<string, SenderProfile> = {};
      if (kian.length) {
        const s = await adminListSenders(kian.map((m) => m.user_id));
        if (s.ok) senders = Object.fromEntries(s.data.map((p) => [p.id, p]));
      }
      if (!alive) return;
      setRows(kian.map((m) => ({ member: m, name: senders[m.user_id]?.full_name || senders[m.user_id]?.email || m.user_id })));
      setPhase("ready");
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (phase === "loading") return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>;
  if (phase === "error") return <p className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل الطاقم.", en: "Couldn't load staff." })}</p>;
  if (rows.length === 0) return <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "لا يوجد طاقم مكلّف بعد — كلّف من صفحة الموظفين.", en: "No staff assigned yet — assign from the Staff page." })}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {rows.map(({ member, name }) => {
        const lbl = PROJECT_STAFF_ROLES.find((r) => r.key === member.role);
        return (
          <div key={member.id} className="flex items-center justify-between gap-3" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "9px 12px" }}>
            <span className="text-white" style={{ fontSize: "13px", fontWeight: 600, direction: name.includes("@") ? "ltr" : undefined }}>{name}</span>
            <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{lbl ? (isAr ? lbl.ar : lbl.en) : member.role}</span>
          </div>
        );
      })}
    </div>
  );
}

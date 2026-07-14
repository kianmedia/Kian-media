"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/projects — minimal real projects list (S3).
// Each card links to /client-portal/projects/[id]. Full workspace = S7.
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { listMyProjects } from "@/lib/portal/projects";
import { projectStatusLabel } from "@/components/portal/projectMeta";
import AdminProjects from "@/components/portal/AdminProjects";
import type { Project } from "@/lib/portal/types";

// Role switch: admin → project management (status control); client/lead → list.
export default function ProjectsPage() {
  const { profile } = usePortal();
  return profile.account_type === "admin" ? <AdminProjects /> : <ClientProjects />;
}

function ClientProjects() {
  const { t, isAr } = useI18n();
  const { profile } = usePortal();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await listMyProjects();
      if (!alive) return;
      if (!r.ok) { setErr(r.error); setPhase("error"); return; }
      setProjects(r.data);
      setPhase("ready");
    })();
    return () => { alive = false; };
  }, []);

  // الموظف المكلَّف (staff_role مُعيَّن) قد يبقى account_type='lead'؛ لا نعرض له حالة العميل الفارغة —
  // بل نُظهر مشاريعه المسندة (RLS تُرجِعها عبر project_members). حالة "وقّع أول عرض سعر" لِلـlead الحقيقي فقط.
  if (profile.account_type === "lead" && !profile.staff_role) {
    return (
      <div className="text-center" style={{ padding: "70px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
        <p className="text-white/55" style={{ fontSize: "15px", lineHeight: 1.85 }}>
          {t({
            ar: "تظهر المشاريع هنا بعد توقيع أول عرض سعر مع كيان ميديا.",
            en: "Projects appear here once your first quotation with Kian Media is signed.",
          })}
        </p>
      </div>
    );
  }

  if (phase === "loading") {
    return <div className="f-sans text-center" style={{ padding: "80px 0", fontSize: "12px", letterSpacing: "3px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
      {t({ ar: "جارٍ التحميل...", en: "Loading..." })}
    </div>;
  }
  if (phase === "error") {
    return <div className="f-sans" style={{ padding: "16px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>
      {t({ ar: "تعذّر تحميل المشاريع: ", en: "Couldn't load projects: " })}{err}
    </div>;
  }

  if (projects.length === 0) {
    return (
      <div className="text-center" style={{ padding: "70px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>
          {t({ ar: "لا توجد مشاريع بعد — سيظهر مشروعك هنا فور تسجيله.", en: "No projects yet — your project will appear here once registered." })}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {projects.map((p) => {
        const label = projectStatusLabel(p.status);
        return (
          <Link
            key={p.id}
            href={`/client-portal/projects/${p.id}`}
            className="pt-card"
            style={{
              display: "block", textDecoration: "none",
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "4px", padding: "clamp(20px,3vw,28px)", transition: "all 0.4s",
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="text-white" style={{ fontSize: "clamp(17px,2.4vw,21px)", fontWeight: 700, fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)" }}>
                {p.project_name}
              </h3>
              <span className="f-sans" style={{ fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "7px 14px", borderRadius: "2px", whiteSpace: "nowrap" }}>
                {t(label)}
              </span>
            </div>
            <div className="f-sans mt-3 inline-flex items-center gap-1.5" style={{ fontSize: "10px", letterSpacing: "2px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", fontWeight: 600 }}>
              {t({ ar: "عرض التفاصيل", en: "View Details" })}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "scaleX(-1)" : "none" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

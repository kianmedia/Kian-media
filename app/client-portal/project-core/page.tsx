"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/project-core — منصّة إدارة وتشغيل المشاريع (staff/owner فقط).
// القراءات/الكتابات كلها RLS + SECURITY DEFINER (project_core_FINAL_RUNME.sql).
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import ProjectCoreDashboard from "@/components/portal/projectcore/ProjectCoreDashboard";

export default function ProjectCorePage() {
  const { t } = useI18n();
  const { caps } = usePortal();
  if (!(caps.isStaff || caps.isAdminArea)) {
    return (
      <div className="text-center" style={{ padding: "70px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>
          {t({ ar: "هذه المنصّة مخصّصة لفريق كيان ميديا.", en: "This platform is for the Kian Media team." })}
        </p>
      </div>
    );
  }
  return <ProjectCoreDashboard />;
}

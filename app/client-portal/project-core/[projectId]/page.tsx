"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/project-core/[projectId] — صفحة تشغيل المشروع المستقلة (staff).
// رأس + لوحة تشغيل كاملة (دورة الحياة + الملخّص + كل التبويبات) عبر ProjectOps.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { getProject } from "@/lib/portal/projects";
import { pcArchiveProject, pcErr } from "@/lib/portal/projectCore";
import ProjectOps from "@/components/portal/projectcore/ProjectOps";
import type { Project } from "@/lib/portal/types";

export default function ProjectCoreDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const { t } = useI18n();
  const { caps } = usePortal();
  const [project, setProject] = useState<Project | null>(null);
  const [phase, setPhase] = useState<"loading" | "notfound" | "denied" | "ready">("loading");

  useEffect(() => {
    if (!(caps.isStaff || caps.isAdminArea)) { setPhase("denied"); return; }
    let alive = true;
    void getProject(projectId).then((r) => {
      if (!alive) return;
      if (!r.ok || !r.data) { setPhase("notfound"); return; }
      setProject(r.data); setPhase("ready");
    });
    return () => { alive = false; };
  }, [projectId, caps.isStaff, caps.isAdminArea]);

  async function archive() {
    if (!window.confirm(t({ ar: "أرشفة هذا المشروع؟ (حذف ناعم)", en: "Archive this project? (soft delete)" }))) return;
    const r = await pcArchiveProject(projectId);
    if (!r.ok) { window.alert(pcErr(r.error)); return; }
    window.location.href = "/client-portal/project-core";
  }

  if (phase === "denied") return <div className="text-center text-white/55" style={{ padding: "60px 24px" }}>{t({ ar: "هذه المنصّة لفريق كيان ميديا.", en: "For the Kian Media team." })}</div>;
  if (phase === "loading") return <div className="text-center text-white/45 f-sans" style={{ padding: "70px 0", letterSpacing: "3px", textTransform: "uppercase", fontSize: "12px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>;
  if (phase === "notfound") return (
    <div className="text-center" style={{ padding: "60px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
      <p className="text-white/55">{t({ ar: "المشروع غير موجود أو لا تملك صلاحية الوصول.", en: "Project not found or no access." })}</p>
      <Link href="/client-portal/project-core" className="inline-block mt-3 text-xs text-stone-400 hover:text-white">← {t({ ar: "رجوع للوحة القيادة", en: "Back to dashboard" })}</Link>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <Link href="/client-portal/project-core" className="text-xs text-stone-400 hover:text-white">← {t({ ar: "المشاريع", en: "Projects" })}</Link>
          <h2 className="text-lg font-semibold text-white truncate" dir="auto">{project?.project_name || t({ ar: "مشروع", en: "Project" })}</h2>
        </div>
        {caps.isAdminArea && <button onClick={() => void archive()} className="text-xs text-stone-500 hover:text-red-400 border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "أرشفة", en: "Archive" })}</button>}
      </div>
      <ProjectOps projectId={projectId} projectName={project?.project_name ?? projectId} />
    </div>
  );
}

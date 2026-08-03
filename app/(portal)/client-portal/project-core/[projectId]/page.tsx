"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/project-core/[projectId] — صفحة تشغيل المشروع المستقلة (staff).
// رأس + لوحة تشغيل كاملة (دورة الحياة + الملخّص + كل التبويبات) عبر ProjectOps.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { getProject } from "@/lib/portal/projects";
import { pcArchiveProject, pcSoftDeleteProject, pcErr } from "@/lib/portal/projectCore";
import ProjectOps from "@/components/portal/projectcore/ProjectOps";
import EditProjectModal from "@/components/portal/projectcore/EditProjectModal";
import type { Project } from "@/lib/portal/types";

export default function ProjectCoreDetailPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const tabParam = useSearchParams().get("tab") ?? undefined;   // رابط مباشر: /project-core/[id]?tab=shoots
  const { t } = useI18n();
  const { caps } = usePortal();
  const [project, setProject] = useState<Project | null>(null);
  const [phase, setPhase] = useState<"loading" | "notfound" | "denied" | "ready">("loading");
  const [showEdit, setShowEdit] = useState(false);
  const [rev, setRev] = useState(0);

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
    const reason = window.prompt(t({ ar: "سبب الأرشفة (إلزامي):", en: "Archive reason (required):" }));
    if (reason === null) return;
    if (!reason.trim()) { window.alert(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    const r = await pcArchiveProject(projectId, reason.trim());
    if (!r.ok) { window.alert(pcErr(r.error)); return; }
    window.location.href = "/client-portal/project-core";
  }
  async function softDelete() {
    if (!window.confirm(t({ ar: `حذف المشروع «${project?.project_name ?? ""}»؟ سيُخفى من القوائم وتبقى سجلاته.`, en: "Delete this project? It is hidden but records are kept." }))) return;
    const reason = window.prompt(t({ ar: "سبب الحذف (إلزامي):", en: "Delete reason (required):" }));
    if (reason === null) return;
    if (!reason.trim()) { window.alert(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    const r = await pcSoftDeleteProject(projectId, reason.trim());
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
        <div className="flex items-center gap-2">
          {(caps.isAdminArea || caps.isEditor) && <button onClick={() => setShowEdit(true)} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5 hover:border-stone-500">{t({ ar: "تعديل المشروع", en: "Edit" })}</button>}
          {caps.isAdminArea && <button onClick={() => void archive()} className="text-xs text-stone-400 hover:text-amber-400 border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "أرشفة", en: "Archive" })}</button>}
          {caps.isOwner && <button onClick={() => void softDelete()} className="text-xs text-stone-500 hover:text-red-400 border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "حذف", en: "Delete" })}</button>}
        </div>
      </div>
      <ProjectOps key={rev} projectId={projectId} projectName={project?.project_name ?? projectId} initialTab={tabParam} />
      {showEdit && <EditProjectModal projectId={projectId} onClose={() => setShowEdit(false)} onSaved={() => { void getProject(projectId).then((r) => { if (r.ok && r.data) setProject(r.data); }); setRev((v) => v + 1); router.refresh(); /* مزامنة بطاقة القائمة: الاسم يظهر في project_core_dashboard */ }} />}
    </div>
  );
}

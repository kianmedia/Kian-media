"use client";
// ════════════════════════════════════════════════════════════════════════
// Read-only project-stage mirror (project detail page). Project stage is now
// DERIVED from the project lifecycle (project_core.core_stage) — the single
// source of truth — and mirrored into projects.status by project_core_set_stage.
// This panel used to write projects.status independently (a second, divergent
// dropdown); that is removed. To change the stage, use the lifecycle control in
// «منصّة المشاريع» (Project Core); the change reflects here automatically.
// ════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import { projectStatusLabel } from "@/components/portal/projectMeta";

export default function AdminProjectStage({ current }: { current: string }) {
  const { t } = useI18n();
  const label = projectStatusLabel(current);
  return (
    <div>
      <label className="f-sans block" style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: "8px" }}>
        {t({ ar: "مرحلة المشروع الحالية", en: "Current Project Stage" })}
      </label>
      <div className="f-sans" style={{ display: "inline-block", background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(227,30,36,0.35)", borderRadius: "3px", padding: "11px 14px", fontSize: "13.5px" }}>
        {t(label)}
      </div>
      <p className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", lineHeight: 1.7, marginTop: "10px" }}>
        {t({
          ar: "المرحلة مشتقّة من دورة حياة المشروع (المصدر الوحيد). لتغييرها، استخدم دورة الحياة في «منصّة المشاريع» وستنعكس هنا تلقائيًا.",
          en: "The stage is derived from the project lifecycle (the single source of truth). To change it, use the lifecycle control in Project Core; it reflects here automatically.",
        })}
      </p>
    </div>
  );
}

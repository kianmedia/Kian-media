"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin-only project-stage control (project detail page). Sets project.status
// via admin_set_project_status (DB-validated to 7 values). The dropdown shows
// the full 10-step timeline for context, but only the DB-backed "project"
// stages are selectable; "filming" (proposed) and the deliverable-derived
// steps (بانتظار اعتماد العميل / معتمد) are shown disabled with a reason — we
// never send an unsupported value to the RPC (it would be rejected).
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminSetProjectStatus } from "@/lib/portal/admin";
import { TIMELINE_STEPS } from "@/components/portal/projectMeta";
import type { ProjectStatus } from "@/lib/portal/types";

export default function AdminProjectStage({
  projectId, current, onChanged,
}: { projectId: string; current: string; onChanged: (newStatus: string) => void | Promise<void> }) {
  const { t, isAr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function change(next: string) {
    if (next === current || !next) return;
    setBusy(true); setFlash(null);
    const r = await adminSetProjectStatus(projectId, next as ProjectStatus);
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر التحديث: ", en: "Update failed: " }) + (r.ok ? "no row" : r.error) }); return; }
    setFlash({ kind: "ok", text: t({ ar: "تم تحديث مرحلة المشروع ✓", en: "Project stage updated ✓" }) });
    await onChanged(next);
  }

  const reason = (source: string) => source === "proposed"
    ? t({ ar: " (يتطلب تحديث قاعدة البيانات)", en: " (needs DB update)" })
    : t({ ar: " (تلقائي من حالة المخرج)", en: " (auto from deliverable status)" });

  // If project.status is an unknown legacy value, surface it as a selected hint.
  const known = TIMELINE_STEPS.some((s) => s.key === current && s.source === "project");

  return (
    <div>
      <label className="f-sans block" style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: "8px" }}>
        {t({ ar: "مرحلة المشروع الحالية", en: "Current Project Stage" })}
      </label>
      <select
        value={known ? current : ""}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="f-sans"
        style={{ width: "100%", maxWidth: "420px", background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(227,30,36,0.45)", borderRadius: "3px", padding: "11px 12px", fontSize: "13.5px", cursor: busy ? "wait" : "pointer", colorScheme: "dark", outline: "none" }}
      >
        {!known && <option value="" style={{ background: "#0a0a0a" }}>{t({ ar: "— اختر المرحلة —", en: "— select stage —" })}</option>}
        {TIMELINE_STEPS.map((s) => (
          <option key={s.key} value={s.key} disabled={s.source !== "project"} style={{ background: "#0a0a0a", color: s.source !== "project" ? "rgba(255,255,255,0.4)" : "#fff" }}>
            {(isAr ? s.ar : s.en)}{s.source !== "project" ? reason(s.source) : ""}
          </option>
        ))}
      </select>

      <p className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6, marginTop: "10px" }}>
        {t({
          ar: "«بانتظار اعتماد العميل» و«معتمد» يتقدّمان تلقائياً حسب حالة المخرج. «مرحلة التصوير» غير مدعومة في قاعدة البيانات بعد.",
          en: "“Awaiting Client Approval” and “Approved” advance automatically from the deliverable status. “Filming” is not a DB stage yet.",
        })}
      </p>
      {flash && <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
    </div>
  );
}

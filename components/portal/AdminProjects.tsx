"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Project Management — list all projects, change stage via the existing
// admin_set_project_status RPC (S1). The DB trigger auto-logs the change and
// notifies the project's client members, and the client timeline reads the
// live status, so updates reflect on the client side automatically.
// Admin-only: rendered only for account_type='admin' (see projects/page.tsx).
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminListProjects, adminListClientsByIds, adminSetProjectStatus } from "@/lib/portal/admin";
import { STATUS_STEPS, projectStatusLabel } from "@/components/portal/projectMeta";
import type { Project, ClientRow, ProjectStatus } from "@/lib/portal/types";

export default function AdminProjects() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Record<string, ClientRow>>({});
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const r = await adminListProjects();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setProjects(r.data);
    const ids = Array.from(new Set(r.data.map((p) => p.client_id).filter(Boolean)));
    const c = await adminListClientsByIds(ids);
    if (c.ok) {
      const map: Record<string, ClientRow> = {};
      c.data.forEach((row) => { map[row.id] = row; });
      setClients(map);
    }
    setPhase("ready");
  }
  useEffect(() => { void load(); }, []);

  async function changeStatus(p: Project, status: ProjectStatus) {
    if (status === p.status) return;
    setSavingId(p.id);
    setFlash(null);
    const r = await adminSetProjectStatus(p.id, status);
    setSavingId(null);
    if (!r.ok || !r.data) {
      setFlash({ id: p.id, kind: "err", text: t({ ar: "تعذّر التحديث: ", en: "Update failed: " }) + (r.ok ? "no row" : r.error) });
      return;
    }
    // Optimistic local update + refetch so client timeline + this list match.
    setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, status } : x)));
    setFlash({ id: p.id, kind: "ok", text: t({ ar: "تم تحديث الحالة ✓", en: "Status updated ✓" }) });
    void load();
  }

  function clientLine(p: Project): string {
    const c = clients[p.client_id];
    if (!c) return t({ ar: "—", en: "—" });
    const name = c.full_name || c.email || "—";
    return c.company ? `${name} · ${c.company}` : name;
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "إدارة المشاريع", en: "Project Management" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "المشاريع وحالاتها", en: "Projects & Stages" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px" }}>
          {t({ ar: "تغيير الحالة يحدّث الخط الزمني للعميل ويرسل له إشعاراً تلقائياً.", en: "Changing the stage updates the client timeline and notifies them automatically." })}
        </p>
      </div>

      {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {phase === "error" && <div className="f-sans" style={{ padding: "14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{err}</div>}
      {phase === "ready" && projects.length === 0 && <p className="text-white/45" style={{ fontSize: "14px" }}>{t({ ar: "لا توجد مشاريع.", en: "No projects." })}</p>}

      {phase === "ready" && projects.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {projects.map((p) => {
            const label = projectStatusLabel(p.status);
            return (
              <div key={p.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "16px 18px" }}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Link href={`/client-portal/projects/${p.id}`} className="text-white" style={{ fontSize: "16px", fontWeight: 700, textDecoration: "none", fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)" }}>
                      {p.project_name}
                    </Link>
                    <div className="text-white/45" style={{ fontSize: "12.5px", marginTop: "3px" }}>{clientLine(p)}</div>
                    <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginTop: "3px", direction: "ltr", textAlign: isAr ? "right" : "left" }}>
                      {t({ ar: "أُنشئ: ", en: "Created: " })}{new Date(p.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                    <span className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(124,252,154,0.7)" }}>{t({ ar: "قابل للتعديل", en: "Editable" })}</span>
                    <select
                      value={STATUS_STEPS.some((s) => s.key === p.status) ? p.status : ""}
                      disabled={savingId === p.id}
                      onChange={(e) => changeStatus(p, e.target.value as ProjectStatus)}
                      className="f-sans"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(227,30,36,0.4)", borderRadius: "3px", padding: "8px 10px", fontSize: "12.5px", cursor: savingId === p.id ? "wait" : "pointer", colorScheme: "dark", outline: "none" }}
                    >
                      {!STATUS_STEPS.some((s) => s.key === p.status) && <option value="" style={{ background: "#0a0a0a" }}>{t(label)}</option>}
                      {STATUS_STEPS.map((s) => (
                        <option key={s.key} value={s.key} style={{ background: "#0a0a0a" }}>{isAr ? s.ar : s.en}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {savingId === p.id && <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>{t({ ar: "جارٍ الحفظ...", en: "Saving..." })}</div>}
                {flash && flash.id === p.id && (
                  <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

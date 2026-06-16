"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin "ربط العميل بالمشروع" panel (per account, inside AdminAccounts).
// Create a project for the account, link it to an existing project, or unlink —
// all via the approved is_admin() SECURITY DEFINER RPCs (admin_create_project,
// admin_add_project_member, admin_remove_project_member). Linking writes a
// project_members row (role=client_owner), which is exactly what makes the
// project visible to that client (can_access_project → project_role). No
// service-role key, no table writes — every mutation goes through an RPC.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  adminCreateProject, adminAddProjectMember, adminRemoveProjectMember,
  adminListMembershipsForUser,
} from "@/lib/portal/admin";
import { STATUS_STEPS } from "@/components/portal/projectMeta";
import type { Profile, Project, ProjectMember, ProjectStatus } from "@/lib/portal/types";

export default function AccountLinking({
  account, projects, isClient, convertBusy, onConvert, onProjectsChanged,
}: {
  account: Profile;
  projects: Project[];
  isClient: boolean;
  convertBusy: boolean;
  onConvert: () => void;
  onProjectsChanged: () => void;
}) {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pick, setPick] = useState("");

  async function load() {
    const r = await adminListMembershipsForUser(account.id);
    if (!r.ok) { setPhase("error"); return; }
    setMembers(r.data);
    setPhase("ready");
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [account.id]);

  const nameById = new Map(projects.map((p) => [p.id, p.project_name]));
  const linkedIds = new Set(members.map((m) => m.project_id));
  const available = projects.filter((p) => !linkedIds.has(p.id));

  async function linkExisting() {
    if (!pick) return;
    setBusy(true); setFlash(null);
    const r = await adminAddProjectMember({ projectId: pick, userId: account.id, role: "client_owner" });
    setBusy(false);
    if (!r.ok) { setFlash({ kind: "err", text: t({ ar: "تعذّر الربط: ", en: "Link failed: " }) + r.error }); return; }
    setPick("");
    setFlash({ kind: "ok", text: t({ ar: "تم ربط العميل بالمشروع ✓", en: "Client linked to project ✓" }) });
    void load();
  }

  async function unlink(projectId: string) {
    setBusy(true); setFlash(null);
    const r = await adminRemoveProjectMember({ projectId, userId: account.id });
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر فك الربط: ", en: "Unlink failed: " }) + (r.ok ? "no row" : r.error) }); void load(); return; }
    setFlash({ kind: "ok", text: t({ ar: "تم فك الربط ✓", en: "Unlinked ✓" }) });
    void load();
  }

  const selStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "9px 11px", fontSize: "12.5px", colorScheme: "dark", outline: "none", maxWidth: "260px" };

  return (
    <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px dashed rgba(255,255,255,0.12)" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "2px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600, marginBottom: "12px" }}>
        {t({ ar: "ربط العميل بالمشروع", en: "Link Client to Project" })}
      </div>

      {/* Convert lead → client (only when not already a client) */}
      {!isClient && (
        <div style={{ marginBottom: "14px" }}>
          <button onClick={onConvert} disabled={convertBusy} className="f-sans" style={btn(false)}>
            {convertBusy ? "..." : t({ ar: "تحويل إلى عميل", en: "Convert to Client" })}
          </button>
          <p className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginTop: "6px" }}>
            {t({ ar: "يمكنك الربط بمشروع حتى قبل التحويل، لكن يُفضّل التحويل إلى عميل أولاً.", en: "You can link before converting, but converting to a client first is recommended." })}
          </p>
        </div>
      )}

      {/* Create a new project for this account */}
      <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: "14px" }}>
        <button onClick={() => setShowCreate(true)} disabled={busy} className="btn-red" style={{ whiteSpace: "nowrap" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginInlineEnd: "6px" }}><path d="M12 5v14M5 12h14" /></svg>
          <span>{t({ ar: "إنشاء مشروع لهذا العميل", en: "Create Project for this Client" })}</span>
        </button>

        {/* Link to an existing project */}
        <div className="flex items-center gap-2 flex-wrap">
          <select value={pick} disabled={busy || available.length === 0} onChange={(e) => setPick(e.target.value)} className="f-sans" style={selStyle}>
            <option value="" style={{ background: "#0a0a0a" }}>
              {available.length === 0 ? t({ ar: "لا مشاريع متاحة", en: "No projects available" }) : t({ ar: "— اختر مشروعاً موجوداً —", en: "— pick an existing project —" })}
            </option>
            {available.map((p) => <option key={p.id} value={p.id} style={{ background: "#0a0a0a" }}>{p.project_name}</option>)}
          </select>
          <button onClick={() => void linkExisting()} disabled={busy || !pick} className="f-sans" style={btn(!pick)}>
            {t({ ar: "ربط بمشروع موجود", en: "Link to Existing" })}
          </button>
        </div>
      </div>

      {/* Linked projects */}
      <div>
        <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>
          {t({ ar: "المشاريع المرتبطة", en: "Linked Projects" })}
        </div>
        {phase === "loading" && <p className="text-white/45" style={{ fontSize: "12.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
        {phase === "error" && <p className="f-sans" style={{ fontSize: "12.5px", color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل الروابط.", en: "Couldn't load links." })}</p>}
        {phase === "ready" && members.length === 0 && <p className="text-white/45" style={{ fontSize: "12.5px" }}>{t({ ar: "لا مشاريع مرتبطة بهذا الحساب بعد.", en: "No projects linked to this account yet." })}</p>}
        {phase === "ready" && members.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "9px 12px" }}>
                <div style={{ minWidth: 0 }}>
                  <span className="text-white" style={{ fontSize: "13px", fontWeight: 600 }}>{nameById.get(m.project_id) ?? t({ ar: "مشروع", en: "Project" })}</span>
                  <span className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginInlineStart: "8px" }}>{m.role}</span>
                </div>
                <button onClick={() => void unlink(m.project_id)} disabled={busy} className="f-sans" style={{ fontSize: "10.5px", letterSpacing: "0.5px", color: "#ff8a8e", background: "none", border: "1px solid rgba(227,30,36,0.35)", padding: "6px 11px", borderRadius: "3px", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                  {t({ ar: "فك الربط", en: "Unlink" })}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {flash && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}

      {showCreate && (
        <CreateProjectModal
          account={account}
          onClose={() => setShowCreate(false)}
          onCreated={(msg) => { setShowCreate(false); setFlash({ kind: "ok", text: msg }); onProjectsChanged(); void load(); }}
          onError={(msg) => setFlash({ kind: "err", text: msg })}
        />
      )}
    </div>
  );

  function btn(disabled: boolean): React.CSSProperties {
    return { fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.85)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "9px 13px", borderRadius: "3px", cursor: disabled || busy ? "default" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap" };
  }
}

function CreateProjectModal({
  account, onClose, onCreated, onError,
}: { account: Profile; onClose: () => void; onCreated: (msg: string) => void; onError: (msg: string) => void }) {
  const { t, isAr } = useI18n();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("request_received");
  const [notes, setNotes] = useState("");
  const [shooting, setShooting] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!title.trim()) { setErr(t({ ar: "عنوان المشروع مطلوب", en: "Project title required" })); return; }
    setSaving(true);
    // 1) create the project
    const cr = await adminCreateProject({ title: title.trim(), status, notes: notes.trim() || undefined, shootingDate: shooting || undefined });
    if (!cr.ok) { setSaving(false); setErr(t({ ar: "تعذّر إنشاء المشروع: ", en: "Create failed: " }) + cr.error); return; }
    // 2) auto-link this account as the project owner
    const lk = await adminAddProjectMember({ projectId: cr.data, userId: account.id, role: "client_owner" });
    setSaving(false);
    if (!lk.ok) { onError(t({ ar: "أُنشئ المشروع لكن تعذّر ربط العميل: ", en: "Project created but linking failed: " }) + lk.error); onClose(); return; }
    onCreated(t({ ar: "تم إنشاء المشروع وربط العميل به ✓", en: "Project created and client linked ✓" }));
  }

  const input: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "11px 13px", color: "#fff", fontSize: "14px", fontFamily: "var(--sans)", outline: "none", colorScheme: "dark" };
  const lbl: React.CSSProperties = { display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "440px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "24px", margin: "auto" }}>
        <h3 className="text-white" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>{t({ ar: "إنشاء مشروع لهذا العميل", en: "Create Project for this Client" })}</h3>
        <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", direction: "ltr", textAlign: isAr ? "right" : "left", marginBottom: "16px" }}>{account.email}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
          <div><label style={lbl}>{t({ ar: "عنوان المشروع *", en: "Project Title *" })}</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={input} /></div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div><label style={lbl}>{t({ ar: "المرحلة", en: "Stage" })}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} style={input}>
                {STATUS_STEPS.map((s) => <option key={s.key} value={s.key} style={{ background: "#0a0a0a" }}>{isAr ? s.ar : s.en}</option>)}
              </select></div>
            <div><label style={lbl}>{t({ ar: "تاريخ التصوير (اختياري)", en: "Shooting Date (optional)" })}</label>
              <input type="date" value={shooting} onChange={(e) => setShooting(e.target.value)} dir="ltr" style={input} /></div>
          </div>
          <div><label style={lbl}>{t({ ar: "وصف / ملاحظات (اختياري)", en: "Description / Notes (optional)" })}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} style={{ ...input, resize: "vertical", lineHeight: 1.6 }} /></div>
          {err && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>}
          <div className="flex gap-3">
            <button onClick={() => void save()} disabled={saving} className="btn-red" style={{ flex: 1, justifyContent: "center", opacity: saving ? 0.6 : 1 }}><span>{saving ? "..." : t({ ar: "إنشاء وربط", en: "Create & Link" })}</span></button>
            <button onClick={onClose} className="btn-ghost" style={{ justifyContent: "center" }}><span>{t({ ar: "إلغاء", en: "Cancel" })}</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

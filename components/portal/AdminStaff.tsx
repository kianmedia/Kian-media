"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Staff Management (الموظفون). Owner/admin: set each account's staff_role
// (admin_set_staff_role — owner-only, DB-enforced) and assign/unassign staff to
// projects with kian_* roles (admin_add/remove_project_member — account_type=admin).
// All writes go through is_admin()/is_owner()-guarded RPCs; no service-role key.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  adminListProfiles, adminListProjects, adminSetStaffRole,
  adminAddProjectMember, adminRemoveProjectMember, adminListMembershipsForUser,
} from "@/lib/portal/admin";
import { notifyStaffAssigned, notifyAssignmentNote } from "@/lib/portal/notifyEmail";
import { listAssignmentNotes, addAssignmentNote, removeAssignmentNote } from "@/lib/portal/assignments";
import { STAFF_ROLE_LABELS, STAFF_ROLE_OPTIONS, PROJECT_STAFF_ROLES } from "@/lib/portal/roles";
import type { Profile, Project, ProjectMember, StaffRole, ProjectMemberRole, AssignmentNote } from "@/lib/portal/types";

const PROTECTED_EMAILS = ["kianalebtikar@gmail.com", "manager@kianmedia.com", "contact@kianmedia.com"];

export default function AdminStaff() {
  const { t, isAr } = useI18n();
  const { caps } = usePortal();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);

  async function load() {
    const r = await adminListProfiles();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setRows(r.data);
    setPhase("ready");
  }
  async function loadProjects() { const r = await adminListProjects(); if (r.ok) setProjects(r.data); }
  useEffect(() => { void load(); void loadProjects(); }, []);

  async function setRole(p: Profile, role: StaffRole | null) {
    setSavingId(p.id); setFlash(null);
    const r = await adminSetStaffRole({ userId: p.id, role });
    setSavingId(null);
    if (!r.ok || !r.data) { setFlash({ id: p.id, kind: "err", text: t({ ar: "تعذّر الحفظ: ", en: "Save failed: " }) + (r.ok ? "no row / protected" : r.error) }); return; }
    setRows((prev) => prev.map((x) => x.id === p.id ? { ...x, staff_role: role } : x));
    setFlash({ id: p.id, kind: "ok", text: t({ ar: "تم تحديث الدور ✓", en: "Role updated ✓" }) });
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "صلاحيات الموظفين", en: "Staff & Permissions" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "الموظفون وتوزيع المهام", en: "Staff & Task Assignment" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px", lineHeight: 1.7 }}>
          {t({
            ar: "حدّد دور كل موظف وكلّفه بالمشاريع. الصلاحيات مطبّقة في قاعدة البيانات؛ التسليم النهائي للمالك/المدير فقط.",
            en: "Set each staff member's role and assign them to projects. Permissions are DB-enforced; final delivery is owner/manager only.",
          })}
        </p>
        {!caps.canManageStaff && (
          <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,210,138,0.85)", marginTop: "10px" }}>
            {t({ ar: "تغيير الأدوار متاح لحساب المالك فقط.", en: "Changing roles is available to the owner account only." })}
          </p>
        )}
        {/* staff_role sets the coarse tier; assign one or MORE professions
            (photographer + videographer, editor + motion, …) here. */}
        <Link href="/client-portal/employee?tab=professions" className="f-sans inline-flex items-center gap-2" style={{ marginTop: "14px", fontSize: "12px", color: "#fff", background: "rgba(227,30,36,0.14)", border: "1px solid rgba(227,30,36,0.45)", borderRadius: "4px", padding: "8px 14px", textDecoration: "none" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7 9 18l-5-5" /></svg>
          {t({ ar: "المهن والصلاحيات (تعيين مهن متعددة للموظف)", en: "Professions & Permissions (assign multiple professions)" })}
        </Link>
      </div>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>}

      {phase === "ready" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {rows.map((p) => {
            const protectedRow = p.account_type === "admin" || PROTECTED_EMAILS.includes((p.email || "").toLowerCase());
            return (
              <div key={p.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "16px 18px" }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div style={{ minWidth: 0 }}>
                    <div className="text-white" style={{ fontSize: "14.5px", fontWeight: 600 }}>
                      {p.full_name || (isAr ? "بدون اسم" : "No name")}
                      {p.staff_role && <span className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "0.5px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "3px 8px", borderRadius: "2px", marginInlineStart: "8px" }}>{isAr ? STAFF_ROLE_LABELS[p.staff_role]?.ar : STAFF_ROLE_LABELS[p.staff_role]?.en}</span>}
                    </div>
                    <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", direction: "ltr", textAlign: isAr ? "right" : "left" }}>{p.email}{p.company ? ` · ${p.company}` : ""}</div>
                  </div>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "صلاحية النظام (الوصول)", en: "System role (access)" })}</div>
                      <select
                        value={p.staff_role ?? ""}
                        disabled={savingId === p.id || protectedRow || !caps.canManageStaff}
                        onChange={(e) => setRole(p, (e.target.value || null) as StaffRole | null)}
                        className="f-sans"
                        style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "8px 10px", fontSize: "12.5px", cursor: savingId === p.id ? "wait" : "pointer", colorScheme: "dark", outline: "none", opacity: protectedRow ? 0.5 : 1 }}>
                        <option value="" style={{ background: "#0a0a0a" }}>{t({ ar: "— ليس موظفاً —", en: "— not staff —" })}</option>
                        {STAFF_ROLE_OPTIONS.map((k) => <option key={k} value={k} style={{ background: "#0a0a0a" }}>{isAr ? STAFF_ROLE_LABELS[k].ar : STAFF_ROLE_LABELS[k].en}</option>)}
                      </select>
                    </div>
                    {caps.canWriteAdmin && (
                      <button onClick={() => setAssignFor((c) => (c === p.id ? null : p.id))} className="f-sans"
                        style={{ fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", color: assignFor === p.id ? "#fff" : "rgba(255,255,255,0.7)", background: assignFor === p.id ? "rgba(227,30,36,0.14)" : "none", border: `1px solid ${assignFor === p.id ? "rgba(227,30,36,0.5)" : "rgba(255,255,255,0.15)"}`, padding: "9px 14px", borderRadius: "3px", cursor: "pointer" }}>
                        {t({ ar: "تكليف بمشروع", en: "Assign to Project" })}
                      </button>
                    )}
                  </div>
                </div>
                {protectedRow && <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,210,138,0.8)", marginTop: "8px" }}>{t({ ar: "حساب مالك محمي — لا يمكن تغيير دوره.", en: "Protected owner account — role can't be changed." })}</div>}
                {flash && flash.id === p.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
                {assignFor === p.id && caps.canWriteAdmin && <StaffAssign account={p} projects={projects} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StaffAssign({ account, projects }: { account: Profile; projects: Project[] }) {
  const { t, isAr } = useI18n();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<ProjectMemberRole>("kian_editor");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);

  async function load() {
    const r = await adminListMembershipsForUser(account.id);
    if (!r.ok) { setPhase("error"); return; }
    setMembers(r.data); setPhase("ready");
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [account.id]);

  const nameById = new Map(projects.map((p) => [p.id, p.project_name]));
  const linkedIds = new Set(members.map((m) => m.project_id));
  const available = projects.filter((p) => !linkedIds.has(p.id));

  async function assign() {
    if (!pick) return;
    setBusy(true); setFlash(null);
    const projectName = nameById.get(pick) ?? "";
    const r = await adminAddProjectMember({ projectId: pick, userId: account.id, role });
    setBusy(false);
    if (!r.ok) { setFlash({ kind: "err", text: t({ ar: "تعذّر التكليف: ", en: "Assign failed: " }) + r.error }); return; }
    // Email the staff member that they've been assigned (best-effort; never blocks).
    void notifyStaffAssigned({ projectId: pick, projectName, staffEmail: account.email, staffName: account.full_name, role });
    setPick("");
    setFlash({ kind: "ok", text: t({ ar: "تم التكليف ✓ (سيصل إشعار للموظف)", en: "Assigned ✓ (staff notified)" }) });
    void load();
  }
  async function remove(projectId: string) {
    setBusy(true); setFlash(null);
    const r = await adminRemoveProjectMember({ projectId, userId: account.id });
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر الإلغاء", en: "Remove failed" }) }); void load(); return; }
    setFlash({ kind: "ok", text: t({ ar: "تم الإلغاء ✓", en: "Removed ✓" }) });
    void load();
  }

  const sel: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "9px 11px", fontSize: "12.5px", colorScheme: "dark", outline: "none" };

  return (
    <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px dashed rgba(255,255,255,0.12)" }}>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: "12px" }}>
        <select value={pick} disabled={busy || available.length === 0} onChange={(e) => setPick(e.target.value)} className="f-sans" style={{ ...sel, maxWidth: "240px" }}>
          <option value="" style={{ background: "#0a0a0a" }}>{available.length === 0 ? t({ ar: "لا مشاريع متاحة", en: "No projects available" }) : t({ ar: "— اختر مشروعاً —", en: "— pick a project —" })}</option>
          {available.map((p) => <option key={p.id} value={p.id} style={{ background: "#0a0a0a" }}>{p.project_name}</option>)}
        </select>
        <select value={role} disabled={busy} onChange={(e) => setRole(e.target.value as ProjectMemberRole)} className="f-sans" style={sel}>
          {PROJECT_STAFF_ROLES.map((r) => <option key={r.key} value={r.key} style={{ background: "#0a0a0a" }}>{isAr ? r.ar : r.en}</option>)}
        </select>
        <button onClick={() => void assign()} disabled={busy || !pick} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "9px 13px", borderRadius: "3px", cursor: busy || !pick ? "default" : "pointer", opacity: !pick ? 0.5 : 1 }}>
          {t({ ar: "تكليف", en: "Assign" })}
        </button>
      </div>

      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>{t({ ar: "المشاريع المكلّف بها", en: "Assigned Projects" })}</div>
      {phase === "loading" && <p className="text-white/45" style={{ fontSize: "12.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "ready" && members.length === 0 && <p className="text-white/45" style={{ fontSize: "12.5px" }}>{t({ ar: "لا مشاريع مكلّف بها بعد.", en: "No assigned projects yet." })}</p>}
      {phase === "ready" && members.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {members.map((m) => {
            const projectName = nameById.get(m.project_id) ?? t({ ar: "مشروع", en: "Project" });
            return (
              <div key={m.id} style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "9px 12px" }}>
                <div className="flex items-center justify-between gap-3">
                  <div style={{ minWidth: 0 }}>
                    <span className="text-white" style={{ fontSize: "13px", fontWeight: 600 }}>{projectName}</span>
                    <span className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginInlineStart: "8px" }}>{m.role}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setNotesFor((c) => (c === m.id ? null : m.id))} className="f-sans" style={{ fontSize: "10.5px", color: notesFor === m.id ? "#fff" : "rgba(255,255,255,0.7)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "6px 11px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap" }}>
                      {t({ ar: "ملاحظات", en: "Notes" })}
                    </button>
                    <button onClick={() => void remove(m.project_id)} disabled={busy} className="f-sans" style={{ fontSize: "10.5px", color: "#ff8a8e", background: "none", border: "1px solid rgba(227,30,36,0.35)", padding: "6px 11px", borderRadius: "3px", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                      {t({ ar: "إلغاء التكليف", en: "Unassign" })}
                    </button>
                  </div>
                </div>
                {notesFor === m.id && <AssignmentNotes projectId={m.project_id} projectName={projectName} staff={account} />}
              </div>
            );
          })}
        </div>
      )}
      {flash && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
    </div>
  );
}

// Internal assignment notes for one (project, staff) pair. Admin/manager-only
// write (add_assignment_note RPC); never visible to clients (RLS). Adding a note
// emails the staff member via the existing portal_notify path.
function AssignmentNotes({ projectId, projectName, staff }: { projectId: string; projectName: string; staff: Profile }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<AssignmentNote[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const r = await listAssignmentNotes(projectId, staff.id);
    if (!r.ok) { setPhase("error"); return; }
    setNotes(r.data); setPhase("ready");
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [projectId, staff.id]);

  async function add() {
    if (!body.trim()) return;
    setBusy(true); setFlash(null);
    const r = await addAssignmentNote({ projectId, staffUserId: staff.id, body: body.trim() });
    setBusy(false);
    if (!r.ok) { setFlash({ kind: "err", text: t({ ar: "تعذّر الحفظ: ", en: "Save failed: " }) + r.error }); return; }
    // Email the staff member (best-effort; never blocks).
    void notifyAssignmentNote({ projectId, projectName, staffEmail: staff.email, staffName: staff.full_name, note: body.trim() });
    setBody("");
    setFlash({ kind: "ok", text: t({ ar: "تمت إضافة الملاحظة ✓ (سيصل إشعار للموظف)", en: "Note added ✓ (staff notified)" }) });
    void load();
  }

  async function del(noteId: string) {
    setBusy(true); setFlash(null);
    const r = await removeAssignmentNote(noteId);
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر الحذف", en: "Delete failed" }) }); void load(); return; }
    void load();
  }

  return (
    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed rgba(255,255,255,0.1)" }}>
      <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>
        {t({ ar: "ملاحظات داخلية للموظف (لا تظهر للعميل)", en: "Internal staff notes (not visible to the client)" })}
      </div>
      {phase === "loading" && <p className="text-white/40" style={{ fontSize: "12px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "ready" && notes.length === 0 && <p className="text-white/40" style={{ fontSize: "12px" }}>{t({ ar: "لا ملاحظات بعد.", en: "No notes yet." })}</p>}
      {phase === "ready" && notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
          {notes.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "3px", padding: "8px 10px" }}>
              <div style={{ minWidth: 0 }}>
                <p className="text-white/85" style={{ fontSize: "12.5px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{n.body}</p>
                <span className="f-sans" style={{ fontSize: "9.5px", color: "rgba(255,255,255,0.35)", direction: "ltr", unicodeBidi: "plaintext" }}>{new Date(n.created_at).toLocaleDateString()} {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <button onClick={() => void del(n.id)} disabled={busy} className="f-sans" style={{ fontSize: "10px", color: "rgba(255,138,142,0.8)", background: "none", border: "none", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>{t({ ar: "حذف", en: "Delete" })}</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={4000}
          placeholder={t({ ar: "أضف ملاحظة/تعليمات للموظف...", en: "Add a note / instructions for the staff member..." })}
          style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "9px 11px", color: "#fff", fontSize: "12.5px", fontFamily: "var(--sans)", outline: "none", resize: "vertical", lineHeight: 1.6, colorScheme: "dark" }} />
        <button onClick={() => void add()} disabled={busy || !body.trim()} className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "9px 13px", borderRadius: "3px", cursor: busy || !body.trim() ? "default" : "pointer", opacity: !body.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}>
          {t({ ar: "إضافة", en: "Add" })}
        </button>
      </div>
      {flash && <div className="f-sans" style={{ fontSize: "11.5px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
    </div>
  );
}

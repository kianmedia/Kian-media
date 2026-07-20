"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Project Management — create (with or WITHOUT a client email), edit
// (title/status/date/notes + client name/company/email/phone), add the client
// email later, manually link/reassign to an existing account, and soft-delete.
// A project with no account is "غير مرتبط"; with an email but no account yet is
// "بانتظار تسجيل العميل"; once linked it is "مرتبط" — and it appears in the
// client's portal automatically on login (sync_projects_for_current_user).
// Admin-only (rendered only for account_type='admin').
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  adminListProjects, adminListClientsByIds, adminListProfiles,
  adminCreateProjectForClient, adminUpdateProject, adminLinkProjectToUser, adminSoftDeleteProject,
} from "@/lib/portal/admin";
import { projectStatusLabel } from "@/components/portal/projectMeta";
import type { Project, ClientRow, Profile } from "@/lib/portal/types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A real (client-provided) email = present, not the internal placeholder.
function realEmail(c?: ClientRow): string | null {
  if (!c?.email || c.email_is_placeholder || c.email.endsWith("@pending.kian.local")) return null;
  return c.email.trim() || null;
}

type LinkState = "account" | "email_pending" | "unlinked";
function linkStateOf(c?: ClientRow): LinkState {
  if (c?.user_id) return "account";
  if (realEmail(c)) return "email_pending";
  return "unlinked";
}

export default function AdminProjects() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Record<string, ClientRow>>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [linkId, setLinkId] = useState<string | null>(null);

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
  // Profiles for the manual-link dropdown (lazy; only when first needed).
  useEffect(() => { if (linkId && profiles.length === 0) void adminListProfiles().then((r) => { if (r.ok) setProfiles(r.data); }); }, [linkId, profiles.length]);

  const flashFor = (id: string, kind: "ok" | "err", text: string) => setFlash({ id, kind, text });

  // مرحلة المشروع صارت مشتقّة من دورة الحياة (core_stage) وتُعرض للقراءة فقط هنا؛
  // لا كتابة مستقلة على projects.status. تُغيَّر المرحلة من دورة الحياة في «منصّة المشاريع».

  async function doDelete(p: Project) {
    if (!window.confirm(t({ ar: `هل أنت متأكد من حذف المشروع «${p.project_name}»؟ سيُخفى من القوائم.`, en: `Delete project “${p.project_name}”? It will be hidden from lists.` }))) return;
    setSavingId(p.id); setFlash(null);
    const r = await adminSoftDeleteProject(p.id);
    setSavingId(null);
    if (!r.ok) { flashFor(p.id, "err", t({ ar: "تعذّر الحذف.", en: "Delete failed." })); return; }
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
  }

  function clientLine(p: Project): string {
    const c = clients[p.client_id];
    if (!c) return "—";
    const name = c.full_name || realEmail(c) || t({ ar: "عميل غير مُسمّى", en: "Unnamed client" });
    return c.company ? `${name} · ${c.company}` : name;
  }

  const cardStyle: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "16px 18px" };

  return (
    <div>
      <div className="mb-6" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow mb-3">{t({ ar: "إدارة المشاريع", en: "Project Management" })}</div>
          <h1 className="editorial text-white" style={{ fontSize: "clamp(22px,4vw,32px)", lineHeight: 1.25 }}>{t({ ar: "المشاريع", en: "Projects" })}</h1>
          <p className="text-white/45" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7, maxWidth: 560 }}>
            {t({ ar: "يمكنك إنشاء مشروع حتى دون بريد العميل، وإضافة البريد لاحقاً ليظهر للعميل تلقائياً عند تسجيله.", en: "Create a project even without the client's email; add it later and it appears for the client automatically on signup." })}
          </p>
        </div>
        <button onClick={() => { setShowCreate((v) => !v); setEditId(null); setLinkId(null); }} className="btn-red" style={{ whiteSpace: "nowrap" }}>
          {showCreate ? t({ ar: "إلغاء", en: "Cancel" }) : t({ ar: "إنشاء مشروع", en: "New project" })}
        </button>
      </div>

      {showCreate && (
        <div style={{ ...cardStyle, marginBottom: 16, borderColor: "rgba(227,30,36,0.3)" }}>
          <ProjectForm
            mode="create"
            onCancel={() => setShowCreate(false)}
            onDone={(msg) => { setShowCreate(false); flashFor("__new__", "ok", msg); void load(); }}
          />
          {flash?.id === "__new__" && <div style={{ marginTop: 10, fontSize: 12.5, color: "#7CFC9A" }}>{flash.text}</div>}
        </div>
      )}

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: 13 }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && <div style={{ padding: 14, fontSize: 13, color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: 6 }}>{t({ ar: "تعذّر تحميل المشاريع.", en: "Couldn't load projects." })}</div>}
      {phase === "ready" && projects.length === 0 && <p className="text-white/45" style={{ fontSize: 14 }}>{t({ ar: "لا توجد مشاريع بعد. ابدأ بإنشاء مشروع.", en: "No projects yet. Create one to start." })}</p>}

      {phase === "ready" && projects.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {projects.map((p) => {
            const c = clients[p.client_id];
            const ls = linkStateOf(c);
            const label = projectStatusLabel(p.status);
            const editing = editId === p.id;
            const linking = linkId === p.id;
            return (
              <div key={p.id} style={cardStyle}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between" style={{ gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Link href={`/client-portal/projects/${p.id}`} className="text-white" style={{ fontSize: 16, fontWeight: 700, textDecoration: "none", fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)" }}>{p.project_name}</Link>
                      <LinkBadge state={ls} t={t} />
                    </div>
                    <div className="text-white/45" style={{ fontSize: 12.5, marginTop: 3 }}>
                      {clientLine(p)}
                      {realEmail(c) ? <span style={{ color: "rgba(255,255,255,0.3)", direction: "ltr" }}> · {realEmail(c)}</span>
                        : <span style={{ color: "rgba(255,255,255,0.35)" }}> · {t({ ar: "لم يتم إضافة بريد العميل", en: "No client email yet" })}</span>}
                    </div>
                    <div className="f-sans" style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3, direction: "ltr", textAlign: isAr ? "right" : "left" }}>{t({ ar: "أُنشئ: ", en: "Created: " })}{new Date(p.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</div>
                  </div>
                  <div className="flex items-center" style={{ gap: 8, flexShrink: 0 }}>
                    <span className="f-sans" title={t({ ar: "المرحلة مشتقّة من دورة حياة المشروع", en: "Stage derived from the project lifecycle" })}
                      style={{ color: "#fff", border: "1px solid rgba(227,30,36,0.4)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {t(label)}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <ActionBtn onClick={() => { setEditId(editing ? null : p.id); setLinkId(null); }}>{editing ? t({ ar: "إغلاق", en: "Close" }) : t({ ar: "تعديل", en: "Edit" })}</ActionBtn>
                  {ls !== "account" && <ActionBtn onClick={() => { setEditId(p.id); setLinkId(null); }}>{t({ ar: "إضافة بريد العميل", en: "Add client email" })}</ActionBtn>}
                  <ActionBtn onClick={() => { setLinkId(linking ? null : p.id); setEditId(null); }}>{linking ? t({ ar: "إغلاق", en: "Close" }) : t({ ar: "ربط بحساب موجود", en: "Link to account" })}</ActionBtn>
                  <ActionBtn danger onClick={() => void doDelete(p)}>{t({ ar: "حذف", en: "Delete" })}</ActionBtn>
                </div>

                {editing && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <ProjectForm mode="edit" project={p} client={c}
                      onCancel={() => setEditId(null)}
                      onDone={(msg) => { setEditId(null); flashFor(p.id, "ok", msg); void load(); }} />
                  </div>
                )}

                {linking && (
                  <LinkPanel profiles={profiles} onCancel={() => setLinkId(null)}
                    onLink={async (userId) => {
                      setSavingId(p.id);
                      const r = await adminLinkProjectToUser(p.id, userId);
                      setSavingId(null); setLinkId(null);
                      if (!r.ok) { flashFor(p.id, "err", t({ ar: "تعذّر الربط.", en: "Link failed." })); return; }
                      flashFor(p.id, "ok", t({ ar: "تم ربط المشروع بالحساب ✓", en: "Project linked to account ✓" }));
                      void load();
                    }} t={t} isAr={isAr} />
                )}

                {savingId === p.id && <div className="f-sans" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>{t({ ar: "جارٍ الحفظ...", en: "Saving..." })}</div>}
                {flash?.id === p.id && <div className="f-sans" style={{ fontSize: 12, marginTop: 8, color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Badge ───
function LinkBadge({ state, t }: { state: LinkState; t: (s: { ar: string; en: string }) => string }) {
  const map = {
    account: { ar: "مرتبط", en: "Linked", bg: "rgba(37,211,102,0.16)", fg: "#7ee2a8" },
    email_pending: { ar: "بانتظار تسجيل العميل", en: "Awaiting client signup", bg: "rgba(245,200,66,0.16)", fg: "#f5d76e" },
    unlinked: { ar: "غير مرتبط", en: "Unlinked", bg: "rgba(255,255,255,0.08)", fg: "rgba(255,255,255,0.6)" },
  }[state];
  return <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: map.bg, color: map.fg, whiteSpace: "nowrap" }}>{t(map)}</span>;
}

function ActionBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{ fontSize: 11.5, padding: "6px 11px", borderRadius: 7, cursor: "pointer", background: "transparent",
      border: `1px solid ${danger ? "rgba(227,30,36,0.4)" : "rgba(255,255,255,0.14)"}`, color: danger ? "#ff9ea1" : "rgba(255,255,255,0.8)" }}>{children}</button>
  );
}

// ─── Manual link panel ───
function LinkPanel({ profiles, onCancel, onLink, t, isAr }: {
  profiles: Profile[]; onCancel: () => void; onLink: (userId: string) => void;
  t: (s: { ar: string; en: string }) => string; isAr: boolean;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState("");
  const filtered = profiles.filter((p) => {
    const s = `${p.full_name ?? ""} ${p.email} ${p.company ?? ""}`.toLowerCase();
    return q.trim() === "" || s.includes(q.trim().toLowerCase());
  }).slice(0, 50);
  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, fontFamily: "inherit" };
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "ابحث بالاسم/البريد", en: "Search name/email" })} style={{ ...inp, minWidth: 180 }} />
      <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...inp, minWidth: 220 }}>
        <option value="">{t({ ar: "— اختر حساباً —", en: "— Select account —" })}</option>
        {filtered.map((p) => <option key={p.id} value={p.id}>{(p.full_name || p.email) + (p.company ? ` · ${p.company}` : "")}</option>)}
      </select>
      <button onClick={() => sel && onLink(sel)} disabled={!sel} className="btn-red" style={{ opacity: sel ? 1 : 0.5 }}>{t({ ar: "ربط", en: "Link" })}</button>
      <button onClick={onCancel} style={{ fontSize: 12, padding: "8px 12px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.7)" }}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
    </div>
  );
}

// ─── Create / edit form ───
function ProjectForm({ mode, project, client, onCancel, onDone }: {
  mode: "create" | "edit"; project?: Project; client?: ClientRow;
  onCancel: () => void; onDone: (successMsg: string) => void;
}) {
  const { t, isAr } = useI18n();
  const [title, setTitle] = useState(project?.project_name ?? "");
  const [clientName, setClientName] = useState(client?.full_name ?? "");
  const [company, setCompany] = useState(client?.company ?? "");
  const [email, setEmail] = useState(realEmail(client) ?? "");
  const [phone, setPhone] = useState(client?.mobile ?? "");
  // لا حقل حالة مستقل: المرحلة مشتقّة من دورة الحياة (core_stage). المشروع الجديد يبدأ
  // بالمرحلة الافتراضية وتُضبط لاحقًا من «منصّة المشاريع»؛ التعديل لا يمسّ projects.status.
  const [shooting, setShooting] = useState(project?.shooting_date ?? "");
  const [notes, setNotes] = useState(project?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!title.trim()) { setErr(t({ ar: "عنوان المشروع مطلوب.", en: "Project title is required." })); return; }
    if (email.trim() && !EMAIL_RE.test(email.trim())) { setErr(t({ ar: "يرجى إدخال بريد إلكتروني صحيح للعميل.", en: "Please enter a valid client email." })); return; }
    setSaving(true);
    const common = {
      title: title.trim(), clientName: clientName.trim() || null, clientCompany: company.trim() || null,
      clientEmail: email.trim() || null, clientPhone: phone.trim() || null,
      shootingDate: shooting || null, notes: notes.trim() || null,
    };
    const r = mode === "create"
      ? await adminCreateProjectForClient(common)
      : await adminUpdateProject({ projectId: project!.id, ...common });
    setSaving(false);
    if (!r.ok) {
      setErr(/invalid_email/i.test(r.error) ? t({ ar: "يرجى إدخال بريد إلكتروني صحيح للعميل.", en: "Please enter a valid client email." }) : t({ ar: "تعذّرت العملية: ", en: "Failed: " }) + r.error);
      return;
    }
    const linked = r.data?.linked;
    const msg = mode === "edit"
      ? t({ ar: "تم حفظ التعديلات ✓", en: "Changes saved ✓" })
      : linked === "unlinked"
        ? t({ ar: "تم إنشاء المشروع كعميل غير مرتبط. يمكنك إضافة بريد العميل لاحقاً ليظهر له المشروع تلقائياً.", en: "Project created as an unlinked client. Add the client's email later to show it to them automatically." })
        : t({ ar: "تم إنشاء المشروع وربطه بهذا البريد. سيظهر للعميل تلقائياً عند تسجيله بنفس البريد.", en: "Project created and linked to this email. It appears for the client automatically when they sign up with the same email." });
    onDone(msg);
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "9px 11px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit", colorScheme: "dark" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginBottom: 5 };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>{t({ ar: "عنوان المشروع *", en: "Project title *" })}</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} /></div>
        <div><label style={lbl}>{t({ ar: "اسم العميل", en: "Client name" })}</label><input value={clientName} onChange={(e) => setClientName(e.target.value)} style={inp} /></div>
        <div><label style={lbl}>{t({ ar: "الشركة", en: "Company" })}</label><input value={company} onChange={(e) => setCompany(e.target.value)} style={inp} /></div>
        <div><label style={lbl}>{t({ ar: "بريد العميل (اختياري)", en: "Client email (optional)" })}</label><input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" placeholder="client@example.com" style={inp} /></div>
        <div><label style={lbl}>{t({ ar: "جوال العميل (اختياري)", en: "Client phone (optional)" })}</label><input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" style={inp} /></div>
        <div><label style={lbl}>{t({ ar: "تاريخ التصوير", en: "Shooting date" })}</label><input type="date" value={shooting || ""} onChange={(e) => setShooting(e.target.value)} dir="ltr" style={inp} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>{t({ ar: "ملاحظات / وصف", en: "Notes / description" })}</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} /></div>
      </div>
      {err && <div style={{ marginTop: 10, fontSize: 12.5, color: "#ff8a8e" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => void submit()} disabled={saving} className="btn-red" style={{ opacity: saving ? 0.6 : 1 }}>{saving ? t({ ar: "جارٍ الحفظ…", en: "Saving…" }) : t({ ar: "حفظ", en: "Save" })}</button>
        <button onClick={onCancel} style={{ fontSize: 12.5, padding: "8px 14px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.7)" }}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
      </div>
    </div>
  );
}

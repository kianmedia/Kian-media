"use client";
// ════════════════════════════════════════════════════════════════════════
// §5 Profession & permission admin (owner / manager only). Two panels:
//   1. Catalog — create/rename professions and toggle the capability matrix.
//   2. Assignment — grant each employee one or more professions.
// The UI is convenience only; admin_upsert_profession / admin_set_employee_
// professions re-check authority server-side and audit every change.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  listProfessions, upsertProfession, listEmployeesProfessions, setEmployeeProfessions,
  PERMISSION_KEYS, type Profession, type EmployeeProfessions,
} from "@/lib/portal/professions";

const inp: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "3px", padding: "7px 9px", color: "#fff", fontSize: "12.5px", outline: "none", colorScheme: "dark" };

export default function AdminProfessions() {
  const { t, isAr } = useI18n();
  const [tab, setTab] = useState<"catalog" | "assign">("catalog");
  const [profs, setProfs] = useState<Profession[]>([]);
  const [emps, setEmps] = useState<EmployeeProfessions[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [p, e] = await Promise.all([listProfessions(), listEmployeesProfessions()]);
    if (p.ok) setProfs(p.data);
    if (e.ok) setEmps(e.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex gap-1.5 mb-4">
        {(["catalog", "assign"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-xs font-medium border ${tab === k ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"}`}>
            {k === "catalog" ? t({ ar: "المهن والصلاحيات", en: "Professions & Permissions" }) : t({ ar: "إسناد الموظفين", en: "Assign Employees" })}
          </button>
        ))}
      </div>
      {msg && <p className="f-sans mb-3" style={{ fontSize: "12px", color: "#7CFC9A" }}>{msg}</p>}
      {tab === "catalog"
        ? <Catalog profs={profs} onChanged={load} setMsg={setMsg} t={t} isAr={isAr} />
        : <Assign profs={profs} emps={emps} onChanged={load} setMsg={setMsg} t={t} isAr={isAr} />}
    </div>
  );
}

type Tf = (m: { ar: string; en: string }) => string;

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function Catalog({ profs, onChanged, setMsg, t, isAr }: { profs: Profession[]; onChanged: () => void; setMsg: (s: string) => void; t: Tf; isAr: boolean }) {
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  // Auto-derive the slug from the English (or Arabic) name until the admin edits it.
  const effectiveKey = keyEdited ? key : slugify(nameEn || nameAr);
  async function add() {
    const k = effectiveKey.trim();
    const ar = nameAr.trim(); const en = nameEn.trim();
    if (busy) return;
    if (!ar && !en) { setMsg(t({ ar: "أدخل اسم المهنة (عربي أو إنجليزي).", en: "Enter a profession name (Arabic or English)." })); return; }
    if (!k) { setMsg(t({ ar: "المفتاح مطلوب (أحرف إنجليزية/أرقام).", en: "Key required (latin letters/digits)." })); return; }
    if (profs.some((p) => p.key === k)) { setMsg(t({ ar: `المفتاح "${k}" مستخدم بالفعل.`, en: `Key "${k}" already exists.` })); return; }
    setBusy(true);
    const r = await upsertProfession({ key: k, name_ar: ar || en, name_en: en || ar, is_active: true });
    setBusy(false);
    if (r.ok) { setNameAr(""); setNameEn(""); setKey(""); setKeyEdited(false); setMsg(t({ ar: "✓ أُضيفت المهنة وظهرت في القائمة.", en: "✓ Profession added and now listed." })); onChanged(); }
    else setMsg(t({ ar: "تعذّرت الإضافة: ", en: "Add failed: " }) + r.error);
  }
  async function save(p: Profession, patch: Partial<Profession>) {
    const r = await upsertProfession({ id: p.id, ...patch });
    if (r.ok) onChanged(); else setMsg(t({ ar: "تعذّر الحفظ: ", en: "Save failed: " }) + r.error);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Add a PROFESSION (craft) — separate from the system/access role. */}
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "10px 12px" }}>
        <div className="f-sans" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px", color: "rgba(255,255,255,0.5)", marginBottom: "8px" }}>{t({ ar: "إضافة مهنة جديدة", en: "Add a new profession" })}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder={t({ ar: "الاسم بالعربية (مثل: مصوّر)", en: "Arabic name (e.g. مصوّر)" })} style={inp} />
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder={t({ ar: "الاسم بالإنجليزية (Photographer)", en: "English name (Photographer)" })} style={inp} dir="ltr" />
          <input value={effectiveKey} onChange={(e) => { setKey(slugify(e.target.value)); setKeyEdited(true); }} placeholder="slug (photographer)" style={{ ...inp, direction: "ltr" }} dir="ltr" />
          <button onClick={add} disabled={busy} className="btn-red" style={{ opacity: busy ? 0.5 : 1 }}><span>{busy ? "…" : `+ ${t({ ar: "إضافة المهنة", en: "Add profession" })}`}</span></button>
        </div>
        <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "6px" }}>{t({ ar: "المهنة ليست دور النظام — دور الوصول يُضبط من صفحة الموظفين.", en: "A profession is not the system role — access role is set on the Staff page." })}</div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: "760px", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ color: "rgba(255,255,255,0.5)", textAlign: isAr ? "right" : "left" }}>
              <th style={th}>{t({ ar: "الاسم", en: "Name" })}</th>
              {PERMISSION_KEYS.map((pk) => <th key={pk.key} style={{ ...th, textAlign: "center" }}>{t(pk)}</th>)}
              <th style={{ ...th, textAlign: "center" }}>{t({ ar: "مفعّلة", en: "Active" })}</th>
            </tr>
          </thead>
          <tbody>
            {profs.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <td style={td}>
                  <input defaultValue={isAr ? p.name_ar : p.name_en} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== (isAr ? p.name_ar : p.name_en)) save(p, isAr ? { name_ar: v } : { name_en: v }); }} style={{ ...inp, width: "150px", padding: "5px 7px" }} />
                  <div className="f-sans" style={{ fontSize: "9.5px", color: "rgba(255,255,255,0.35)", marginTop: "3px" }} dir="ltr">{p.key}</div>
                </td>
                {PERMISSION_KEYS.map((pk) => (
                  <td key={pk.key} style={{ ...td, textAlign: "center" }}>
                    <input type="checkbox" checked={!!(p as unknown as Record<string, boolean>)[pk.key]} onChange={(e) => save(p, { [pk.key]: e.target.checked } as Partial<Profession>)} />
                  </td>
                ))}
                <td style={{ ...td, textAlign: "center" }}>
                  <input type="checkbox" checked={p.is_active} onChange={(e) => save(p, { is_active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Assign({ profs, emps, onChanged, setMsg, t, isAr }: { profs: Profession[]; emps: EmployeeProfessions[]; onChanged: () => void; setMsg: (s: string) => void; t: Tf; isAr: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const active = useMemo(() => profs.filter((p) => p.is_active), [profs]);
  const byId = useMemo(() => new Map(profs.map((p) => [p.id, p])), [profs]);
  const filtered = useMemo(() => emps.filter((e) => !q.trim() || (e.full_name ?? "").toLowerCase().includes(q.toLowerCase()) || (e.staff_role ?? "").includes(q)), [emps, q]);
  const label = (p?: Profession) => p ? (isAr ? p.name_ar : p.name_en) : "?";

  // One save call. The RPC marks the FIRST id in the array as primary, so we send
  // the chosen primary first; the rest follow. Empty array clears all professions.
  async function save(emp: EmployeeProfessions, ids: string[], primaryId: string | null) {
    setBusy(emp.id);
    const primary = primaryId && ids.includes(primaryId) ? primaryId : ids[0] ?? null;
    const ordered = primary ? [primary, ...ids.filter((x) => x !== primary)] : ids;
    const r = await setEmployeeProfessions(emp.id, ordered);
    setBusy(null);
    if (r.ok) { setMsg(t({ ar: "حُدّثت المهن.", en: "Professions updated." })); onChanged(); }
    else setMsg(r.error);
  }
  const addProf   = (emp: EmployeeProfessions, pid: string) => save(emp, [...emp.profession_ids, pid], emp.primary_profession_id ?? emp.profession_ids[0] ?? pid);
  const removeProf = (emp: EmployeeProfessions, pid: string) => save(emp, emp.profession_ids.filter((x) => x !== pid), (emp.primary_profession_id === pid ? null : emp.primary_profession_id) ?? null);
  const makePrimary = (emp: EmployeeProfessions, pid: string) => save(emp, emp.profession_ids, pid);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث بالاسم أو الدور…", en: "Search by name or role…" })} style={inp} />
      {filtered.map((emp) => {
        const assigned = emp.profession_ids;
        const primaryId = emp.primary_profession_id ?? (assigned.length === 1 ? assigned[0] : null);
        const unassigned = active.filter((p) => !assigned.includes(p.id));
        return (
          <div key={emp.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "11px 13px", opacity: busy === emp.id ? 0.6 : 1 }}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="text-white" style={{ fontSize: "13px", fontWeight: 600 }}>{emp.full_name ?? emp.id.slice(0, 8)}</span>
              <span className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)" }} dir="ltr">{emp.staff_role}{emp.account_status && emp.account_status !== "active" ? ` · ${emp.account_status}` : ""}</span>
            </div>

            {/* Currently assigned — badges with ★ primary + × remove. Multiple allowed. */}
            <div className="f-sans" style={{ fontSize: "9.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "المهن المسندة", en: "Assigned professions" })}</div>
            {assigned.length === 0 ? (
              <p className="text-white/35" style={{ fontSize: "12px", marginBottom: "8px" }}>{t({ ar: "لا مهن مسندة.", en: "None assigned yet." })}</p>
            ) : (
              <div className="flex gap-1.5 flex-wrap" style={{ marginBottom: "8px" }}>
                {assigned.map((pid) => {
                  const isPrimary = pid === primaryId;
                  return (
                    <span key={pid} className="f-sans inline-flex items-center gap-1.5" style={{ fontSize: "11px", padding: "4px 8px", borderRadius: "3px", border: `1px solid ${isPrimary ? "rgba(124,252,154,0.5)" : "rgba(227,30,36,0.45)"}`, background: isPrimary ? "rgba(124,252,154,0.12)" : "rgba(227,30,36,0.12)", color: "#fff" }}>
                      <button title={t({ ar: "تعيين كمهنة رئيسية", en: "Set primary" })} onClick={() => makePrimary(emp, pid)} disabled={busy === emp.id} style={{ background: "none", border: "none", cursor: "pointer", color: isPrimary ? "#7CFC9A" : "rgba(255,255,255,0.5)", padding: 0, fontSize: "12px" }}>{isPrimary ? "★" : "☆"}</button>
                      {label(byId.get(pid))}
                      <button title={t({ ar: "إزالة هذه المهنة", en: "Remove" })} onClick={() => removeProf(emp, pid)} disabled={busy === emp.id} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 0, fontSize: "13px", lineHeight: 1 }}>×</button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Add more — every profession not yet held (checkbox-style add). */}
            {unassigned.length > 0 && (
              <>
                <div className="f-sans" style={{ fontSize: "9.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "أضف مهنة", en: "Add a profession" })}</div>
                <div className="flex gap-1.5 flex-wrap">
                  {unassigned.map((p) => (
                    <button key={p.id} onClick={() => addProf(emp, p.id)} disabled={busy === emp.id}
                      className="f-sans" style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "3px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.6)" }}>
                      + {label(p)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
      {filtered.length === 0 && <p className="text-white/40" style={{ fontSize: "12.5px" }}>{t({ ar: "لا موظفين.", en: "No employees." })}</p>}
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, fontSize: "11px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", color: "rgba(255,255,255,0.85)" };

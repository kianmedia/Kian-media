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

function Catalog({ profs, onChanged, setMsg, t, isAr }: { profs: Profession[]; onChanged: () => void; setMsg: (s: string) => void; t: Tf; isAr: boolean }) {
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    const k = newKey.trim(); if (!k || busy) return; setBusy(true);
    const r = await upsertProfession({ key: k, name_ar: k, name_en: k });
    setBusy(false);
    if (r.ok) { setNewKey(""); setMsg(t({ ar: "أُضيفت المهنة.", en: "Profession added." })); onChanged(); }
    else setMsg(r.error);
  }
  async function save(p: Profession, patch: Partial<Profession>) {
    const r = await upsertProfession({ id: p.id, ...patch });
    if (r.ok) onChanged(); else setMsg(r.error);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="flex gap-2">
        <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={t({ ar: "مفتاح مهنة جديدة (مثل colorist)", en: "New profession key (e.g. colorist)" })} style={{ ...inp, flex: 1 }} />
        <button onClick={add} disabled={busy || !newKey.trim()} className="btn-red" style={{ opacity: busy || !newKey.trim() ? 0.5 : 1, padding: "0 16px" }}><span>+ {t({ ar: "إضافة", en: "Add" })}</span></button>
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
  const active = useMemo(() => profs.filter((p) => p.is_active), [profs]);
  const filtered = useMemo(() => emps.filter((e) => !q.trim() || (e.full_name ?? "").toLowerCase().includes(q.toLowerCase()) || (e.staff_role ?? "").includes(q)), [emps, q]);
  const label = (p: Profession) => isAr ? p.name_ar : p.name_en;

  async function toggle(emp: EmployeeProfessions, pid: string) {
    const has = emp.profession_ids.includes(pid);
    const next = has ? emp.profession_ids.filter((x) => x !== pid) : [...emp.profession_ids, pid];
    const r = await setEmployeeProfessions(emp.id, next);
    if (r.ok) { setMsg(t({ ar: "حُدّثت المهن.", en: "Professions updated." })); onChanged(); }
    else setMsg(r.error);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث بالاسم أو الدور…", en: "Search by name or role…" })} style={inp} />
      {filtered.map((emp) => (
        <div key={emp.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "11px 13px" }}>
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <span className="text-white" style={{ fontSize: "13px", fontWeight: 600 }}>{emp.full_name ?? emp.id.slice(0, 8)}</span>
            <span className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)" }} dir="ltr">{emp.staff_role}{emp.account_status && emp.account_status !== "active" ? ` · ${emp.account_status}` : ""}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {active.map((p) => {
              const on = emp.profession_ids.includes(p.id);
              return (
                <button key={p.id} onClick={() => toggle(emp, p.id)}
                  className="f-sans" style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "3px", cursor: "pointer",
                    border: `1px solid ${on ? "rgba(227,30,36,0.5)" : "rgba(255,255,255,0.14)"}`,
                    background: on ? "rgba(227,30,36,0.14)" : "transparent",
                    color: on ? "#fff" : "rgba(255,255,255,0.55)" }}>
                  {on ? "✓ " : ""}{label(p)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <p className="text-white/40" style={{ fontSize: "12.5px" }}>{t({ ar: "لا موظفين.", en: "No employees." })}</p>}
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, fontSize: "11px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", color: "rgba(255,255,255,0.85)" };

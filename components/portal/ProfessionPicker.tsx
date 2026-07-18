"use client";
// Per-employee professions (P0-1) — separate from the system access role. Multiple
// professions, optional primary (★), badges, remove one without the others. Writes
// via admin_set_employee_professions (RPC re-checks authority + audits). Live from
// public.professions; archived (inactive) professions are not offered for NEW
// assignments but existing ones still show.
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { setEmployeeProfessions, PERMISSION_KEYS, type Profession } from "@/lib/portal/professions";

export default function ProfessionPicker({ profileId, assignedIds, primaryId, professions, systemRole, onChanged }: {
  profileId: string; assignedIds: string[]; primaryId?: string | null; professions: Profession[]; systemRole?: string | null; onChanged: () => void;
}) {
  const { t, isAr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map(professions.map((p) => [p.id, p]));
  const label = (id: string) => { const p = byId.get(id); return p ? (isAr ? p.name_ar : p.name_en) : id.slice(0, 6); };
  const active = professions.filter((p) => p.is_active);
  const primary = primaryId ?? (assignedIds.length === 1 ? assignedIds[0] : null);
  const unassigned = active.filter((p) => !assignedIds.includes(p.id));

  // Effective access = UNION of capability flags across every assigned ACTIVE
  // profession (mirrors emp_can, which never filters to the primary). For each
  // capability, list the professions that grant it.
  const assignedActive = assignedIds.map((id) => byId.get(id)).filter((p): p is Profession => !!p && p.is_active);
  const effective = PERMISSION_KEYS.map((pk) => {
    const grantors = assignedActive.filter((p) => (p as unknown as Record<string, boolean>)[pk.key]);
    return { pk, grantors };
  }).filter((x) => x.grantors.length > 0);

  async function save(ids: string[], primaryPick: string | null) {
    setBusy(true); setErr(null);
    const pr = primaryPick && ids.includes(primaryPick) ? primaryPick : ids[0] ?? null;
    const ordered = pr ? [pr, ...ids.filter((x) => x !== pr)] : ids;
    const r = await setEmployeeProfessions(profileId, ordered);
    setBusy(false);
    if (r.ok) onChanged(); else setErr(r.error);
  }

  return (
    <div style={{ opacity: busy ? 0.6 : 1 }}>
      <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "المهن", en: "Professions" })}</div>
      {assignedIds.length === 0
        ? <span className="text-white/35" style={{ fontSize: "11.5px" }}>{t({ ar: "لا مهن مسندة.", en: "None yet." })}</span>
        : (
          <div className="flex gap-1.5 flex-wrap" style={{ marginBottom: "6px" }}>
            {assignedIds.map((id) => {
              const isP = id === primary;
              return (
                <span key={id} className="f-sans inline-flex items-center gap-1.5" style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "3px", border: `1px solid ${isP ? "rgba(124,252,154,0.5)" : "rgba(227,30,36,0.45)"}`, background: isP ? "rgba(124,252,154,0.12)" : "rgba(227,30,36,0.12)", color: "#fff" }}>
                  <button title={t({ ar: "تعيين رئيسية", en: "Set primary" })} disabled={busy} onClick={() => save(assignedIds, id)} style={{ background: "none", border: "none", cursor: "pointer", color: isP ? "#7CFC9A" : "rgba(255,255,255,0.5)", padding: 0 }}>{isP ? "★" : "☆"}</button>
                  {label(id)}
                  <button title={t({ ar: "إزالة", en: "Remove" })} disabled={busy} onClick={() => save(assignedIds.filter((x) => x !== id), primary === id ? null : primary)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 0, fontSize: "13px", lineHeight: 1 }}>×</button>
                </span>
              );
            })}
          </div>
        )}
      {unassigned.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {unassigned.map((p) => (
            <button key={p.id} disabled={busy} onClick={() => save([...assignedIds, p.id], primary)} className="f-sans" style={{ fontSize: "11px", padding: "3px 9px", borderRadius: "3px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.6)" }}>
              + {isAr ? p.name_ar : p.name_en}
            </button>
          ))}
        </div>
      )}
      {/* Effective access — system role + the UNION of all professions' capabilities. */}
      <div style={{ marginTop: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px", padding: "8px 10px" }}>
        <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "الوصول الفعّال", en: "Effective access" })}</div>
        <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)" }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{t({ ar: "صلاحية النظام:", en: "System role:" })}</span> <span dir="ltr">{systemRole ?? "—"}</span>
          {" · "}
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{t({ ar: "المهنة الرئيسية:", en: "Primary:" })}</span> {primary ? label(primary) : "—"}
        </div>
        {effective.length === 0
          ? <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>{t({ ar: "لا صلاحيات مهنية إضافية (رؤية المهام حسب المهنة فقط).", en: "No extra profession capabilities (profession-scoped task visibility only)." })}</div>
          : (
            <div style={{ marginTop: "5px", display: "flex", flexDirection: "column", gap: "3px" }}>
              {effective.map(({ pk, grantors }) => (
                <div key={pk.key} className="f-sans" style={{ fontSize: "11px" }}>
                  <span style={{ color: "#7CFC9A" }}>✓ {t(pk)}</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}> — {grantors.map((g) => (isAr ? g.name_ar : g.name_en)).join(", ")}</span>
                </div>
              ))}
            </div>
          )}
        <div className="f-sans" style={{ fontSize: "9.5px", color: "rgba(255,255,255,0.35)", marginTop: "5px" }}>{t({ ar: "الصلاحيات = اتحاد كل المهن المُسندة؛ المهنة الرئيسية للعرض فقط. لا تمنح أي مهنة صلاحيات المالك/الأدمن.", en: "Capabilities = union of ALL assigned professions; primary is display-only. No profession grants Owner/Admin access." })}</div>
      </div>
      {err && <p className="f-sans" style={{ fontSize: "11px", color: "#ff8a8e", marginTop: "4px" }}>{err}</p>}
    </div>
  );
}

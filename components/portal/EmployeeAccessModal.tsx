"use client";
// Employee "Effective access" (catalog v2) — the server truth: system role, active
// professions, permissions inherited per profession, individual allow/deny overrides,
// and the final effective set (UNION − deny + allow). Admin can add/clear overrides.
// Everything comes from emp_effective_access() (SECURITY DEFINER), not UI inference.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  empEffectiveAccess, listPermissions, setEmployeeOverride,
  PERMISSION_CATEGORIES, type EffectiveAccess, type Permission,
} from "@/lib/portal/professions";

export default function EmployeeAccessModal({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { t, isAr } = useI18n();
  const [acc, setAcc] = useState<EffectiveAccess | null>(null);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await empEffectiveAccess(userId);
    if (r.ok) setAcc(r.data); else setMsg(r.error);
  }, [userId]);
  useEffect(() => { void load(); void listPermissions().then((r) => { if (r.ok) setPerms(r.data); }); }, [load]);

  const eff = useMemo(() => new Set(acc?.effective_permissions ?? []), [acc]);
  const allows = useMemo(() => new Set(acc?.allows ?? []), [acc]);
  const denies = useMemo(() => new Set(acc?.denies ?? []), [acc]);
  const label = (p: Permission) => isAr ? p.label_ar : p.label_en;

  async function override(key: string, effect: "allow" | "deny" | null) {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await setEmployeeOverride(userId, key, effect, effect ? "manual override" : undefined);
    if (!r.ok) { setBusy(false); setMsg((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    await load(); setBusy(false); setMsg(isAr ? "✓ حُدّث التجاوز." : "✓ Override updated.");
  }

  const grantable = perms.filter((p) => p.sensitivity !== "system_only");
  const byCat = useMemo(() => { const m = new Map<string, Permission[]>(); for (const p of grantable) { const a = m.get(p.category) ?? []; a.push(p); m.set(p.category, a); } return m; }, [grantable]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} dir={isAr ? "rtl" : "ltr"} style={{ width: "100%", maxWidth: "720px", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", padding: "16px", margin: "16px 0" }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-white" style={{ fontSize: "15px", fontWeight: 700 }}>{t({ ar: "الوصول الفعّال: ", en: "Effective access: " })}{name}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>
        {!acc ? <p className="text-white/45" style={{ fontSize: "13px" }}>{msg ?? t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p> : (
          <>
            <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", marginBottom: "10px", lineHeight: 1.8 }}>
              <div><span style={{ color: "rgba(255,255,255,0.5)" }}>{t({ ar: "صلاحية النظام:", en: "System role:" })}</span> <span dir="ltr">{acc.system_role ?? "—"}</span> · <span style={{ color: "rgba(255,255,255,0.5)" }}>{t({ ar: "المهن:", en: "Professions:" })}</span> <span dir="ltr">{(acc.active_profession_keys ?? []).join(", ") || "—"}</span></div>
              {(acc.effective_permissions?.length ?? 0) > 0 && <div><span style={{ color: "rgba(255,255,255,0.5)" }}>{t({ ar: "إجمالي الصلاحيات الفعّالة:", en: "Effective permissions:" })}</span> {acc.effective_permissions!.length}</div>}
              {(acc.effective_permissions === undefined) && <div style={{ color: "rgba(255,210,138,0.9)" }}>{t({ ar: "شغّل permission_catalog_RUNME.sql لعرض الصلاحيات الدقيقة.", en: "Run permission_catalog_RUNME.sql to see granular permissions." })}</div>}
            </div>
            {msg && <p className="f-sans mb-2" style={{ fontSize: "12px", color: msg.startsWith("✓") ? "#7CFC9A" : "#ff8a8e" }}>{msg}</p>}

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "58vh", overflowY: "auto" }}>
              {PERMISSION_CATEGORIES.filter((c) => c.key !== "system" && byCat.has(c.key)).map((c) => (
                <div key={c.key} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "8px 10px" }}>
                  <div className="f-sans" style={{ fontSize: "12px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>{t(c)}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "3px 10px" }}>
                    {(byCat.get(c.key) ?? []).map((p) => {
                      const on = eff.has(p.key); const isAllow = allows.has(p.key); const isDeny = denies.has(p.key);
                      return (
                        <div key={p.key} className="flex items-center justify-between gap-1.5" style={{ fontSize: "11px" }}>
                          <span style={{ color: on ? "#7CFC9A" : "rgba(255,255,255,0.45)" }} title={p.key}>{on ? "✓" : "○"} {label(p)}{isAllow && <span style={{ color: "#7CFC9A" }}> +allow</span>}{isDeny && <span style={{ color: "#ff8a8e" }}> −deny</span>}</span>
                          <span className="flex gap-1">
                            <button disabled={busy} onClick={() => override(p.key, isAllow ? null : "allow")} title="allow" style={{ background: "none", border: "none", cursor: "pointer", color: isAllow ? "#7CFC9A" : "rgba(255,255,255,0.3)", fontSize: "12px" }}>✚</button>
                            <button disabled={busy} onClick={() => override(p.key, isDeny ? null : "deny")} title="deny" style={{ background: "none", border: "none", cursor: "pointer", color: isDeny ? "#ff8a8e" : "rgba(255,255,255,0.3)", fontSize: "12px" }}>⛔</button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>{t({ ar: "✚ سماح فردي · ⛔ منع فردي (المنع يتقدّم دائمًا). الصلاحيات = اتحاد المهن + السماح − المنع. لا مهنة تمنح صلاحيات المالك/الأدمن.", en: "✚ individual allow · ⛔ individual deny (deny always wins). Effective = professions ∪ allow − deny. No profession grants Owner/Admin." })}</div>
          </>
        )}
      </div>
    </div>
  );
}

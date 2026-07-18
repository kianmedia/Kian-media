"use client";
// Granular per-profession permission editor (catalog v2). Grouped + searchable, with
// select-all/clear per group, sensitive warnings, templates, copy-from, and a
// server READ-BACK after every write so nothing is silently saved. All writes go
// through authority-checked SECURITY DEFINER RPCs; this UI is convenience only.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  listPermissions, listProfessionPermissionKeys, setProfessionPermission, bulkSetProfessionPermissions,
  applyProfessionTemplate, copyProfessionPermissions, PERMISSION_CATEGORIES, PROFESSION_TEMPLATES,
  type Permission, type Profession,
} from "@/lib/portal/professions";

const inp: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "3px", padding: "6px 9px", color: "#fff", fontSize: "12px", outline: "none", colorScheme: "dark" };

export default function ProfessionPermissionsEditor({ profession, allProfessions, onClose }: {
  profession: Profession; allProfessions: Profession[]; onClose: () => void;
}) {
  const { t, isAr } = useI18n();
  const [perms, setPerms] = useState<Permission[]>([]);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadGrants = useCallback(async () => {
    const r = await listProfessionPermissionKeys(profession.id);
    if (r.ok) setGranted(new Set(r.data)); else setMsg({ ok: false, text: r.error });
  }, [profession.id]);
  useEffect(() => { void listPermissions().then((r) => { if (r.ok) setPerms(r.data); else setMsg({ ok: false, text: r.error }); }); void loadGrants(); }, [loadGrants]);

  const filtered = useMemo(() => perms.filter((p) => !q.trim() || p.key.includes(q.toLowerCase()) || p.label_ar.includes(q) || p.label_en.toLowerCase().includes(q.toLowerCase())), [perms, q]);
  const byCat = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of filtered) { const a = m.get(p.category) ?? []; a.push(p); m.set(p.category, a); }
    return m;
  }, [filtered]);

  // Toggle one permission, then READ BACK to confirm persistence (no silent save).
  async function toggle(p: Permission, next: boolean) {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await setProfessionPermission(profession.id, p.key, next);
    if (!r.ok) { setBusy(false); setMsg({ ok: false, text: (isAr ? "تعذّر الحفظ: " : "Save failed: ") + r.error }); return; }
    await loadGrants(); setBusy(false);
    setMsg({ ok: true, text: isAr ? "✓ حُفظ وتأكّد من الخادم." : "✓ Saved and confirmed." });
  }
  async function groupSet(cat: string, on: boolean) {
    if (busy) return; setBusy(true); setMsg(null);
    const keys = (byCat.get(cat) ?? []).filter((p) => p.sensitivity !== "system_only").map((p) => p.key);
    const r = await bulkSetProfessionPermissions(profession.id, keys, on);
    if (!r.ok) { setBusy(false); setMsg({ ok: false, text: r.error }); return; }
    await loadGrants(); setBusy(false); setMsg({ ok: true, text: isAr ? "✓ حُدّثت المجموعة." : "✓ Group updated." });
  }
  async function applyTpl(tpl: string) {
    if (!tpl || busy) return; setBusy(true); setMsg(null);
    const r = await applyProfessionTemplate(profession.id, tpl);
    if (!r.ok) { setBusy(false); setMsg({ ok: false, text: r.error }); return; }
    await loadGrants(); setBusy(false); setMsg({ ok: true, text: isAr ? "✓ طُبّق القالب." : "✓ Template applied." });
  }
  async function copyFrom(fromId: string) {
    if (!fromId || busy) return; setBusy(true); setMsg(null);
    const r = await copyProfessionPermissions(fromId, profession.id);
    if (!r.ok) { setBusy(false); setMsg({ ok: false, text: r.error }); return; }
    await loadGrants(); setBusy(false); setMsg({ ok: true, text: isAr ? "✓ نُسخت الصلاحيات." : "✓ Permissions copied." });
  }

  const catLabel = (k: string) => { const c = PERMISSION_CATEGORIES.find((x) => x.key === k); return c ? t(c) : k; };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} dir={isAr ? "rtl" : "ltr"} style={{ width: "100%", maxWidth: "720px", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", padding: "16px", margin: "16px 0" }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-white" style={{ fontSize: "15px", fontWeight: 700 }}>{t({ ar: "صلاحيات المهنة: ", en: "Profession permissions: " })}{isAr ? profession.name_ar : profession.name_en}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>

        <div className="flex gap-2 flex-wrap mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث في الصلاحيات…", en: "Search permissions…" })} style={{ ...inp, flex: 1, minWidth: "140px" }} />
          <select disabled={busy} onChange={(e) => { void applyTpl(e.target.value); e.target.value = ""; }} style={{ ...inp, width: "auto" }} defaultValue="">
            <option value="">{t({ ar: "تطبيق قالب…", en: "Apply template…" })}</option>
            {PROFESSION_TEMPLATES.map((tp) => <option key={tp.key} value={tp.key}>{t(tp)}</option>)}
          </select>
          <select disabled={busy} onChange={(e) => { void copyFrom(e.target.value); e.target.value = ""; }} style={{ ...inp, width: "auto" }} defaultValue="">
            <option value="">{t({ ar: "نسخ من مهنة…", en: "Copy from…" })}</option>
            {allProfessions.filter((p) => p.id !== profession.id).map((p) => <option key={p.id} value={p.id}>{isAr ? p.name_ar : p.name_en}</option>)}
          </select>
        </div>
        {msg && <p className="f-sans mb-2" style={{ fontSize: "12px", color: msg.ok ? "#7CFC9A" : "#ff8a8e" }}>{msg.text}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "62vh", overflowY: "auto" }}>
          {PERMISSION_CATEGORIES.filter((c) => byCat.has(c.key)).map((c) => {
            const list = byCat.get(c.key) ?? [];
            const systemOnly = c.key === "system";
            const grantable = list.filter((p) => p.sensitivity !== "system_only");
            const allOn = grantable.length > 0 && grantable.every((p) => granted.has(p.key));
            return (
              <div key={c.key} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "8px 10px" }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="f-sans" style={{ fontSize: "12px", fontWeight: 700, color: c.key === "finance" ? "rgba(255,210,138,0.95)" : c.key === "system" ? "rgba(255,138,142,0.9)" : "#fff" }}>{t(c)}</span>
                  {!systemOnly && <button disabled={busy} onClick={() => void groupSet(c.key, !allOn)} className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", background: "none", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "3px", padding: "3px 8px", cursor: "pointer" }}>{allOn ? t({ ar: "مسح المجموعة", en: "Clear group" }) : t({ ar: "تحديد الكل", en: "Select all" })}</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "3px 10px" }}>
                  {list.map((p) => {
                    const sysOnly = p.sensitivity === "system_only";
                    return (
                      <label key={p.key} className="flex items-center gap-1.5" style={{ fontSize: "11.5px", color: sysOnly ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.82)", opacity: sysOnly ? 0.6 : 1 }} title={p.key}>
                        <input type="checkbox" disabled={busy || sysOnly} checked={granted.has(p.key)} onChange={(e) => void toggle(p, e.target.checked)} />
                        <span>{isAr ? p.label_ar : p.label_en}
                          {p.sensitivity === "sensitive" && <span title={t({ ar: "صلاحية حساسة — للمالك/السوبر-أدمن", en: "Sensitive — owner/super-admin only" })} style={{ color: "rgba(255,210,138,0.95)" }}> ⚠</span>}
                          {sysOnly && <span style={{ color: "rgba(255,138,142,0.8)" }}> 🔒</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>{t({ ar: "الصلاحيات الحساسة (⚠) يمنحها المالك/السوبر-أدمن فقط. صلاحيات النظام (🔒) لا تُمنح عبر المهن. كل تغيير يُحفظ ويُؤكَّد من الخادم.", en: "Sensitive (⚠) = owner/super-admin only. System (🔒) never grantable via professions. Every change is saved and server-confirmed." })}</div>
      </div>
    </div>
  );
}

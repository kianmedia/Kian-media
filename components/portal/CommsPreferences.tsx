"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/CommsPreferences.tsx — the preference centre.
//
// Per CATEGORY, per CHANNEL, plus a language choice. This replaces nothing:
// public.notification_preferences (the Phase-0 global triple) is untouched and
// still read by whatever already reads it. This is the hub's own, finer store.
//
// TWO THINGS THE UI MUST NOT LIE ABOUT
//   1. A mandatory category cannot be switched off. The switch is disabled AND
//      the database ignores preferences for mandatory events — so the UI is
//      telling the truth rather than pretending to control something it does not.
//   2. A disabled channel means nothing is queued on it regardless of the
//      preference. The banner says so instead of letting a green switch imply
//      messages are flowing.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  commsPrefsGet, commsPrefsSet, commsHealth, commsCategoryAr,
  type CommsPrefCategory, type CommsHealth,
} from "@/lib/portal/comms";

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "4px", padding: "14px 16px",
};

function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={label}
      className="f-sans"
      style={{
        fontSize: "10.5px", letterSpacing: "1px", textTransform: "uppercase",
        padding: "6px 12px", borderRadius: "3px", whiteSpace: "nowrap",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        color: on ? "#5fd08a" : "rgba(255,255,255,0.5)",
        background: on ? "rgba(95,208,138,0.08)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${on ? "rgba(95,208,138,0.35)" : "rgba(255,255,255,0.12)"}`,
      }}>
      {label} · {on ? "مُفعَّل" : "موقوف"}
    </button>
  );
}

export default function CommsPreferences() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "ready" | "blocked">("loading");
  const [blockMsg, setBlockMsg] = useState("");
  const [blockKind, setBlockKind] = useState<"needs_migration" | "error">("error");
  const [rows, setRows] = useState<CommsPrefCategory[]>([]);
  const [channels, setChannels] = useState<CommsHealth["channels"] | null>(null);
  const [busy, setBusy] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    const p = await commsPrefsGet();
    if (p.state !== "ok") {
      setBlockKind(p.state === "needs_migration" ? "needs_migration" : "error");
      setBlockMsg(p.state === "needs_migration"
        ? "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/communications_hub_RUNME.sql."
        : p.message);
      setPhase("blocked");
      return;
    }
    setRows(p.data);
    // Channel flags are readable by staff only; a client simply does not see
    // the banner. Not an error, so it is never surfaced as one.
    const h = await commsHealth();
    setChannels(h.state === "ok" ? h.data.channels : null);
    setPhase("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function set(c: CommsPrefCategory, patch: Partial<Pick<CommsPrefCategory, "portal" | "email" | "whatsapp" | "locale">>) {
    const next = { ...c, ...patch };
    setBusy(c.category);
    setRows((prev) => prev.map((x) => (x.category === c.category ? next : x)));
    const r = await commsPrefsSet(next.category, next.portal, next.email, next.whatsapp, next.locale);
    setBusy("");
    if (r.state !== "ok") {
      setFlash(r.state === "needs_migration" ? "الميزة بانتظار تفعيل قاعدة البيانات." : r.message);
      void load();   // reload rather than leave the UI showing a change that did not persist
      return;
    }
    setFlash(t({ ar: "حُفظ التفضيل.", en: "Preference saved." }));
    window.setTimeout(() => setFlash(""), 3000);
  }

  const channelOff = (name: "portal" | "email" | "whatsapp"): boolean =>
    channels ? channels[name]?.enabled !== true : false;

  return (
    <div style={{ direction: isAr ? "rtl" : "ltr" }}>
      <div className="mb-6">
        <div className="eyebrow mb-3">{t({ ar: "تفضيلات التنبيه", en: "Notification preferences" })}</div>
        <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", lineHeight: 1.9 }}>
          {t({
            ar: "اختر كيف تصلك كل فئة. التنبيهات الإلزامية (قرارات وحوادث حرجة) لا يمكن إيقافها.",
            en: "Choose how each category reaches you. Mandatory alerts (decisions and critical incidents) cannot be switched off.",
          })}
        </p>
      </div>

      {flash && (
        <div className="f-sans" style={{ marginBottom: "12px", padding: "9px 13px", fontSize: "12px", color: "#fff", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "3px" }}>{flash}</div>
      )}

      {phase === "loading" && (
        <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "18px 0" }}>
          {t({ ar: "جارٍ التحميل...", en: "Loading..." })}
        </div>
      )}

      {phase === "blocked" && (
        <div className="f-sans" style={{
          padding: "14px 16px", fontSize: "13px", borderRadius: "3px", lineHeight: 1.8,
          color: blockKind === "needs_migration" ? "#e0b955" : "#ff8a8e",
          background: blockKind === "needs_migration" ? "rgba(224,185,85,0.08)" : "rgba(227,30,36,0.08)",
          border: `1px solid ${blockKind === "needs_migration" ? "rgba(224,185,85,0.3)" : "rgba(227,30,36,0.3)"}`,
        }}>{blockMsg}</div>
      )}

      {phase === "ready" && (
        <>
          {channels && (
            <div className="f-sans" style={{ ...CARD, marginBottom: "14px", fontSize: "11.5px", color: "rgba(255,255,255,0.5)", lineHeight: 1.9 }}>
              {t({ ar: "حالة القنوات الآن:", en: "Channel status right now:" })}{" "}
              {(["portal", "email", "whatsapp"] as const).map((c) => (
                <span key={c} style={{ marginInlineEnd: "12px" }}>
                  {c === "portal" ? "البوابة" : c === "email" ? "البريد" : "واتساب"}:{" "}
                  <span style={{ color: channels[c]?.enabled ? "#5fd08a" : "#ff8a8e" }}>
                    {channels[c]?.enabled ? "مُفعَّلة" : "معطّلة"}
                  </span>
                </span>
              ))}
              <div style={{ marginTop: "6px", color: "rgba(255,255,255,0.35)" }}>
                القناة المعطّلة لا تُرسل شيئًا مهما كان تفضيلك — التفضيل يُحفظ ويسري فور تفعيلها.
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="text-center" style={{ padding: "50px 20px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
              <p className="text-white/55" style={{ fontSize: "14px" }}>
                {t({ ar: "لا توجد فئات تنبيه بعد.", en: "No notification categories yet." })}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {rows.map((c) => (
                <div key={c.category} style={CARD}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
                    <div>
                      <div className="text-white" style={{ fontSize: "14px", fontWeight: 600 }}>{commsCategoryAr(c.category)}</div>
                      {c.has_mandatory && (
                        <div className="f-sans" style={{ fontSize: "10.5px", color: "#e0b955", marginTop: "3px" }}>
                          {t({ ar: "تحتوي تنبيهات إلزامية لا يمكن إيقافها", en: "Contains mandatory alerts that cannot be muted" })}
                        </div>
                      )}
                    </div>
                    <select value={c.locale} disabled={busy === c.category}
                      onChange={(e) => void set(c, { locale: e.target.value as "ar" | "en" })}
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "3px", color: "#fff", padding: "6px 9px", fontSize: "11.5px" }}>
                      <option value="ar">العربية</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Toggle label="البوابة" on={c.portal} disabled={busy === c.category || c.has_mandatory}
                      onClick={() => void set(c, { portal: !c.portal })} />
                    <Toggle label="البريد" on={c.email} disabled={busy === c.category || c.has_mandatory}
                      onClick={() => void set(c, { email: !c.email })} />
                    <Toggle label="واتساب" on={c.whatsapp} disabled={busy === c.category || channelOff("whatsapp")}
                      onClick={() => void set(c, { whatsapp: !c.whatsapp })} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

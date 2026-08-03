"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/communications — the Communications Hub surface.
//
// Two tabs: the admin dashboard (authorized in the database by comms_can_view /
// comms_can_admin) and the personal preference centre (available to any signed-in
// user for their own row). Nothing on this page can send a message.
//
// The page itself renders unconditionally. Authorization and feature detection
// happen INSIDE each component, so a missing migration shows an honest amber
// notice instead of a blank screen — the owner deploys code before SQL.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import CommunicationsHub from "@/components/portal/CommunicationsHub";
import CommsPreferences from "@/components/portal/CommsPreferences";

export default function CommunicationsPage() {
  const { t, isAr } = useI18n();
  const [tab, setTab] = useState<"hub" | "prefs">("hub");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: "10.5px", letterSpacing: "1.4px", textTransform: "uppercase",
    padding: "9px 16px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap",
    background: active ? "rgba(227,30,36,0.10)" : "none",
    border: `1px solid ${active ? "rgba(227,30,36,0.35)" : "rgba(255,255,255,0.12)"}`,
    color: active ? "#fff" : "rgba(255,255,255,0.55)",
  });

  return (
    <div style={{ direction: isAr ? "rtl" : "ltr" }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "22px", flexWrap: "wrap" }}>
        <button className="f-sans" style={tabStyle(tab === "hub")} onClick={() => setTab("hub")}>
          {t({ ar: "لوحة الاتصالات", en: "Communications board" })}
        </button>
        <button className="f-sans" style={tabStyle(tab === "prefs")} onClick={() => setTab("prefs")}>
          {t({ ar: "تفضيلاتي", en: "My preferences" })}
        </button>
      </div>

      {tab === "hub" ? <CommunicationsHub /> : <CommsPreferences />}
    </div>
  );
}

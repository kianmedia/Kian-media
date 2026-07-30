"use client";
// ════════════════════════════════════════════════════════════════════════════
// Portal navigation for small screens (PWA V1).
//
// The desktop tab strip wraps to five or six rows on a phone for an admin with
// twenty tabs, pushing the actual page below the fold — and in a standalone
// installed window there is no browser chrome to fall back on. So on <768px the
// strip is replaced by a fixed bottom bar (thumb reach) plus a full sheet that
// lists EVERY tab the viewer is entitled to, so nothing becomes unreachable.
//
// It renders the tabs it is GIVEN. It computes no entitlement of its own: the
// list was already resolved once by the shell's single entitlement helper, and
// the database is what actually enforces access. A nav that decided visibility
// itself would be a second, drifting copy of the permission model — and the
// copy that drifts is always the one nobody re-reads.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import type { PortalTab } from "./nav";

const PRIMARY_MAX = 4;

export default function PortalMobileNav({
  tabs,
  pathname,
  unread,
  label,
  onSignOut,
}: {
  tabs: PortalTab[];
  pathname: string | null;
  unread: number;
  /** Localiser supplied by the shell so this file holds no second i18n source. */
  label: (s: { ar: string; en: string }) => string;
  onSignOut: () => void;
}) {
  const [sheet, setSheet] = useState(false);

  // Route change closes the sheet; otherwise it stays open over the new page.
  useEffect(() => { setSheet(false); }, [pathname]);

  // Body scroll lock while the sheet is open, restored exactly as found.
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sheet]);

  if (tabs.length === 0) return null;

  const notif = tabs.find((tb) => tb.key === "notifications");
  const primary = tabs.filter((tb) => tb.key !== "notifications").slice(0, PRIMARY_MAX - (notif ? 1 : 0));
  const bar = notif ? [...primary, notif] : primary;

  const item = (tb: PortalTab, active: boolean) => (
    <Link
      key={tb.key}
      href={tb.href}
      className="pt-mnav-item"
      aria-current={active ? "page" : undefined}
      style={{
        flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: "3px",
        padding: "8px 4px", textDecoration: "none",
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        borderTop: `2px solid ${active ? "#E31E24" : "transparent"}`,
      }}
    >
      <span
        style={{
          fontSize: "10.5px", fontWeight: 600, lineHeight: 1.4,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          maxWidth: "100%", textAlign: "center",
        }}
      >
        {label({ ar: tb.ar, en: tb.en })}
      </span>
      {tb.key === "notifications" && unread > 0 && (
        <span
          aria-label={`${unread} unread`}
          style={{
            minWidth: "15px", height: "15px", padding: "0 4px", borderRadius: "8px",
            background: "#E31E24", color: "#fff", fontSize: "9px", fontWeight: 700,
            display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );

  return (
    <>
      {/* ─── Fixed bottom bar ─── */}
      <nav
        className="pt-mnav"
        aria-label={label({ ar: "تنقّل البوابة", en: "Portal navigation" })}
        style={{
          position: "fixed", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0, zIndex: 95,
          display: "flex", alignItems: "stretch",
          background: "rgba(6,6,6,0.98)",
          borderTop: "1px solid rgba(255,255,255,0.10)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          backdropFilter: "blur(10px)",
        }}
      >
        {bar.map((tb) => item(tb, pathname === tb.href))}
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-expanded={sheet}
          style={{
            flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "3px",
            padding: "8px 4px", background: "none", border: "none",
            borderTop: "2px solid transparent",
            color: "rgba(255,255,255,0.5)", cursor: "pointer",
            fontSize: "10.5px", fontWeight: 600,
          }}
        >
          {label({ ar: "المزيد", en: "More" })}
        </button>
      </nav>

      {/* ─── Full sheet: every entitled tab + sign out ─── */}
      {sheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label({ ar: "كل الأقسام", en: "All sections" })}
          onClick={() => setSheet(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 125,
            background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxHeight: "80vh", overflowY: "auto",
              background: "#0a0a0a", borderTop: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "10px 10px 0 0",
              padding: "16px 14px calc(16px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {tabs.map((tb) => {
                const active = pathname === tb.href;
                return (
                  <Link
                    key={tb.key}
                    href={tb.href}
                    style={{
                      display: "block", padding: "12px 12px", borderRadius: "3px",
                      fontSize: "12px", fontWeight: 600, textDecoration: "none",
                      color: active ? "#fff" : "rgba(255,255,255,0.62)",
                      background: active ? "rgba(227,30,36,0.14)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${active ? "rgba(227,30,36,0.5)" : "rgba(255,255,255,0.07)"}`,
                    }}
                  >
                    {label({ ar: tb.ar, en: tb.en })}
                  </Link>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
              <button
                type="button"
                onClick={onSignOut}
                style={{
                  flex: 1, fontSize: "10.5px", letterSpacing: "1.8px", textTransform: "uppercase",
                  color: "rgba(255,255,255,0.6)", background: "none",
                  border: "1px solid rgba(255,255,255,0.14)", padding: "11px 14px",
                  borderRadius: "3px", cursor: "pointer",
                }}
              >
                {label({ ar: "تسجيل الخروج", en: "Sign Out" })}
              </button>
              <button
                type="button"
                onClick={() => setSheet(false)}
                style={{
                  flex: 1, fontSize: "10.5px", letterSpacing: "1.8px", textTransform: "uppercase",
                  color: "rgba(255,255,255,0.45)", background: "none",
                  border: "1px solid rgba(255,255,255,0.10)", padding: "11px 14px",
                  borderRadius: "3px", cursor: "pointer",
                }}
              >
                {label({ ar: "إغلاق", en: "Close" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

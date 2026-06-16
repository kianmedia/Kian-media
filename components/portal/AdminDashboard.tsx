"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Dashboard — the default portal experience for account_type='admin'.
// Summary tiles (counts via admin RLS) linking to the admin sections.
// No client submission forms here.
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { adminCount } from "@/lib/portal/admin";
import { listNotifications } from "@/lib/portal/notifications";
import type { NotificationRow } from "@/lib/portal/types";

type TileMode = "actionable" | "readonly";
interface Tile {
  href: string; ar: string; en: string; count: number | null; descAr: string; descEn: string; mode: TileMode;
}

export default function AdminDashboard() {
  const { t, isAr } = useI18n();
  const { profile } = usePortal();
  const [counts, setCounts] = useState<{ newQuotes: number; clientMsgs: number; files: number; projects: number; newOpps: number } | null>(null);
  const [recent, setRecent] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [newQuotes, clientMsgs, files, projects, newOpps] = await Promise.all([
        adminCount("quote_requests", "status=eq.new&is_deleted=eq.false"),
        adminCount("messages", "sender=eq.user&is_deleted=eq.false"),
        adminCount("file_links", "is_deleted=eq.false"),
        adminCount("projects", "is_deleted=eq.false"),
        adminCount("opportunity_requests", "status=eq.new&is_deleted=eq.false"),
      ]);
      if (alive) setCounts({ newQuotes, clientMsgs, files, projects, newOpps });
      const n = await listNotifications(8);
      if (alive) setRecent(n.ok ? n.data : []);
    })();
    return () => { alive = false; };
  }, []);

  const tiles: Tile[] = [
    { href: "/client-portal/projects", ar: "إدارة المشاريع",       en: "Project Management", count: counts?.projects ?? null, descAr: "مشروع", descEn: "projects", mode: "actionable" },
    { href: "/client-portal/quotes",   ar: "طلبات عروض السعر",     en: "Quote Requests", count: counts?.newQuotes ?? null, descAr: "طلب جديد", descEn: "new", mode: "readonly" },
    { href: "/client-portal/messages", ar: "رسائل العملاء",        en: "Client Messages", count: counts?.clientMsgs ?? null, descAr: "رسالة من العملاء", descEn: "from clients", mode: "actionable" },
    { href: "/client-portal/files",    ar: "روابط وملفات العملاء", en: "Client Files", count: counts?.files ?? null, descAr: "رابط", descEn: "links", mode: "readonly" },
    { href: "/client-portal/opportunities", ar: "مركز الفرص",      en: "Opportunities", count: counts?.newOpps ?? null, descAr: "طلب فرصة جديد", descEn: "new requests", mode: "actionable" },
    { href: "/client-portal/accounts", ar: "إدارة العملاء",        en: "Accounts", count: null, descAr: "الحسابات والصلاحيات", descEn: "accounts & status", mode: "actionable" },
    { href: "/client-portal/notifications", ar: "الإشعارات",       en: "Notifications", count: null, descAr: "آخر التحديثات", descEn: "latest updates", mode: "readonly" },
  ];

  return (
    <div>
      <div className="mb-10">
        <div className="eyebrow mb-4">{t({ ar: "لوحة الإدارة", en: "Admin Dashboard" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(26px,4.5vw,40px)", lineHeight: 1.25 }}>
          {t({ ar: "أهلاً، ", en: "Welcome, " })}{profile.full_name || profile.email}
        </h1>
        <p className="text-white/50" style={{ fontSize: "13px", marginTop: "8px" }}>
          {t({ ar: "إدارة طلبات العملاء والرسائل والمشاريع.", en: "Manage client requests, messages, and projects." })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="pt-card"
            style={{ display: "block", textDecoration: "none", padding: "24px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", transition: "all 0.4s" }}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-white" style={{ fontSize: "16px", fontWeight: 700 }}>{t({ ar: tile.ar, en: tile.en })}</h3>
              {tile.count !== null && (
                <span className="f-display" style={{ fontSize: "28px", color: "#E31E24", lineHeight: 1 }}>{tile.count}</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2" style={{ marginTop: "6px" }}>
              <p className="text-white/45" style={{ fontSize: "12px" }}>{t({ ar: tile.descAr, en: tile.descEn })}</p>
              <span className="f-sans" style={{ fontSize: "8.5px", letterSpacing: "1px", textTransform: "uppercase", padding: "3px 8px", borderRadius: "2px",
                color: tile.mode === "actionable" ? "rgba(124,252,154,0.8)" : "rgba(255,255,255,0.45)",
                background: tile.mode === "actionable" ? "rgba(124,252,154,0.08)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${tile.mode === "actionable" ? "rgba(124,252,154,0.3)" : "rgba(255,255,255,0.12)"}` }}>
                {tile.mode === "actionable" ? t({ ar: "قابل للتعديل", en: "Actionable" }) : t({ ar: "للعرض فقط", en: "View only" })}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent activity (from admin notifications — activity_log has no client grant) */}
      <div style={{ marginTop: "32px" }}>
        <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600, marginBottom: "14px" }}>
          {t({ ar: "آخر النشاط", en: "Recent Activity" })}
        </div>
        {recent === null ? (
          <p className="f-sans" style={{ fontSize: "12px", letterSpacing: "1px", color: "rgba(255,255,255,0.4)" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>
        ) : recent.length === 0 ? (
          <div className="text-center" style={{ padding: "40px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
            <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "لا يوجد نشاط حديث بعد.", en: "No recent activity yet." })}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {recent.map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-3" style={{ padding: "12px 15px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px" }}>
                <span className="text-white/80" style={{ fontSize: "13.5px" }}>{isAr ? n.title_ar : n.title_en}</span>
                <span className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", direction: "ltr", whiteSpace: "nowrap" }}>
                  {new Date(n.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", lineHeight: 1.7, marginTop: "24px" }}>
        {t({
          ar: "إدارة الحسابات وترقية العملاء والمخرجات تتم حالياً عبر لوحة Supabase حتى اكتمال لوحة الإدارة الكاملة.",
          en: "Account management, client upgrades, and deliverables are handled via the Supabase dashboard until the full admin panel ships.",
        })}
      </p>
    </div>
  );
}

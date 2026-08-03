"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal — role switch (S4 fix).
//   admin → AdminDashboard
//   lead/client → client Overview (welcome + quick actions)
// ════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import AdminDashboard from "@/components/portal/AdminDashboard";
import { listNotifications } from "@/lib/portal/notifications";
import { listMyQuotes } from "@/lib/portal/leads";
import { listOpportunities } from "@/lib/opportunities";
import type { NotificationRow, QuoteRequest } from "@/lib/portal/types";

const LEVEL_LABEL = {
  prospect: { ar: "عميل محتمل", en: "Prospect" },
  active:   { ar: "عميل نشط",   en: "Active Client" },
  vip:      { ar: "عميل VIP",   en: "VIP Client" },
} as const;

export default function OverviewPage() {
  const { t, isAr } = useI18n();
  const { profile, readOnly, caps } = usePortal();

  const isClient = profile.account_type === "client";
  const [recentNotifs, setRecentNotifs] = useState<NotificationRow[] | null>(null);
  const [recentQuotes, setRecentQuotes] = useState<QuoteRequest[] | null>(null);

  useEffect(() => {
    if (!caps.isClientSide) return;   // client/lead only; staff/admin use other views
    let alive = true;
    (async () => {
      const [n, q] = await Promise.all([listNotifications(5), listMyQuotes()]);
      if (!alive) return;
      if (n.ok) setRecentNotifs(n.data);
      if (q.ok) setRecentQuotes(q.data.slice(0, 3));
    })();
    return () => { alive = false; };
  }, [caps.isClientSide]);

  if (caps.isAdminArea) return <AdminDashboard />;
  if (caps.isHr) return <HRHome name={profile.full_name || profile.email} />;

  return (
    <div>
      <div className="mb-10">
        <div className="eyebrow mb-4">{t({ ar: "بوابة العملاء", en: "Client Portal" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(26px,4.5vw,40px)", lineHeight: 1.25 }}>
          {t({ ar: "أهلاً، ", en: "Welcome, " })}{profile.full_name || profile.email}
        </h1>
        <div className="flex flex-wrap gap-2 mt-4">
          <Badge>
            {isClient ? t(LEVEL_LABEL[profile.client_level]) : t({ ar: "حساب جديد", en: "New Account" })}
          </Badge>
          {profile.company && <Badge muted>{profile.company}</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {isClient ? (
          <ActionCard href="/client-portal/projects" title={t({ ar: "مشاريعي", en: "My Projects" })} desc={t({ ar: "تابع حالة مشاريعك ومراحل تنفيذها.", en: "Track your projects and their progress." })} />
        ) : (
          <ActionCard href="/client-portal/quotes" title={t({ ar: "اطلب عرض سعر", en: "Request a Quote" })} desc={t({ ar: "أخبرنا عن مشروعك وسنرد بعرض مخصص.", en: "Tell us about your project and we'll respond with a tailored quote." })} disabled={readOnly} />
        )}
        <ActionCard href="/client-portal/messages" title={t({ ar: "تواصل معنا", en: "Message Us" })} desc={t({ ar: "أرسل استفسارك وسيرد فريق كيان ميديا.", en: "Send your inquiry and the Kian Media team will reply." })} disabled={readOnly} />
        <ActionCard href="/client-portal/files" title={t({ ar: "أرسل ملفاتك", en: "Submit Files" })} desc={t({ ar: "شارك روابط ملفاتك ومراجعك بسهولة.", en: "Share your file links and references easily." })} disabled={readOnly} />
        <ActionCard href="/client-portal/profile" title={t({ ar: "ملفي الشخصي", en: "My Profile" })} desc={t({ ar: "حدّث بياناتك وتفضيلات الإشعارات.", en: "Update your details and notification preferences." })} />
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ marginTop: "36px" }}>
        <RecentBlock
          title={t({ ar: "آخر الإشعارات", en: "Recent Notifications" })}
          href="/client-portal/notifications"
          empty={t({ ar: "لا توجد إشعارات بعد.", en: "No notifications yet." })}
          items={recentNotifs}
          render={(n) => ({ main: isAr ? n.title_ar : n.title_en, date: n.created_at, unread: !n.read_at })}
        />
        <RecentBlock
          title={t({ ar: "آخر طلبات السعر", en: "Recent Quote Requests" })}
          href="/client-portal/quotes"
          empty={t({ ar: "لا توجد طلبات بعد.", en: "No requests yet." })}
          items={recentQuotes}
          render={(q) => ({ main: q.reference || (isAr ? "طلب" : "Request"), date: q.created_at, unread: false })}
        />
      </div>
    </div>
  );
}

// HR landing — a real Opportunities dashboard. HR reads opportunity_requests via
// RLS (owner/manager/hr) and has NO access to projects/quotes/offers/deliverables/
// financials (DB-enforced elsewhere).
function HRHome({ name }: { name: string }) {
  const { t, isAr } = useI18n();
  const [stats, setStats] = useState<{ total: number; nw: number; review: number } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await listOpportunities();
      if (!alive) return;
      if (!r.ok) { setStats({ total: 0, nw: 0, review: 0 }); return; }
      const rows = r.data;
      setStats({ total: rows.length, nw: rows.filter((x) => x.status === "new").length, review: rows.filter((x) => x.status === "under_review").length });
    })();
    return () => { alive = false; };
  }, []);

  const cards = [
    { ar: "إجمالي الطلبات", en: "Total requests", v: stats?.total },
    { ar: "طلبات جديدة", en: "New", v: stats?.nw },
    { ar: "قيد المراجعة", en: "Under review", v: stats?.review },
  ];

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "الموارد البشرية", en: "Human Resources" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(26px,4.5vw,40px)", lineHeight: 1.25 }}>{t({ ar: "أهلاً، ", en: "Welcome, " })}{name}</h1>
        <p className="text-white/50" style={{ fontSize: "13px", marginTop: "8px" }}>{t({ ar: "متابعة طلبات مركز الفرص — التوظيف والتدريب والمواهب والتعاون.", en: "Track Opportunities Center requests — jobs, training, talent, collaboration." })}</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {cards.map((c) => (
          <div key={c.en} style={{ padding: "18px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", textAlign: "center" }}>
            <div className="f-display" style={{ fontSize: "30px", color: "#E31E24", lineHeight: 1 }}>{c.v ?? "…"}</div>
            <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "6px" }}>{isAr ? c.ar : c.en}</div>
          </div>
        ))}
      </div>

      <Link href="/client-portal/opportunities" className="btn-red" style={{ justifyContent: "center", textDecoration: "none" }}>
        <span>{t({ ar: "فتح مركز الفرص", en: "Open Opportunities Center" })}</span>
      </Link>
    </div>
  );
}

function RecentBlock<T>({ title, href, empty, items, render }: {
  title: string; href: string; empty: string; items: T[] | null;
  render: (x: T) => { main: string; date: string; unread: boolean };
}) {
  const { t, isAr } = useI18n();
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600 }}>{title}</div>
        <Link href={href} className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>{t({ ar: "الكل", en: "All" })}</Link>
      </div>
      {items === null ? (
        <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>
      ) : items.length === 0 ? (
        <div style={{ padding: "22px", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "4px" }}>
          <p className="text-white/40" style={{ fontSize: "13px" }}>{empty}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {items.map((x, i) => {
            const r = render(x);
            return (
              <div key={i} className="flex items-center justify-between gap-3" style={{ padding: "11px 14px", background: "rgba(255,255,255,0.02)", border: `1px solid ${r.unread ? "rgba(227,30,36,0.22)" : "rgba(255,255,255,0.07)"}`, borderRadius: "4px" }}>
                <span className="text-white/80" style={{ fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: r.main.startsWith("QR-") ? "ltr" : undefined }}>{r.main}</span>
                <span className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.35)", direction: "ltr", whiteSpace: "nowrap" }}>{new Date(r.date).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Badge({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span className="f-sans" style={{
      fontSize: "10.5px", letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 600,
      padding: "6px 12px", borderRadius: "3px",
      color: muted ? "rgba(255,255,255,0.55)" : "#E31E24",
      background: muted ? "rgba(255,255,255,0.04)" : "rgba(227,30,36,0.1)",
      border: `1px solid ${muted ? "rgba(255,255,255,0.1)" : "rgba(227,30,36,0.3)"}`,
    }}>
      {children}
    </span>
  );
}

function ActionCard({ href, title, desc, disabled }: { href: string; title: string; desc: string; disabled?: boolean }) {
  return (
    <Link href={href} aria-disabled={disabled}
      style={{ display: "block", padding: "26px 24px", textDecoration: "none", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", transition: "all 0.4s", opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}
      className="pt-card">
      <h3 className="text-white" style={{ fontSize: "17px", fontWeight: 700, marginBottom: "8px" }}>{title}</h3>
      <p className="text-white/50" style={{ fontSize: "13.5px", lineHeight: 1.7 }}>{desc}</p>
    </Link>
  );
}

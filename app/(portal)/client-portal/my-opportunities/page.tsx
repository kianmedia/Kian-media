"use client";
// /client-portal/my-opportunities — applicant's own opportunity requests (طلباتي).
// The tab only appears when the email matches (PortalShell); this page also guards.
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import MyOpportunities from "@/components/portal/MyOpportunities";

export default function MyOpportunitiesPage() {
  const { t } = useI18n();
  const { hasMyOpportunities } = usePortal();
  if (!hasMyOpportunities) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px", lineHeight: 1.8 }}>
          {t({ ar: "لا توجد طلبات مرتبطة ببريدك الإلكتروني. تأكد من استخدام نفس البريد الذي قدمت به طلبك في مركز الفرص.", en: "No requests are linked to your email. Make sure you used the same email you applied with in the Opportunities Center." })}
        </p>
      </div>
    );
  }
  return <MyOpportunities />;
}

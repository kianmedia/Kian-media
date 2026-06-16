"use client";
// /client-portal/opportunities — Opportunities Center (owner/admin/manager/hr).
// Tab is hidden from other roles; this page also guards defensively. Data access
// is RLS-enforced (can_see_opportunities).
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import AdminOpportunities from "@/components/portal/AdminOpportunities";

export default function OpportunitiesAdminPage() {
  const { t } = useI18n();
  const { caps } = usePortal();
  if (!caps.canSeeOpportunities) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>{t({ ar: "لا تملك صلاحية الوصول لمركز الفرص.", en: "You don't have access to the Opportunities Center." })}</p>
      </div>
    );
  }
  return <AdminOpportunities />;
}

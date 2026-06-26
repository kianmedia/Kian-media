"use client";
// /client-portal/deliveries — Notification Delivery Log (Stage 1 observability).
// Staff-only: owner/manager/sales/finance (= can_manage_quotes, matching the RLS).
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import DeliveriesView from "@/components/portal/DeliveriesView";

export default function DeliveriesPage() {
  const { t } = useI18n();
  const { caps } = usePortal();
  if (!(caps.canSeeFinancials || caps.canSeeInvoices)) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>{t({ ar: "لا تملك صلاحية الوصول لهذه الصفحة.", en: "You don't have access to this page." })}</p>
      </div>
    );
  }
  return <DeliveriesView />;
}

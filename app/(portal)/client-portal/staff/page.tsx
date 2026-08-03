"use client";
// /client-portal/staff — Staff Management (owner/admin area only). Non-admin-area
// viewers never see the tab; this page also guards defensively.
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import AdminStaff from "@/components/portal/AdminStaff";

export default function StaffPage() {
  const { t } = useI18n();
  const { caps } = usePortal();
  if (!caps.isAdminArea) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>{t({ ar: "لا تملك صلاحية الوصول لهذه الصفحة.", en: "You don't have access to this page." })}</p>
      </div>
    );
  }
  return <AdminStaff />;
}

"use client";
// Admin tab — role-guarded; real panel ships in S9.
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import ComingSoon from "@/components/portal/ComingSoon";

export default function AdminPage() {
  const { t } = useI18n();
  const { profile } = usePortal();

  if (profile.account_type !== "admin") {
    return (
      <div className="text-center" style={{ padding: "70px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>
          {t({ ar: "هذه الصفحة مخصصة لفريق الإدارة فقط.", en: "This page is restricted to the admin team." })}
        </p>
      </div>
    );
  }
  return <ComingSoon step="S9" ar="لوحة الإدارة" en="Admin Panel" />;
}

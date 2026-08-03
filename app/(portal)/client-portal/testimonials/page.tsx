"use client";
// /client-portal/testimonials — Testimonials moderation (owner/super_admin/manager).
// Tab is hidden from other roles; this page also guards defensively. Writes are
// civ_can_manage()-guarded RPCs; enabling public display is owner-only (civ_can_admin).
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import AdminTestimonials from "@/components/portal/AdminTestimonials";

export default function TestimonialsAdminPage() {
  const { t } = useI18n();
  const { caps } = usePortal();
  if (!caps.isAdminArea) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>{t({ ar: "لا تملك صلاحية إدارة آراء العملاء.", en: "You don't have access to testimonials moderation." })}</p>
      </div>
    );
  }
  return <AdminTestimonials />;
}

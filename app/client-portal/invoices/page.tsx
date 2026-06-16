"use client";
// /client-portal/invoices — Invoices (owner/admin/manager/finance). Placeholder
// until the Zoho Books integration ships (see docs/zoho_books_portal_integration_PROPOSAL.md
// + the invoices table in docs/staff_assignment_notifications_finance_ADDENDUM.sql).
// Visibility is DB-enforced (can_see_invoices); this is just the shell.
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";

export default function InvoicesPage() {
  const { t } = useI18n();
  const { caps } = usePortal();
  if (!caps.canSeeInvoices) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>{t({ ar: "لا تملك صلاحية الوصول للفواتير.", en: "You don't have access to invoices." })}</p>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "المالية", en: "Finance" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "الفواتير", en: "Invoices" })}
        </h1>
      </div>
      <div style={{ padding: "28px 24px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.14)", borderRadius: "6px" }}>
        <h2 className="text-white" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "10px" }}>
          {t({ ar: "تكامل Zoho Books قادم قريباً", en: "Zoho Books integration — coming soon" })}
        </h2>
        <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.9, maxWidth: "560px" }}>
          {t({
            ar: "ستظهر هنا فواتير العملاء وعروض الأسعار من Zoho Books فور تفعيل التكامل (من جهة الخادم فقط). الوصول مقصور على المالك والمدير والمالية.",
            en: "Client invoices and estimates from Zoho Books will appear here once the (server-side only) integration is enabled. Access is limited to owner, manager, and finance.",
          })}
        </p>
      </div>
    </div>
  );
}

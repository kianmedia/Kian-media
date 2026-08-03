"use client";
// /client-portal/rentals — بوابة تأجير المعدات والتأمين.
//   المالك/الأدمن/المدير/المالية/أمين العهدة → لوحة إدارة التأجير.
//   العميل/المستأجر                         → تأجيراته فقط (توقيع/طلب إرجاع).
// الإنفاذ الحقيقي = RLS + دوال SECURITY DEFINER + feature flag rental_insurance_enabled.
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import RentalConsole from "@/components/portal/rental/RentalConsole";
import RenterRentalView from "@/components/portal/rental/RenterRentalView";

export default function RentalsPage() {
  const { t } = useI18n();
  const { profile, caps } = usePortal();
  const canManage = caps.isAdminArea || ["custody_officer", "finance", "manager"].includes(profile.staff_role ?? "");

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "تأجير المعدات والتأمين", en: "Equipment Rental & Insurance" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {canManage ? t({ ar: "إدارة تأجير المعدات", en: "Rental Management" }) : t({ ar: "تأجيراتي", en: "My Rentals" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px", lineHeight: 1.7 }}>
          {t({ ar: "من الطلب حتى التسليم والإرجاع والتسوية والإغلاق — بأدلة وتوقيع ومنع تعارض.",
               en: "From request to handover, return, settlement, and close — with evidence, signatures, and conflict prevention." })}
        </p>
      </div>
      {canManage ? <RentalConsole /> : <RenterRentalView />}
    </div>
  );
}

"use client";
// /client-portal/equipment — Equipment Custody & Rental (role-switched, one route):
//   owner/manager (can_manage_custody)   → Admin console + their own custody
//   staff (any staff_role)               → Employee custody (checkout/return)
//   client/lead                          → Renter registration gate + rentals
// UI gating is cosmetic — the real enforcement is RLS + SECURITY DEFINER RPCs.
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import EmployeeCustody from "@/components/portal/custody/EmployeeCustody";
import RenterRentals from "@/components/portal/custody/RenterRentals";
import AdminCustodyConsole from "@/components/portal/custody/AdminCustodyConsole";
import { civGetSettings } from "@/lib/portal/custodyInventory";

export default function EquipmentPage() {
  const { t } = useI18n();
  const { profile, caps } = usePortal();
  const isCustodyAdmin = caps.isAdminArea;                 // owner + manager (mirrors can_manage_custody)
  const isEmployee = !!profile.staff_role || profile.account_type === "admin";
  // إظهار/إخفاء العهدة اليدوية للموظف — يتحكم بها المالك/الأدمن من نظام مخزون الأصول.
  // الافتراضي true (سلوك قديم آمن قبل تشغيل SQL أو عند فشل القراءة). لا يؤثر على الإدارة.
  const [legacyVisible, setLegacyVisible] = useState(true);
  useEffect(() => {
    let alive = true;
    void civGetSettings().then((r) => { if (alive && r.ok) setLegacyVisible(r.data.legacy_custody_employee_visible !== false); });
    return () => { alive = false; };
  }, []);
  const employeeLegacyHidden = isEmployee && !isCustodyAdmin && !legacyVisible;

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "العهدة والتأجير", en: "Custody & Rental" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {isCustodyAdmin
            ? t({ ar: "إدارة عهدة وتأجير المعدات", en: "Equipment Custody & Rental Admin" })
            : isEmployee
              ? t({ ar: "عهدة المعدات", en: "Equipment Custody" })
              : t({ ar: "تأجير المعدات", en: "Equipment Rental" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px", lineHeight: 1.7 }}>
          {t({ ar: "استلام وتسليم المعدات بأدلة موثّقة — صور لكل قطعة، توقيع إلكتروني، وسجل تدقيق كامل.",
               en: "Equipment check-out/check-in with documented evidence — per-item photos, e-signature, full audit trail." })}
        </p>
      </div>

      {isCustodyAdmin ? (
        <div className="space-y-10">
          <AdminCustodyConsole />
          <div className="border-t border-stone-800 pt-6">
            <EmployeeCustody />
          </div>
        </div>
      ) : employeeLegacyHidden ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 text-center">
          <p className="text-stone-300 text-sm">{t({ ar: "العهدة اليدوية غير متاحة حاليًا. استخدم «عهدتي المسجلة».", en: "Manual custody is currently unavailable. Use \"My Registered Custody\"." })}</p>
        </div>
      ) : isEmployee ? (
        <EmployeeCustody />
      ) : (
        <RenterRentals />
      )}
    </div>
  );
}

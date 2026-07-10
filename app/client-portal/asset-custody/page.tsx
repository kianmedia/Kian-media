"use client";
// /client-portal/asset-custody — نظام مخزون الأصول والعهد المسجلة (منفصل عن العهدة اليدوية).
//   المالك/الأدمن/المدير/أمين العهدة → لوحة الإدارة + عهدتي المسجلة
//   الموظف                          → عهدتي المسجلة فقط
//   العميل/العادي                   → ممنوع
// التحكم في الواجهة تجميلي — الإنفاذ الحقيقي = RLS + دوال SECURITY DEFINER.
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import CustodyInventoryConsole from "@/components/portal/custody-inventory/CustodyInventoryConsole";
import MyRegisteredCustody from "@/components/portal/custody-inventory/MyRegisteredCustody";

export default function AssetCustodyPage() {
  const { t } = useI18n();
  const { profile, caps } = usePortal();
  const canManage = caps.isAdminArea || profile.staff_role === "custody_officer";  // owner/super_admin/admin/manager/custody_officer
  const isEmployee = !!profile.staff_role || profile.account_type === "admin";

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "مخزون الأصول والعهد", en: "Asset Inventory & Custody" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {canManage ? t({ ar: "مخزون الأصول والعهد المسجلة", en: "Registered Asset Inventory & Custody" }) : t({ ar: "عهدتي المسجلة", en: "My Registered Custody" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px", lineHeight: 1.7 }}>
          {t({ ar: "المعدات والأصول المسجلة رسميًا في مخزون كيان والمسندة للموظف — بأدلة صور لكل قطعة وسجل حركة كامل.",
               en: "Equipment officially registered in Kian's inventory and assigned to employees — per-item photo evidence and full movement log." })}
        </p>
      </div>

      {canManage ? (
        <div className="space-y-10">
          <CustodyInventoryConsole />
          <div className="border-t border-stone-800 pt-6">
            <h2 className="text-sm font-medium text-stone-400 mb-4">{t({ ar: "عهدتي المسجلة", en: "My registered custody" })}</h2>
            <MyRegisteredCustody />
          </div>
        </div>
      ) : isEmployee ? (
        <MyRegisteredCustody />
      ) : (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 text-center">
          <p className="text-stone-300 text-sm">{t({ ar: "هذا النظام متاح لموظفي كيان فقط.", en: "This system is for Kian staff only." })}</p>
        </div>
      )}
    </div>
  );
}

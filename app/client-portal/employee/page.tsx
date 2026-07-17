"use client";
// /client-portal/employee — بوابة الموظف / الموارد البشرية (حسب الدور):
//   owner/manager/hr (can_manage_hr) → لوحة HR + بوابته كموظف
//   owner/manager                    → + إدارة المهن والصلاحيات (§5)
//   أي موظف (staff_role)             → بوابته + لوحة مهامه في المشاريع (§5)
//   عميل/زائر                        → ممنوع نهائياً (بطاقة رفض)
// حماية الواجهة تجميلية — الفرض الحقيقي في RLS + الدوال المحمية (SECURITY DEFINER).
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import EmployeeHome from "@/components/portal/hr/EmployeeHome";
import HrAdminConsole from "@/components/portal/hr/HrAdminConsole";
import EmployeeDashboard from "@/components/portal/EmployeeDashboard";
import AdminProfessions from "@/components/portal/AdminProfessions";

type Tab = "hr" | "me" | "work" | "professions";

export default function EmployeePortalPage() {
  const { t } = useI18n();
  const { profile, caps } = usePortal();
  const isHrAdmin = caps.isOwner || caps.view === "manager" || caps.view === "hr";
  const canManageProfessions = caps.isOwner || caps.view === "manager";
  const isEmployee = !!profile.staff_role || profile.account_type === "admin";
  const [tab, setTab] = useState<Tab>(isHrAdmin ? "hr" : "me");

  if (!isEmployee && !isHrAdmin) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>
          {t({ ar: "هذه الصفحة مخصصة لموظفي كيان فقط.", en: "This page is for Kian staff only." })}
        </p>
      </div>
    );
  }

  const tabs: { key: Tab; ar: string; en: string }[] = [
    ...(isHrAdmin ? [{ key: "hr" as Tab, ar: "لوحة الموارد البشرية", en: "HR Console" }] : []),
    { key: "me", ar: "بوابتي كموظف", en: "My employee view" },
    { key: "work", ar: "مهامي في المشاريع", en: "My Project Work" },
    ...(canManageProfessions ? [{ key: "professions" as Tab, ar: "المهن والصلاحيات", en: "Professions & Permissions" }] : []),
  ];

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{isHrAdmin ? t({ ar: "الموارد البشرية", en: "Human Resources" }) : t({ ar: "بوابة الموظف", en: "Employee Portal" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {isHrAdmin
            ? t({ ar: "الموارد البشرية وبوابة الموظفين", en: "HR & Employee Portal" })
            : t({ ar: "بوابة الموظف", en: "Employee Portal" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px", lineHeight: 1.7 }}>
          {t({ ar: "الحضور، المهام، جلسات التصوير، والعهد — منظّمة حسب مهنتك وصلاحياتك.",
               en: "Attendance, tasks, shoots and custody — scoped to your profession and permissions." })}
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-5">
        {tabs.map((tb) => (
          <button key={tb.key} type="button" onClick={() => setTab(tb.key)}
            className={`rounded-lg px-4 py-2 text-xs font-medium border ${tab === tb.key ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"}`}>
            {t(tb)}
          </button>
        ))}
      </div>

      {tab === "hr" && isHrAdmin && <HrAdminConsole />}
      {tab === "me" && <EmployeeHome />}
      {tab === "work" && <EmployeeDashboard />}
      {tab === "professions" && canManageProfessions && <AdminProfessions />}
    </div>
  );
}

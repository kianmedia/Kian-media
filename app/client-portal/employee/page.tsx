"use client";
// /client-portal/employee — بوابة الموظف / الموارد البشرية (حسب الدور):
//   owner/manager/hr (can_manage_hr) → لوحة HR + إمكانية التبديل لبوابته كموظف
//   أي موظف (staff_role)             → بوابة الموظف
//   عميل/زائر                        → ممنوع نهائياً (بطاقة رفض)
// حماية الواجهة تجميلية — الفرض الحقيقي في RLS + الدوال المحمية.
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import EmployeeHome from "@/components/portal/hr/EmployeeHome";
import HrAdminConsole from "@/components/portal/hr/HrAdminConsole";

export default function EmployeePortalPage() {
  const { t } = useI18n();
  const { profile, caps } = usePortal();
  const isHrAdmin = caps.isOwner || caps.view === "manager" || caps.view === "hr";
  const isEmployee = !!profile.staff_role || profile.account_type === "admin";
  const [view, setView] = useState<"hr" | "me">("hr");

  if (!isEmployee && !isHrAdmin) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>
          {t({ ar: "هذه الصفحة مخصصة لموظفي كيان فقط.", en: "This page is for Kian staff only." })}
        </p>
      </div>
    );
  }

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
          {t({ ar: "الحضور والانصراف، المهام الميدانية، الإجازات، وملف الموظف — بموقع يُؤخذ عند الضغط فقط، بلا تتبع مستمر.",
               en: "Attendance, field tasks, leaves, and the employee file — location captured only on explicit actions, never tracked continuously." })}
        </p>
      </div>

      {isHrAdmin ? (
        <div className="space-y-4">
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setView("hr")}
              className={`rounded-lg px-4 py-2 text-xs font-medium border ${view === "hr" ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"}`}>
              {t({ ar: "لوحة الموارد البشرية", en: "HR Console" })}
            </button>
            <button type="button" onClick={() => setView("me")}
              className={`rounded-lg px-4 py-2 text-xs font-medium border ${view === "me" ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"}`}>
              {t({ ar: "بوابتي كموظف", en: "My employee view" })}
            </button>
          </div>
          {view === "hr" ? <HrAdminConsole /> : <EmployeeHome />}
        </div>
      ) : (
        <EmployeeHome />
      )}
    </div>
  );
}

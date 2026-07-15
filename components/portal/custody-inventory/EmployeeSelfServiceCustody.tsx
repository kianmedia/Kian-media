"use client";
// حساب الموظف في نظام العهدة: تأكيد الاستلام / صرف عهدة / إرجاع العهدة. لا لوحات ولا إدارة.
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import EmployeeCustodyIssue from "./EmployeeCustodyIssue";
import EmployeeCustodyReturn from "./EmployeeCustodyReturn";
import EmployeeCustodyConfirm from "./EmployeeCustodyConfirm";
import { civGetMyAssignments } from "@/lib/portal/custodyInventory";

export default function EmployeeSelfServiceCustody() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"confirm" | "issue" | "return">("confirm");
  const [pendingCount, setPendingCount] = useState(0);

  // عدّاد «بانتظار التأكيد» — يفتح التبويب المناسب تلقائيًا، ويُحدَّث بعد كل تأكيد.
  const refreshPending = useCallback(async (autoTab = false) => {
    const r = await civGetMyAssignments();
    if (!r.ok) return;
    const n = (r.data ?? []).filter((a) => a.status === "pending_employee_confirmation").length;
    setPendingCount(n);
    if (autoTab && n === 0) setTab("return");   // لا شيء للتأكيد → ابدأ من الإرجاع/الصرف
  }, []);
  useEffect(() => { void refreshPending(true); }, [refreshPending]);

  const btn = (on: boolean) => `flex-1 px-4 py-2.5 rounded-lg text-sm font-medium ${on ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`;
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setTab("confirm")} className={btn(tab === "confirm")}>
          {t({ ar: "تأكيد الاستلام", en: "Confirm receipt" })}{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </button>
        <button onClick={() => setTab("issue")} className={btn(tab === "issue")}>{t({ ar: "صرف عهدة", en: "Issue custody" })}</button>
        <button onClick={() => setTab("return")} className={btn(tab === "return")}>{t({ ar: "إرجاع العهدة", en: "Return custody" })}</button>
      </div>
      {tab === "confirm" ? <EmployeeCustodyConfirm onChanged={() => void refreshPending(false)} /> : tab === "issue" ? <EmployeeCustodyIssue /> : <EmployeeCustodyReturn />}
    </div>
  );
}

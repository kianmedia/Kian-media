"use client";
// حساب الموظف في نظام العهدة: تبويبان فقط — صرف عهدة / إرجاع العهدة. لا لوحات ولا إدارة.
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import EmployeeCustodyIssue from "./EmployeeCustodyIssue";
import EmployeeCustodyReturn from "./EmployeeCustodyReturn";

export default function EmployeeSelfServiceCustody() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"issue" | "return">("issue");
  const btn = (on: boolean) => `flex-1 px-4 py-2.5 rounded-lg text-sm font-medium ${on ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`;
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab("issue")} className={btn(tab === "issue")}>{t({ ar: "صرف عهدة", en: "Issue custody" })}</button>
        <button onClick={() => setTab("return")} className={btn(tab === "return")}>{t({ ar: "إرجاع العهدة", en: "Return custody" })}</button>
      </div>
      {tab === "issue" ? <EmployeeCustodyIssue /> : <EmployeeCustodyReturn />}
    </div>
  );
}

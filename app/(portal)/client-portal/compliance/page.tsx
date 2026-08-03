"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/compliance — مركز المورّد والامتثال.
//
// الصفحة تُرسَم دائمًا. التصريح وكشف الميزة يحدثان **داخل** كلّ لوحة، فغياب
// الترحيلة يعرض إشعارًا صادقًا لا شاشة بيضاء — الكود يسبق الـSQL.
//
// التبويبات تُبنى من خريطة القدرات الحقيقية (vcc_access)، لا من تخمين: من لا
// يملك إصدار المنح لا يرى التبويب أصلًا، ومن لا يملك سوى «حالة الطلبات» يرى
// تبويبًا واحدًا يعرض خمسة حقول.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { complianceAccess, VCC_ACCESS_CLOSED, type VccAccess } from "@/lib/portal/compliance";
import { currentUserId } from "@/lib/portal/client";
import { CC, Card, OutcomeView } from "@/components/portal/compliance/ComplianceAtoms";
import CompanyProfilePanel from "@/components/portal/compliance/CompanyProfilePanel";
import ComplianceDocumentsPanel from "@/components/portal/compliance/ComplianceDocumentsPanel";
import SecureGrantsPanel from "@/components/portal/compliance/SecureGrantsPanel";
import VendorRegistrationPanel from "@/components/portal/compliance/VendorRegistrationPanel";

type Tab = "documents" | "company" | "grants" | "registration";

export default function CompliancePage() {
  const [access, setAccess] = useState<VccAccess | null>(null);
  const [gate, setGate] = useState<JSX.Element | null>(null);
  const [tab, setTab] = useState<Tab>("documents");
  const userId = useMemo(() => currentUserId(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await complianceAccess();
      if (cancelled) return;
      if (r.state === "ok") { setAccess(r.data); setGate(null); }
      else { setAccess(VCC_ACCESS_CLOSED); setGate(<OutcomeView state={r.state} message={r.message} what="مركز الامتثال" />); }
    })();
    return () => { cancelled = true; };
  }, []);

  const tabs = useMemo((): Array<{ id: Tab; label: string }> => {
    if (!access) return [];
    const t: Array<{ id: Tab; label: string }> = [];
    if (access.can_view || access.can_view_operational) t.push({ id: "documents", label: "الوثائق والجاهزية" });
    if (access.can_view) t.push({ id: "company", label: "ملفّ الشركة" });
    if (access.can_issue_grants) t.push({ id: "grants", label: "المنح الآمنة" });
    if (access.can_manage_registration || access.can_view_request_status) {
      t.push({ id: "registration", label: "التسجيل كمورّد" });
    }
    return t;
  }, [access]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [tabs, tab]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: "10.5px", letterSpacing: "1.2px", padding: "9px 15px", borderRadius: "3px",
    cursor: "pointer", whiteSpace: "nowrap",
    background: active ? "rgba(227,30,36,0.10)" : "none",
    border: `1px solid ${active ? "rgba(227,30,36,0.35)" : CC.line}`,
    color: active ? CC.text : CC.dim,
  });

  return (
    <div dir="rtl">
      <h2 style={{ fontSize: "15px", letterSpacing: "0.8px", marginBottom: "4px" }}>مركز المورّد والامتثال</h2>
      <p style={{ color: CC.dim, fontSize: "11.5px", lineHeight: 2, marginBottom: "18px" }}>
        وثائق الشركة وتوثيقها · جاهزية الامتثال بقواعد مفسَّرة · منح وصول آمنة تُشارَك يدويًّا ·
        طلبات التسجيل كمورّد بتسليم يدويّ موثَّق. ⛔ لا شيء يُرسَل من هذا المركز.
      </p>

      {gate && <Card>{gate}</Card>}

      {access && !gate && tabs.length === 0 && (
        <Card>
          <OutcomeView state="denied" message="لا تملك أيّ مفتاح يفتح مركز الامتثال." />
        </Card>
      )}

      {tabs.length > 0 && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button key={t.id} className="f-sans" style={tabStyle(tab === t.id)} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {access && !gate && tab === "documents" && (access.can_view || access.can_view_operational) && (
        <ComplianceDocumentsPanel access={access} myUserId={userId} />
      )}
      {access && !gate && tab === "company" && access.can_view && <CompanyProfilePanel access={access} />}
      {access && !gate && tab === "grants" && access.can_issue_grants && <SecureGrantsPanel access={access} />}
      {access && !gate && tab === "registration"
        && (access.can_manage_registration || access.can_view_request_status) && (
        <VendorRegistrationPanel access={access} />
      )}
    </div>
  );
}

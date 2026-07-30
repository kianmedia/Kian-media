"use client";
// ════════════════════════════════════════════════════════════════════════════
// ملفّ الشركة — النصّ والبيانات الوصفية فقط.
//
// ⛔ لا رقم حساب ولا IBAN: لا يوجد لهما عمود في القاعدة أصلًا، وأرقام السجلّ
//    والضريبة مُقنَّعة بقيد يرفض أكثر من أربعة أرقام متتالية. وعدٌ في التوثيق
//    لا يكفي — هذا سلوك مضمون بنيويًّا، ونقوله للمستخدم في الشاشة.
// ملفّا الشركة العربيّ والإنجليزيّ: النصّ هنا، وملفّ الـPDF وثيقة في السجلّ
// الواحد بنوعي company_profile_ar / company_profile_en.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { companyGet, companySet, type CompanyBundle, type VccAccess } from "@/lib/portal/compliance";
import { Btn, CC, Card, EmptyState, Field, OutcomeView } from "./ComplianceAtoms";

const TEXT_FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "legal_name_ar", label: "الاسم النظاميّ (عربيّ)" },
  { key: "legal_name_en", label: "الاسم النظاميّ (إنجليزيّ)" },
  { key: "brand_name", label: "الاسم التجاريّ" },
  { key: "cr_number_masked", label: "رقم السجلّ (مُقنَّع)", hint: "⛔ لا تُدخل الرقم كاملًا — القيد يرفضه." },
  { key: "vat_number_masked", label: "الرقم الضريبيّ (مُقنَّع)", hint: "⛔ مُقنَّع فقط." },
  { key: "hq_city", label: "مدينة المقرّ" },
  { key: "national_address_short", label: "العنوان الوطنيّ المختصر" },
  { key: "website", label: "الموقع" },
  { key: "general_email", label: "البريد العامّ" },
  { key: "general_phone", label: "الهاتف العامّ" },
  { key: "bank_name", label: "اسم المصرف (وصفيّ)", hint: "⛔ لا رقم حساب — لا عمود له في القاعدة." },
  { key: "nitaqat_band", label: "نطاق السعودة" },
  { key: "zatca_status", label: "حالة ZATCA" },
];

const LONG_FIELDS: Array<{ key: string; label: string }> = [
  { key: "about_ar", label: "نبذة الشركة (عربيّ)" },
  { key: "about_en", label: "نبذة الشركة (إنجليزيّ)" },
  { key: "mission_ar", label: "الرسالة (عربيّ)" },
  { key: "mission_en", label: "الرسالة (إنجليزيّ)" },
];

export default function CompanyProfilePanel({ access }: { access: VccAccess }) {
  const [data, setData] = useState<CompanyBundle | null>(null);
  const [err, setErr] = useState<JSX.Element | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<JSX.Element | string>("");

  const load = useCallback(async () => {
    const r = await companyGet();
    if (r.state === "ok") {
      setData(r.data);
      const p = (r.data.profile ?? {}) as Record<string, unknown>;
      const d: Record<string, string> = {};
      for (const f of [...TEXT_FIELDS, ...LONG_FIELDS]) d[f.key] = String(p[f.key] ?? "");
      setDraft(d);
      setErr(null);
    } else {
      setData(null);
      setErr(<OutcomeView state={r.state} message={r.message} what="ملفّ الشركة" />);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    setBusy(true); setNotice("");
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) if (v.trim() !== "") payload[k] = v;
    const r = await companySet(payload);
    setBusy(false);
    if (r.state !== "ok") { setNotice(<OutcomeView state={r.state} message={r.message} what="حفظ الملفّ" />); return; }
    setNotice("حُفظ ملفّ الشركة.");
    await load();
  }, [draft, load]);

  if (err) return <Card title="ملفّ الشركة">{err}</Card>;
  if (!data) return <Card title="ملفّ الشركة"><EmptyState text="جارٍ التحميل…" /></Card>;

  const ro = !access.can_manage_documents;

  return (
    <>
      {notice && <div style={{ marginBottom: "14px", fontSize: "12.5px", lineHeight: 2 }}>{notice}</div>}
      <Card
        title="بيانات الشركة"
        note={ro ? "عرض فقط — التعديل يتطلّب مفتاح إدارة وثائق الامتثال."
                 : "⛔ لا يُخزَّن رقم حساب ولا IBAN ولا رقم سجلّ كامل: القاعدة ترفضها بقيود، لا بوعد."}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: "0 14px" }}>
          {TEXT_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              hint={f.hint}
              value={draft[f.key] ?? ""}
              onChange={(v) => !ro && setDraft({ ...draft, [f.key]: v })}
            />
          ))}
        </div>
        {LONG_FIELDS.map((f) => (
          <label key={f.key} style={{ display: "block", marginBottom: "10px" }}>
            <span style={{ display: "block", color: CC.dim, fontSize: "11px", marginBottom: "4px" }}>{f.label}</span>
            <textarea
              value={draft[f.key] ?? ""}
              readOnly={ro}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              style={{
                width: "100%", minHeight: "70px", border: `1px solid ${CC.line}`,
                background: "rgba(0,0,0,0.25)", color: CC.text, borderRadius: "4px",
                padding: "8px 10px", fontSize: "12.5px", lineHeight: 1.9,
              }}
            />
          </label>
        ))}
        {!ro && <Btn onClick={save} disabled={busy} tone="primary">حفظ</Btn>}
      </Card>

      <Card title="جهات الاتصال">
        {data.contacts.length === 0
          ? <EmptyState text="لا جهات اتصال مسجَّلة." why="مسؤول المشتريات متطلَّب إلزاميّ في الجاهزية." />
          : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "12.5px", lineHeight: 2 }}>
              {data.contacts.map((c, i) => (
                <li key={i}>
                  {String(c.full_name)} — {String(c.role_title ?? "")}
                  <span style={{ color: CC.dim, fontSize: "11px" }}> · {String(c.purpose)}</span>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card title="الشهادات">
        {data.certifications.length === 0
          ? <EmptyState text="لا شهادات مسجَّلة." />
          : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "12.5px", lineHeight: 2 }}>
              {data.certifications.map((c, i) => (
                <li key={i}>
                  {String(c.cert_name_ar)}
                  <span style={{ color: CC.dim, fontSize: "11px" }}> · {String(c.issuing_body ?? "—")}</span>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card title="الخبرة القطاعية">
        {data.experience.length === 0
          ? <EmptyState text="لا خبرات مسجَّلة." />
          : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "12.5px", lineHeight: 2 }}>
              {data.experience.map((e, i) => (
                <li key={i}>
                  {String(e.sector_ar ?? e.sector)}
                  <span style={{ color: CC.dim, fontSize: "11px" }}> · {String(e.years ?? "—")} سنة</span>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card title="قدرة الدرون" note="التصاريح والرخص وثائق في السجلّ الواحد — سريانها يُقرأ من هناك لا من هنا.">
        {data.drone.length === 0
          ? <EmptyState text="لا قدرة درون مسجَّلة." />
          : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "12.5px", lineHeight: 2 }}>
              {data.drone.map((d, i) => (
                <li key={i}>
                  {String(d.capability_name)}
                  <span style={{ color: CC.dim, fontSize: "11px" }}>
                    {" "}· طيّارون {String(d.licensed_pilots ?? "—")} · وحدات {String(d.registered_units ?? "—")}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card title="المراجع" note="بيانات تواصل المراجع بيانات شخصية لطرف ثالث — لا تظهر إلّا لمن يملك رؤية المقيَّد.">
        {data.references.length === 0
          ? <EmptyState text="لا مراجع مسجَّلة." why="قد توجد مراجع لا تملك صلاحية رؤيتها." />
          : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "12.5px", lineHeight: 2 }}>
              {data.references.map((r, i) => (
                <li key={i}>
                  {String(r.client_name)}
                  <span style={{ color: CC.dim, fontSize: "11px" }}>
                    {" "}· {r.permission_to_cite ? "مأذون بالاستشهاد" : "⚠️ بلا إذن استشهاد"}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </>
  );
}

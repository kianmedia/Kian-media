"use client";
// ════════════════════════════════════════════════════════════════════════
// Billing details modal shown BEFORE a quote is accepted. The client picks
// Individual / Business, fills the e-invoice data, and submits. The parent's
// onAccepted runs only when the server saved the profile, updated the Zoho
// contact, and marked the quote accepted. On failure the form data is kept.
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { acceptQuoteWithBilling, type BillingInput } from "@/lib/portal/billing";

const FAIL: Record<string, { ar: string; en: string }> = {
  individual_name_required:   { ar: "الاسم الكامل مطلوب.", en: "Full name is required." },
  individual_contact_required:{ ar: "أدخل البريد الإلكتروني أو رقم الجوال.", en: "Enter an email or a phone number." },
  business_legal_name_required:{ ar: "اسم المنشأة مطلوب.", en: "Business legal name is required." },
  business_vat_required:      { ar: "الرقم الضريبي مطلوب للمنشآت.", en: "VAT number is required for a business." },
  business_address_required:  { ar: "العنوان الوطني الكامل مطلوب (رقم المبنى، الشارع، الحي، المدينة، الرمز البريدي).", en: "Full national address is required." },
  not_owner:                  { ar: "هذا العرض غير مرتبط بحسابك الحالي.", en: "This quote isn't linked to your account." },
  not_authenticated:          { ar: "انتهت الجلسة أو لم يتم التعرف على حسابك. سجّل الدخول مرة أخرى ثم حاول.", en: "Session expired or your account wasn't recognized. Sign in again and retry." },
  no_client_context:          { ar: "تعذّر تجهيز حسابك للفوترة. حدّث الصفحة وحاول مجددًا، وإن استمرّت المشكلة تواصل مع فريق كيان.", en: "Couldn't prepare your billing account. Refresh and retry." },
  not_authorized:             { ar: "غير مصرّح لك بهذا الإجراء.", en: "Not authorized." },
  not_configured:             { ar: "إعدادات Zoho غير مكتملة — لم يتم اعتماد العرض. تواصل مع فريق كيان.", en: "Zoho isn't configured — the quote was not accepted." },
  zoho_scope:                 { ar: "صلاحيات Zoho غير كافية لتحديث بيانات العميل. لم يتم اعتماد العرض.", en: "Zoho permissions are insufficient. Quote not accepted." },
  zoho_failed:                { ar: "تعذّر تحديث بيانات العميل في Zoho — لم يتم اعتماد العرض. حاول مرة أخرى.", en: "Couldn't update the Zoho customer. Quote not accepted." },
  accept_failed:              { ar: "حُفظت بياناتك لكن تعذّر اعتماد العرض. أعد المحاولة (لن تتكرر بياناتك).", en: "Your details were saved but acceptance failed. Retry safely." },
  network:                    { ar: "تعذّر الاتصال. تحقّق من الإنترنت وحاول مجددًا.", en: "Network error — check your connection." },
};

export default function BillingModal({
  quoteNumber, quoteId, onClose, onAccepted,
}: { quoteNumber: string; quoteId: string; onClose: () => void; onAccepted: () => void }) {
  const { t, isAr } = useI18n();
  const [type, setType] = useState<"individual" | "business">("individual");
  const [f, setF] = useState<Record<string, string>>({ country: "Saudi Arabia" });
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  function clientValidate(): string | null {
    if (type === "individual") {
      if (!(f.full_name || "").trim()) return "individual_name_required";
      if (!(f.email || "").trim() && !(f.phone || "").trim()) return "individual_contact_required";
    } else {
      if (!(f.legal_name || "").trim()) return "business_legal_name_required";
      if (!(f.vat_number || "").trim()) return "business_vat_required";
      if (!["building_number", "street", "district", "city", "postal_code"].every((k) => (f[k] || "").trim())) return "business_address_required";
    }
    return null;
  }

  async function submit() {
    setErrMsg(null);
    const v = clientValidate();
    if (v) { const m = FAIL[v]; setErrMsg(m ? t(m) : v); return; }
    const input: BillingInput = {
      customerType: type,
      fullName: f.full_name, email: f.email, phone: f.phone, city: f.city, country: f.country || "Saudi Arabia", notes: f.notes,
      legalName: f.legal_name, contactPerson: f.contact_person, vatNumber: f.vat_number, crNumber: f.cr_number,
      poReference: f.po_reference, financeEmail: f.finance_email,
      buildingNumber: f.building_number, street: f.street, district: f.district, postalCode: f.postal_code, additionalNumber: f.additional_number,
    };
    setBusy(true);
    const r = await acceptQuoteWithBilling(quoteId, input);
    setBusy(false);
    if (r.ok) { onAccepted(); return; }
    const m = r.code ? FAIL[r.code] : undefined;
    setErrMsg(m ? t(m) : (isAr ? "تعذّر إتمام العملية. حاول مجددًا." : "Couldn't complete. Try again.") + (r.reason ? ` (${r.reason})` : ""));
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 7, padding: "9px 11px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginBottom: 5 };
  // Plain render-function (NOT a nested component) so inputs don't remount / lose focus on each keystroke.
  const field = (k: string, label: string, opts?: { req?: boolean; type?: string }) => (
    <div>
      <label style={lbl}>{label}{opts?.req ? <span style={{ color: "#ff6b6e" }}> *</span> : null}</label>
      <input value={f[k] || ""} onChange={set(k)} type={opts?.type || "text"} dir={opts?.type === "email" || opts?.type === "tel" ? "ltr" : undefined} style={inp} />
    </div>
  );
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} dir={isAr ? "rtl" : "ltr"} style={{ background: "#0d0d0f", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, padding: "22px 22px 24px", width: "100%", maxWidth: 560, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 className="editorial text-white" style={{ fontSize: 20 }}>{t({ ar: "بيانات الفاتورة الإلكترونية", en: "E-invoice billing details" })}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12.5, margin: "0 0 16px", lineHeight: 1.7 }}>
          {t({ ar: `لإتمام قبول العرض ${quoteNumber} نحتاج بيانات الفوترة لإصدار فاتورة ضريبية نظامية.`, en: `To accept quote ${quoteNumber} we need billing details for a compliant tax invoice.` })}
        </p>

        {/* Type toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["individual", "business"] as const).map((ty) => (
            <button key={ty} onClick={() => setType(ty)} style={{ flex: 1, padding: "10px 12px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: type === ty ? "rgba(37,211,102,0.16)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${type === ty ? "rgba(37,211,102,0.5)" : "rgba(255,255,255,0.12)"}`, color: type === ty ? "#fff" : "rgba(255,255,255,0.6)" }}>
              {ty === "individual" ? t({ ar: "فرد", en: "Individual" }) : t({ ar: "شركة أو مؤسسة", en: "Business" })}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {type === "individual" ? (
            <>
              {field("full_name", t({ ar: "الاسم الكامل", en: "Full name" }), { req: true })}
              <div style={grid2}>
                {field("email", t({ ar: "البريد الإلكتروني", en: "Email" }), { type: "email" })}
                {field("phone", t({ ar: "الجوال", en: "Phone" }), { type: "tel" })}
              </div>
              <div style={grid2}>
                {field("city", t({ ar: "المدينة", en: "City" }))}
                {field("country", t({ ar: "الدولة", en: "Country" }))}
              </div>
              <div>
                <label style={lbl}>{t({ ar: "ملاحظات (اختياري)", en: "Notes (optional)" })}</label>
                <textarea value={f.notes || ""} onChange={set("notes")} rows={2} style={inp} />
              </div>
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11.5, margin: 0 }}>
                {t({ ar: "لا يلزم الرقم الضريبي للأفراد.", en: "VAT number isn't required for individuals." })}
              </p>
            </>
          ) : (
            <>
              {field("legal_name", t({ ar: "اسم المنشأة (القانوني)", en: "Business legal name" }), { req: true })}
              <div style={grid2}>
                {field("contact_person", t({ ar: "اسم المسؤول", en: "Contact person" }))}
                {field("phone", t({ ar: "الجوال", en: "Phone" }), { type: "tel" })}
              </div>
              <div style={grid2}>
                {field("email", t({ ar: "البريد", en: "Email" }), { type: "email" })}
                {field("finance_email", t({ ar: "بريد المالية (اختياري)", en: "Finance email (optional)" }), { type: "email" })}
              </div>
              <div style={grid2}>
                {field("vat_number", t({ ar: "الرقم الضريبي", en: "VAT number" }), { req: true })}
                {field("cr_number", t({ ar: "السجل التجاري", en: "CR number" }))}
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>{t({ ar: "العنوان الوطني", en: "National address" })}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={grid2}>
                    {field("building_number", t({ ar: "رقم المبنى", en: "Building no." }), { req: true })}
                    {field("street", t({ ar: "اسم الشارع", en: "Street" }), { req: true })}
                  </div>
                  <div style={grid2}>
                    {field("district", t({ ar: "الحي", en: "District" }), { req: true })}
                    {field("city", t({ ar: "المدينة", en: "City" }), { req: true })}
                  </div>
                  <div style={grid2}>
                    {field("postal_code", t({ ar: "الرمز البريدي", en: "Postal code" }), { req: true })}
                    {field("additional_number", t({ ar: "الرقم الإضافي (اختياري)", en: "Additional no. (optional)" }))}
                  </div>
                  <div style={grid2}>
                    {field("country", t({ ar: "الدولة", en: "Country" }))}
                    {field("po_reference", t({ ar: "رقم أمر الشراء (اختياري)", en: "PO reference (optional)" }))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {errMsg && <div style={{ marginTop: 14, padding: "11px 13px", fontSize: 12.5, color: "#ff9ea1", background: "rgba(227,30,36,0.09)", border: "1px solid rgba(227,30,36,0.32)", borderRadius: 8, lineHeight: 1.7 }}>{errMsg}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={submit} disabled={busy} style={{ flex: 1, padding: "11px 14px", borderRadius: 9, border: "none", cursor: busy ? "wait" : "pointer", background: "#25D366", color: "#fff", fontWeight: 700, fontSize: 13.5, opacity: busy ? 0.6 : 1 }}>
            {busy ? t({ ar: "جارٍ الحفظ والاعتماد…", en: "Saving & accepting…" }) : t({ ar: "حفظ واعتماد العرض", en: "Save & accept quote" })}
          </button>
          <button onClick={onClose} disabled={busy} style={{ padding: "11px 16px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.16)", cursor: "pointer", background: "transparent", color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
            {t({ ar: "إلغاء", en: "Cancel" })}
          </button>
        </div>
      </div>
    </div>
  );
}

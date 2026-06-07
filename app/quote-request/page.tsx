"use client";
import { useState } from "react";
import FormShell from "@/components/forms/FormShell";
import { Label, TextField, TextArea, SelectField, CheckField } from "@/components/forms/Field";
import { submitToSheets } from "@/lib/submitForm";
import { useI18n } from "@/lib/i18n";

const SERVICES = [
  { value: "Corporate Video Production", ar: "إنتاج فيديوهات الشركات" },
  { value: "Event Coverage", ar: "تغطية الفعاليات" },
  { value: "Photography", ar: "التصوير الفوتوغرافي" },
  { value: "Drone Services", ar: "خدمات الدرون" },
  { value: "Live Streaming", ar: "البث المباشر" },
  { value: "Podcast Production", ar: "إنتاج البودكاست" },
  { value: "Wedding Coverage", ar: "تغطية الأعراس" },
  { value: "Real Estate Media", ar: "التصوير العقاري" },
  { value: "Social Media Content", ar: "محتوى السوشيال ميديا" },
  { value: "Motion Graphics", ar: "موشن جرافيك" },
  { value: "Voice Over", ar: "التعليق الصوتي" },
];

const BUDGETS = [
  { value: "Under 10,000 SAR", ar: "أقل من ١٠٬٠٠٠ ريال" },
  { value: "10,000 - 25,000 SAR", ar: "١٠٬٠٠٠ - ٢٥٬٠٠٠ ريال" },
  { value: "25,000 - 50,000 SAR", ar: "٢٥٬٠٠٠ - ٥٠٬٠٠٠ ريال" },
  { value: "50,000 - 100,000 SAR", ar: "٥٠٬٠٠٠ - ١٠٠٬٠٠٠ ريال" },
  { value: "Above 100,000 SAR", ar: "أكثر من ١٠٠٬٠٠٠ ريال" },
];

function Form() {
  const { t, isAr } = useI18n();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const [f, setF] = useState({
    "Full Name": "", "Company": "", "Mobile": "", "Email": "", "City": "",
    "Service Type": "", "Shooting Days": "", "Crew": "",
    "Description": "", "Budget": "", "Delivery Date": "",
  });
  const [opts, setOpts] = useState({ Drone: false, Editing: false, "Voice Over": false, "Motion Graphics": false });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f["Full Name"] || !f["Mobile"]) {
      alert(isAr ? "الرجاء تعبئة الاسم ورقم الجوال على الأقل" : "Please fill at least name and mobile");
      return;
    }
    setSending(true);
    await submitToSheets("quote", {
      ...f,
      Drone: opts.Drone ? "Yes" : "No",
      Editing: opts.Editing ? "Yes" : "No",
      "Voice Over": opts["Voice Over"] ? "Yes" : "No",
      "Motion Graphics": opts["Motion Graphics"] ? "Yes" : "No",
    });
    setSending(false);
    setSent(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (sent) return <SuccessCard />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <Row>
        <div><Label htmlFor="fn" required>{t({ ar: "الاسم الكامل", en: "Full Name" })}</Label><TextField id="fn" value={f["Full Name"]} onChange={(v) => set("Full Name", v)} required /></div>
        <div><Label htmlFor="co">{t({ ar: "اسم الشركة", en: "Company Name" })}</Label><TextField id="co" value={f["Company"]} onChange={(v) => set("Company", v)} /></div>
      </Row>
      <Row>
        <div><Label htmlFor="mo" required>{t({ ar: "رقم الجوال", en: "Mobile Number" })}</Label><TextField id="mo" type="tel" dir="ltr" value={f["Mobile"]} onChange={(v) => set("Mobile", v)} required /></div>
        <div><Label htmlFor="em">{t({ ar: "البريد الإلكتروني", en: "Email" })}</Label><TextField id="em" type="email" dir="ltr" value={f["Email"]} onChange={(v) => set("Email", v)} /></div>
      </Row>
      <div><Label htmlFor="ci">{t({ ar: "المدينة", en: "City" })}</Label><TextField id="ci" value={f["City"]} onChange={(v) => set("City", v)} /></div>
      <div><Label htmlFor="sv" required>{t({ ar: "نوع الخدمة", en: "Service Type" })}</Label>
        <SelectField id="sv" value={f["Service Type"]} onChange={(v) => set("Service Type", v)} options={SERVICES.map((s) => ({ value: s.value, label: isAr ? s.ar : s.value }))} required /></div>
      <Row>
        <div><Label htmlFor="sd">{t({ ar: "عدد أيام التصوير", en: "Shooting Days" })}</Label><TextField id="sd" type="number" value={f["Shooting Days"]} onChange={(v) => set("Shooting Days", v)} /></div>
        <div><Label htmlFor="cr">{t({ ar: "عدد أفراد الطاقم", en: "Crew Members" })}</Label><TextField id="cr" type="number" value={f["Crew"]} onChange={(v) => set("Crew", v)} /></div>
      </Row>
      <div>
        <Label>{t({ ar: "خيارات إضافية", en: "Additional Options" })}</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <CheckField id="dr" checked={opts.Drone} onChange={(v) => setOpts((p) => ({ ...p, Drone: v }))} label={t({ ar: "تصوير بالدرون", en: "Drone Required" })} />
          <CheckField id="ed" checked={opts.Editing} onChange={(v) => setOpts((p) => ({ ...p, Editing: v }))} label={t({ ar: "مونتاج", en: "Editing Required" })} />
          <CheckField id="vo" checked={opts["Voice Over"]} onChange={(v) => setOpts((p) => ({ ...p, "Voice Over": v }))} label={t({ ar: "تعليق صوتي", en: "Voice Over" })} />
          <CheckField id="mg" checked={opts["Motion Graphics"]} onChange={(v) => setOpts((p) => ({ ...p, "Motion Graphics": v }))} label={t({ ar: "موشن جرافيك", en: "Motion Graphics" })} />
        </div>
      </div>
      <div><Label htmlFor="bd">{t({ ar: "نطاق الميزانية", en: "Budget Range" })}</Label>
        <SelectField id="bd" value={f["Budget"]} onChange={(v) => set("Budget", v)} options={BUDGETS.map((b) => ({ value: b.value, label: isAr ? b.ar : b.value }))} /></div>
      <div><Label htmlFor="dd">{t({ ar: "تاريخ التسليم المتوقع", en: "Expected Delivery Date" })}</Label><TextField id="dd" type="date" dir="ltr" value={f["Delivery Date"]} onChange={(v) => set("Delivery Date", v)} /></div>
      <div><Label htmlFor="de">{t({ ar: "وصف المشروع", en: "Project Description" })}</Label><TextArea id="de" value={f["Description"]} onChange={(v) => set("Description", v)} rows={5} /></div>

      <SubmitButton sending={sending} onClick={submit} label={t({ ar: "إرسال الطلب", en: "Submit Request" })} />
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }} className="form-row">{children}</div>;
}

function SubmitButton({ sending, onClick, label }: { sending: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} disabled={sending} className="btn-red" style={{ width: "100%", justifyContent: "center", marginTop: "8px", opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
      <span>{sending ? "..." : label}</span>
    </button>
  );
}

function SuccessCard() {
  const { t } = useI18n();
  return (
    <div className="text-center" style={{ padding: "50px 30px", background: "rgba(227,30,36,0.05)", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "4px" }}>
      <div style={{ width: "64px", height: "64px", margin: "0 auto 24px", borderRadius: "50%", background: "rgba(227,30,36,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#E31E24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </div>
      <h3 className="editorial text-white" style={{ fontSize: "24px", marginBottom: "12px" }}>{t({ ar: "شكراً لك", en: "Thank You" })}</h3>
      <p className="text-white/60" style={{ fontSize: "15px", lineHeight: 1.8, maxWidth: "420px", margin: "0 auto" }}>
        {t({ ar: "تم استلام طلبك بنجاح. سيتواصل معك فريقنا في أقرب وقت ممكن.", en: "Your request has been received successfully. Our team will contact you as soon as possible." })}
      </p>
    </div>
  );
}

export default function QuoteRequestPage() {
  return (
    <FormShell
      eyebrow={{ ar: "طلب عرض سعر", en: "Quote Request" }}
      title={{ ar: "احصل على عرض سعر مخصص", en: "Get a Tailored Quote" }}
      subtitle={{ ar: "أخبرنا عن مشروعك وسنعدّ لك عرضاً يناسب احتياجاتك.", en: "Tell us about your project and we'll prepare a proposal that fits your needs." }}
    >
      <Form />
    </FormShell>
  );
}

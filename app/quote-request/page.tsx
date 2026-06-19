"use client";
import { useState } from "react";
import FormShell from "@/components/forms/FormShell";
import { Label, TextField, TextArea, SelectField, CheckField } from "@/components/forms/Field";
import { submitToSheets, makeRef, isValidEmail, isValidMobile } from "@/lib/submitForm";
import SuccessCard from "@/components/forms/SuccessCard";
import { useI18n } from "@/lib/i18n";

// Full Kian Media services — value is the canonical EN; ar is the Arabic label.
const SERVICES = [
  { en: "Corporate Films", ar: "إنتاج أفلام الشركات" },
  { en: "Documentary Films", ar: "الأفلام الوثائقية" },
  { en: "Events & Conferences Coverage", ar: "تغطية الفعاليات والمؤتمرات" },
  { en: "Live Streaming", ar: "البث المباشر" },
  { en: "Photography", ar: "التصوير الفوتوغرافي" },
  { en: "Real Estate Media", ar: "التصوير العقاري" },
  { en: "Industrial Projects Filming", ar: "تصوير المشاريع الصناعية" },
  { en: "Government Projects Filming", ar: "تصوير المشاريع الحكومية" },
  { en: "Drone Filming", ar: "تصوير الدرون" },
  { en: "Podcast Production", ar: "إنتاج البودكاست" },
  { en: "Motion Graphics", ar: "الموشن جرافيك" },
  { en: "Voice Over", ar: "التعليق الصوتي" },
  { en: "Video Editing", ar: "المونتاج" },
  { en: "Digital Content Management", ar: "إدارة المحتوى الرقمي" },
  { en: "Short Reels", ar: "صناعة الريلز القصيرة" },
  { en: "Exhibitions Coverage", ar: "تغطية المعارض" },
  { en: "Wedding Coverage", ar: "تغطية الأعراس" },
  { en: "Commercial & Advertising", ar: "التصوير التجاري والإعلاني" },
  { en: "Product Photography", ar: "تصوير المنتجات" },
  { en: "CGI & VFX", ar: "خدمات CGI و VFX" },
  { en: "Scriptwriting", ar: "كتابة السيناريو" },
  { en: "Storyboard", ar: "الستوري بورد" },
  { en: "Social Media Management", ar: "إدارة منصات التواصل الاجتماعي" },
  { en: "Other", ar: "أخرى" },
];

const BUDGETS = [
  { en: "Under 10,000 SAR", ar: "أقل من ١٠٬٠٠٠ ريال" },
  { en: "10,000 - 25,000 SAR", ar: "١٠٬٠٠٠ - ٢٥٬٠٠٠ ريال" },
  { en: "25,000 - 50,000 SAR", ar: "٢٥٬٠٠٠ - ٥٠٬٠٠٠ ريال" },
  { en: "50,000 - 100,000 SAR", ar: "٥٠٬٠٠٠ - ١٠٠٬٠٠٠ ريال" },
  { en: "Above 100,000 SAR", ar: "أكثر من ١٠٠٬٠٠٠ ريال" },
];

const LEAD_SOURCES = [
  { en: "Google", ar: "جوجل" },
  { en: "Instagram", ar: "إنستقرام" },
  { en: "LinkedIn", ar: "لينكدإن" },
  { en: "TikTok", ar: "تيك توك" },
  { en: "Snapchat", ar: "سناب شات" },
  { en: "WhatsApp", ar: "واتساب" },
  { en: "Referral", ar: "توصية" },
  { en: "Existing Client", ar: "عميل حالي" },
  { en: "Other", ar: "أخرى" },
];

const PRIORITIES = [
  { en: "Urgent (24 Hours)", ar: "عاجل (٢٤ ساعة)" },
  { en: "Within One Week", ar: "خلال أسبوع" },
  { en: "Within One Month", ar: "خلال شهر" },
  { en: "Flexible", ar: "مرن" },
];

function Form() {
  const { t, isAr } = useI18n();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState("");

  const [f, setF] = useState({
    "Full Name": "", "Company": "", "Mobile": "", "Email": "", "City": "",
    "Shooting Days": "", "Crew": "", "Description": "", "Budget": "", "Delivery Date": "", "Other Service": "",
    "Lead Source": "", "Priority": "",
  });
  const [services, setServices] = useState<string[]>([]); // selected service EN values
  const [opts, setOpts] = useState({ Drone: false, Editing: false, "Voice Over": false, "Motion Graphics": false });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const toggleService = (en: string) => {
    setServices((prev) => prev.includes(en) ? prev.filter((s) => s !== en) : [...prev, en]);
  };

  // Language-aware yes/no
  const yn = (b: boolean) => (isAr ? (b ? "نعم" : "لا") : (b ? "Yes" : "No"));

  async function submit() {
    if (!f["Full Name"] || !f["Mobile"]) {
      alert(isAr ? "الرجاء تعبئة الاسم ورقم الجوال على الأقل" : "Please fill at least name and mobile");
      return;
    }
    if (services.length === 0) {
      alert(isAr ? "الرجاء اختيار خدمة واحدة على الأقل" : "Please select at least one service");
      return;
    }
    if (!isValidMobile(f["Mobile"])) {
      alert(isAr ? "رقم الجوال غير صحيح" : "Invalid mobile number");
      return;
    }
    if (f["Email"] && !isValidEmail(f["Email"])) {
      alert(isAr ? "البريد الإلكتروني غير صحيح" : "Invalid email address");
      return;
    }
    setSending(true);
    const ref = makeRef("quote");

    // Build language-aware service list string
    const serviceLabels = services.map((en) => {
      const svc = SERVICES.find((s) => s.en === en);
      return isAr ? (svc?.ar ?? en) : en;
    }).join(isAr ? "، " : ", ");

    // Budget language-aware
    const budgetObj = BUDGETS.find((b) => b.en === f["Budget"]);
    const budgetLabel = f["Budget"] ? (isAr ? (budgetObj?.ar ?? f["Budget"]) : f["Budget"]) : "";
    const lsObj = LEAD_SOURCES.find((l) => l.en === f["Lead Source"]);
    const leadLabel = f["Lead Source"] ? (isAr ? (lsObj?.ar ?? f["Lead Source"]) : f["Lead Source"]) : "";
    const prObj = PRIORITIES.find((p) => p.en === f["Priority"]);
    const priorityLabel = f["Priority"] ? (isAr ? (prObj?.ar ?? f["Priority"]) : f["Priority"]) : "";

    await submitToSheets("quote", {
      "Reference": ref,
      "Full Name": f["Full Name"],
      "Company": f["Company"],
      "Mobile": f["Mobile"],
      "Email": f["Email"],
      "City": f["City"],
      "Service Type": serviceLabels + (services.includes("Other") && f["Other Service"] ? `: ${f["Other Service"]}` : ""),
      "Shooting Days": f["Shooting Days"],
      "Crew": f["Crew"],
      "Drone": yn(opts.Drone),
      "Editing": yn(opts.Editing),
      "Voice Over": yn(opts["Voice Over"]),
      "Motion Graphics": yn(opts["Motion Graphics"]),
      "Description": f["Description"],
      "Budget": budgetLabel,
      "Delivery Date": f["Delivery Date"],
      "How did you hear about us": leadLabel,
      "Lead Source": leadLabel,
      "Priority": priorityLabel,
      "Language": isAr ? "AR" : "EN",
    });

    // WhatsApp link-back: ONLY when the form was opened from a conversation
    // (?source=whatsapp&conversation=<id>). Best-effort; never blocks the user.
    try {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get("source") === "whatsapp" && qp.get("conversation")) {
        void fetch("/api/integrations/whatsapp/quote-request", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: qp.get("conversation"),
            full_name: f["Full Name"], phone: f["Mobile"], city: f["City"],
            services, message: f["Description"],
          }),
        }).catch(() => {});
      }
    } catch { /* ignore */ }

    setSending(false);
    setReference(ref);
    setSent(true);
  }

  if (sent) return <SuccessCard reference={reference} />;

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

      {/* Multi-select services */}
      <div>
        <Label required>{t({ ar: "الخدمات المطلوبة", en: "Required Services" })}</Label>
        <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.4)", marginBottom: "10px", marginTop: "-2px" }}>
          {t({ ar: "اختر خدمة واحدة أو أكثر", en: "Select one or more services" })}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }} className="svc-grid">
          {SERVICES.map((s) => {
            const selected = services.includes(s.en);
            return (
              <button key={s.en} type="button" onClick={() => toggleService(s.en)}
                className="f-sans"
                style={{
                  textAlign: isAr ? "right" : "left", padding: "10px 13px", fontSize: "13px", cursor: "pointer",
                  borderRadius: "3px", transition: "all 0.25s",
                  background: selected ? "rgba(227,30,36,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${selected ? "rgba(227,30,36,0.45)" : "rgba(255,255,255,0.1)"}`,
                  color: selected ? "#fff" : "rgba(255,255,255,0.6)",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                <span style={{ width: "15px", height: "15px", flexShrink: 0, borderRadius: "2px", border: `1px solid ${selected ? "#E31E24" : "rgba(255,255,255,0.3)"}`, background: selected ? "#E31E24" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {selected && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M20 6L9 17l-5-5" /></svg>}
                </span>
                {t({ ar: s.ar, en: s.en })}
              </button>
            );
          })}
        </div>
      </div>

      {/* "Other" service description */}
      {services.includes("Other") && (
        <div><Label htmlFor="os">{t({ ar: "اشرح الخدمة المطلوبة", en: "Describe the service" })}</Label><TextField id="os" value={f["Other Service"]} onChange={(v) => set("Other Service", v)} /></div>
      )}

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
        <SelectField id="bd" value={f["Budget"]} onChange={(v) => set("Budget", v)} options={BUDGETS.map((b) => ({ value: b.en, label: isAr ? b.ar : b.en }))} /></div>
      <Row>
        <div><Label htmlFor="pr">{t({ ar: "أولوية المشروع", en: "Project Priority" })}</Label>
          <SelectField id="pr" value={f["Priority"]} onChange={(v) => set("Priority", v)} options={PRIORITIES.map((p) => ({ value: p.en, label: isAr ? p.ar : p.en }))} /></div>
        <div><Label htmlFor="ls">{t({ ar: "كيف تعرفت علينا؟", en: "How did you hear about us?" })}</Label>
          <SelectField id="ls" value={f["Lead Source"]} onChange={(v) => set("Lead Source", v)} options={LEAD_SOURCES.map((l) => ({ value: l.en, label: isAr ? l.ar : l.en }))} /></div>
      </Row>
      <div><Label htmlFor="dd">{t({ ar: "تاريخ التسليم المتوقع", en: "Expected Delivery Date" })}</Label><TextField id="dd" type="date" dir="ltr" value={f["Delivery Date"]} onChange={(v) => set("Delivery Date", v)} /></div>

      {/* Large project description */}
      <div><Label htmlFor="de">{t({ ar: "اشرح مشروعك بالتفصيل", en: "Describe your project in detail" })}</Label><TextArea id="de" value={f["Description"]} onChange={(v) => set("Description", v)} rows={6} /></div>

      <button onClick={submit} disabled={sending} className="btn-red" style={{ width: "100%", justifyContent: "center", marginTop: "8px", opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
        <span>{sending ? "..." : t({ ar: "إرسال الطلب", en: "Submit Request" })}</span>
      </button>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }} className="form-row">{children}</div>;
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

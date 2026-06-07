"use client";
import { useState } from "react";
import FormShell from "@/components/forms/FormShell";
import { Label, TextField, TextArea, SelectField } from "@/components/forms/Field";
import { submitToSheets, makeRef, isValidMobile } from "@/lib/submitForm";
import SuccessCard from "@/components/forms/SuccessCard";
import { useI18n } from "@/lib/i18n";

const WA_NUMBER = "966503422999";

const MEETING_TYPES = [
  { en: "Online Meeting", ar: "اجتماع أونلاين" },
  { en: "Phone Consultation", ar: "استشارة هاتفية" },
  { en: "On-Site Project Visit", ar: "زيارة ميدانية للمشروع" },
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

function Form() {
  const { t, isAr } = useI18n();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState("");
  const [f, setF] = useState({
    "Name": "", "Company": "", "Mobile": "", "Email": "",
    "Meeting Type": "", "Preferred Date": "", "Preferred Time": "", "Notes": "", "Lead Source": "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f["Name"] || !f["Mobile"]) {
      alert(isAr ? "الرجاء تعبئة الاسم ورقم الجوال على الأقل" : "Please fill at least name and mobile");
      return;
    }
    if (!isValidMobile(f["Mobile"])) {
      alert(isAr ? "رقم الجوال غير صحيح" : "Invalid mobile number");
      return;
    }
    setSending(true);
    const ref = makeRef("meeting");
    // Language-aware meeting type label
    const mt = MEETING_TYPES.find((m) => m.en === f["Meeting Type"]);
    const meetingTypeLabel = f["Meeting Type"] ? (isAr ? (mt?.ar ?? f["Meeting Type"]) : f["Meeting Type"]) : "";
    const lsObj = LEAD_SOURCES.find((l) => l.en === f["Lead Source"]);
    const leadLabel = f["Lead Source"] ? (isAr ? (lsObj?.ar ?? f["Lead Source"]) : f["Lead Source"]) : "";
    // Send Mobile + Phone (same value) AND Date/Time under multiple common column
    // names so the sheet column gets filled regardless of its exact header.
    await submitToSheets("meeting", {
      "Name": f["Name"],
      "Company": f["Company"],
      "Mobile": f["Mobile"],
      "Phone": f["Mobile"],
      "Email": f["Email"],
      "Meeting Type": meetingTypeLabel,
      "Preferred Date": f["Preferred Date"],
      "Date": f["Preferred Date"],
      "Preferred Time": f["Preferred Time"],
      "Time": f["Preferred Time"],
      "Notes": f["Notes"],
      "Reference": ref,
      "How did you hear about us": leadLabel,
      "Lead Source": leadLabel,
      "Language": isAr ? "AR" : "EN",
    });
    setSending(false);
    setReference(ref);
    setSent(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const waText = encodeURIComponent(isAr
    ? "السلام عليكم، أرغب بحجز موعد مع كيان ميديا"
    : "Hello, I'd like to book a meeting with Kian Media");
  const waLink = `https://wa.me/${WA_NUMBER}?text=${waText}`;

  if (sent) return <SuccessCard reference={reference} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div><Label htmlFor="nm" required>{t({ ar: "الاسم", en: "Name" })}</Label><TextField id="nm" value={f["Name"]} onChange={(v) => set("Name", v)} required /></div>
        <div><Label htmlFor="co">{t({ ar: "الشركة", en: "Company" })}</Label><TextField id="co" value={f["Company"]} onChange={(v) => set("Company", v)} /></div>
      </div>
      <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div><Label htmlFor="mo" required>{t({ ar: "الجوال", en: "Mobile" })}</Label><TextField id="mo" type="tel" dir="ltr" value={f["Mobile"]} onChange={(v) => set("Mobile", v)} required /></div>
        <div><Label htmlFor="em">{t({ ar: "البريد الإلكتروني", en: "Email" })}</Label><TextField id="em" type="email" dir="ltr" value={f["Email"]} onChange={(v) => set("Email", v)} /></div>
      </div>
      <div><Label htmlFor="mt" required>{t({ ar: "نوع الاجتماع", en: "Meeting Type" })}</Label>
        <SelectField id="mt" value={f["Meeting Type"]} onChange={(v) => set("Meeting Type", v)} options={MEETING_TYPES.map((m) => ({ value: m.en, label: isAr ? m.ar : m.en }))} required /></div>
      <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div><Label htmlFor="pd">{t({ ar: "التاريخ المفضّل", en: "Preferred Date" })}</Label><TextField id="pd" type="date" dir="ltr" value={f["Preferred Date"]} onChange={(v) => set("Preferred Date", v)} /></div>
        <div><Label htmlFor="pt">{t({ ar: "الوقت المفضّل", en: "Preferred Time" })}</Label><TextField id="pt" type="time" dir="ltr" value={f["Preferred Time"]} onChange={(v) => set("Preferred Time", v)} /></div>
      </div>
      <div><Label htmlFor="no">{t({ ar: "ملاحظات", en: "Notes" })}</Label><TextArea id="no" value={f["Notes"]} onChange={(v) => set("Notes", v)} rows={4} /></div>
      <div><Label htmlFor="ls">{t({ ar: "كيف تعرفت علينا؟", en: "How did you hear about us?" })}</Label>
        <SelectField id="ls" value={f["Lead Source"]} onChange={(v) => set("Lead Source", v)} options={LEAD_SOURCES.map((l) => ({ value: l.en, label: isAr ? l.ar : l.en }))} /></div>

      <button onClick={submit} disabled={sending} className="btn-red" style={{ width: "100%", justifyContent: "center", marginTop: "8px", opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
        <span>{sending ? "..." : t({ ar: "تأكيد الحجز", en: "Confirm Booking" })}</span>
      </button>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", margin: "6px 0" }}>
        <span style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
        <span className="f-sans" style={{ fontSize: "11px", letterSpacing: "2px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>{t({ ar: "أو", en: "or" })}</span>
        <span style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
      </div>

      {/* WhatsApp booking */}
      <a href={waLink} target="_blank" rel="noopener noreferrer" className="btn-wa" style={{ width: "100%", justifyContent: "center" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
        <span>{t({ ar: "احجز عبر واتساب", en: "Book via WhatsApp" })}</span>
      </a>

      {/* Calendly placeholder — ready for future integration */}
      <div style={{ marginTop: "10px", padding: "16px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px", textAlign: "center" }}>
        <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px" }}>
          {t({ ar: "حجز مباشر عبر التقويم — قريباً", en: "Direct calendar booking — coming soon" })}
        </p>
      </div>
    </div>
  );
}


export default function BookMeetingPage() {
  return (
    <FormShell
      eyebrow={{ ar: "حجز موعد", en: "Book a Meeting" }}
      title={{ ar: "لنلتقِ ونناقش مشروعك", en: "Let's Meet & Discuss Your Project" }}
      subtitle={{ ar: "اختر الطريقة الأنسب لك، وسنرتّب الموعد.", en: "Choose what works best for you and we'll arrange it." }}
    >
      <Form />
    </FormShell>
  );
}

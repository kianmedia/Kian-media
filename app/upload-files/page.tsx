"use client";
import { useState } from "react";
import FormShell from "@/components/forms/FormShell";
import { Label, TextField, TextArea } from "@/components/forms/Field";
import { submitToSheets, makeRef, isValidMobile, isValidEmail } from "@/lib/submitForm";
import SuccessCard from "@/components/forms/SuccessCard";
import { useI18n } from "@/lib/i18n";

function Form() {
  const { t, isAr } = useI18n();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState("");
  const [f, setF] = useState({
    "Client Name": "", "Company": "", "Mobile": "", "Email": "", "Project Name": "",
    "Google Drive Link": "", "WeTransfer Link": "", "Dropbox Link": "", "Notes": "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f["Client Name"] || !f["Mobile"]) {
      alert(isAr ? "الرجاء كتابة اسم العميل ورقم الجوال" : "Please enter client name and mobile");
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
    const hasLink = f["Google Drive Link"] || f["WeTransfer Link"] || f["Dropbox Link"];
    if (!hasLink) {
      alert(isAr ? "الرجاء إضافة رابط واحد على الأقل" : "Please add at least one link");
      return;
    }
    setSending(true);
    const ref = makeRef("upload");
    await submitToSheets("upload", { ...f, "Reference": ref, "Language": isAr ? "AR" : "EN" });
    setSending(false);
    setReference(ref);
    setSent(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (sent) return <SuccessCard reference={reference} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div><Label htmlFor="cn" required>{t({ ar: "اسم العميل", en: "Client Name" })}</Label><TextField id="cn" value={f["Client Name"]} onChange={(v) => set("Client Name", v)} required /></div>
        <div><Label htmlFor="cmp">{t({ ar: "اسم الشركة", en: "Company Name" })}</Label><TextField id="cmp" value={f["Company"]} onChange={(v) => set("Company", v)} /></div>
      </div>
      <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div><Label htmlFor="mo" required>{t({ ar: "رقم الجوال", en: "Mobile Number" })}</Label><TextField id="mo" type="tel" dir="ltr" value={f["Mobile"]} onChange={(v) => set("Mobile", v)} required /></div>
        <div><Label htmlFor="em">{t({ ar: "البريد الإلكتروني", en: "Email Address" })}</Label><TextField id="em" type="email" dir="ltr" value={f["Email"]} onChange={(v) => set("Email", v)} /></div>
      </div>
      <div><Label htmlFor="pn">{t({ ar: "اسم المشروع", en: "Project Name" })}</Label><TextField id="pn" value={f["Project Name"]} onChange={(v) => set("Project Name", v)} /></div>

      <div style={{ padding: "14px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px" }}>
        <p className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: "2px" }}>
          {t({ ar: "ارفع ملفاتك على Google Drive أو WeTransfer أو Dropbox، ثم الصق الرابط هنا. أضف رابطاً واحداً على الأقل.", en: "Upload your files to Google Drive, WeTransfer, or Dropbox, then paste the link here. Add at least one." })}
        </p>
      </div>

      <div><Label htmlFor="gd">{t({ ar: "رابط Google Drive", en: "Google Drive Link" })}</Label><TextField id="gd" type="url" dir="ltr" placeholder="https://drive.google.com/..." value={f["Google Drive Link"]} onChange={(v) => set("Google Drive Link", v)} /></div>
      <div><Label htmlFor="wt">{t({ ar: "رابط WeTransfer", en: "WeTransfer Link" })}</Label><TextField id="wt" type="url" dir="ltr" placeholder="https://wetransfer.com/..." value={f["WeTransfer Link"]} onChange={(v) => set("WeTransfer Link", v)} /></div>
      <div><Label htmlFor="db">{t({ ar: "رابط Dropbox", en: "Dropbox Link" })}</Label><TextField id="db" type="url" dir="ltr" placeholder="https://dropbox.com/..." value={f["Dropbox Link"]} onChange={(v) => set("Dropbox Link", v)} /></div>
      <div><Label htmlFor="no">{t({ ar: "ملاحظات المشروع", en: "Project Notes" })}</Label><TextArea id="no" value={f["Notes"]} onChange={(v) => set("Notes", v)} rows={4} /></div>

      <button onClick={submit} disabled={sending} className="btn-red" style={{ width: "100%", justifyContent: "center", marginTop: "8px", opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
        <span>{sending ? "..." : t({ ar: "إرسال الروابط", en: "Submit Links" })}</span>
      </button>
    </div>
  );
}


export default function UploadFilesPage() {
  return (
    <FormShell
      eyebrow={{ ar: "إرسال الملفات", en: "Submit Files" }}
      title={{ ar: "أرسل ملفات مشروعك", en: "Send Us Your Project Files" }}
      subtitle={{ ar: "شارك روابط ملفاتك بسهولة عبر خدمات التخزين السحابي.", en: "Share your file links easily via cloud storage services." }}
    >
      <Form />
    </FormShell>
  );
}

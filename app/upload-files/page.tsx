"use client";
import { useState } from "react";
import FormShell from "@/components/forms/FormShell";
import { Label, TextField, TextArea } from "@/components/forms/Field";
import { submitToSheets } from "@/lib/submitForm";
import { useI18n } from "@/lib/i18n";

function Form() {
  const { t, isAr } = useI18n();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [f, setF] = useState({
    "Client Name": "", "Mobile": "", "Project Name": "",
    "Google Drive Link": "", "WeTransfer Link": "", "Dropbox Link": "", "Notes": "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f["Client Name"] || !f["Mobile"]) {
      alert(isAr ? "الرجاء كتابة اسم العميل ورقم الجوال" : "Please enter client name and mobile");
      return;
    }
    const hasLink = f["Google Drive Link"] || f["WeTransfer Link"] || f["Dropbox Link"];
    if (!hasLink) {
      alert(isAr ? "الرجاء إضافة رابط واحد على الأقل" : "Please add at least one link");
      return;
    }
    setSending(true);
    await submitToSheets("upload", f);
    setSending(false);
    setSent(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (sent) return <SuccessCard />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div><Label htmlFor="cn" required>{t({ ar: "اسم العميل", en: "Client Name" })}</Label><TextField id="cn" value={f["Client Name"]} onChange={(v) => set("Client Name", v)} required /></div>
        <div><Label htmlFor="mo" required>{t({ ar: "رقم الجوال", en: "Mobile Number" })}</Label><TextField id="mo" type="tel" dir="ltr" value={f["Mobile"]} onChange={(v) => set("Mobile", v)} required /></div>
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

function SuccessCard() {
  const { t } = useI18n();
  return (
    <div className="text-center" style={{ padding: "50px 30px", background: "rgba(227,30,36,0.05)", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "4px" }}>
      <div style={{ width: "64px", height: "64px", margin: "0 auto 24px", borderRadius: "50%", background: "rgba(227,30,36,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#E31E24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </div>
      <h3 className="editorial text-white" style={{ fontSize: "24px", marginBottom: "12px" }}>{t({ ar: "تم الاستلام", en: "Received" })}</h3>
      <p className="text-white/60" style={{ fontSize: "15px", lineHeight: 1.8, maxWidth: "420px", margin: "0 auto" }}>
        {t({ ar: "تم استلام روابط المشروع بنجاح وسيقوم فريق كيان بمراجعتها والتواصل معك.", en: "Your project links have been received successfully. The Kian team will review them and contact you." })}
      </p>
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

"use client";
// Client/lead file LINKS — paste shareable URLs (no Storage upload yet).
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { Label, TextField } from "@/components/forms/Field";
import { listMyFiles, addFileLink } from "@/lib/portal/leads";
import type { FileLink } from "@/lib/portal/types";

function isValidUrl(u: string): boolean {
  try {
    const url = new URL(u.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

export default function ClientFiles() {
  const { t } = useI18n();
  const { readOnly } = usePortal();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [files, setFiles] = useState<FileLink[]>([]);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const r = await listMyFiles();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setFiles(r.data);
    setPhase("ready");
  }
  useEffect(() => { void load(); }, []);

  async function submit() {
    setFormErr("");
    if (!isValidUrl(url)) { setFormErr(t({ ar: "أدخل رابطاً صحيحاً يبدأ بـ http أو https", en: "Enter a valid URL starting with http or https" })); return; }
    setSaving(true);
    const r = await addFileLink(url.trim(), label.trim() || undefined);
    setSaving(false);
    if (!r.ok) { setFormErr(t({ ar: "تعذّر الحفظ: ", en: "Couldn't save: " }) + r.error); return; }
    setUrl(""); setLabel("");
    void load();
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "ملفاتي", en: "My Files" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "مشاركة روابط الملفات", en: "Share File Links" })}
        </h1>
        <p className="text-white/50" style={{ fontSize: "13.5px", lineHeight: 1.7, marginTop: "10px", maxWidth: "560px" }}>
          {t({
            ar: "ارفع ملفاتك على Google Drive أو WeTransfer أو Dropbox ثم الصق الرابط هنا. (الرفع المباشر للملفات قادم لاحقاً.)",
            en: "Upload your files to Google Drive, WeTransfer, or Dropbox, then paste the link here. (Direct file upload is coming later.)",
          })}
        </p>
      </div>

      {readOnly ? (
        <div className="f-sans" style={{ padding: "14px 16px", fontSize: "13px", color: "#ffd28a", background: "rgba(255,166,0,0.08)", border: "1px solid rgba(255,166,0,0.3)", borderRadius: "3px", marginBottom: "30px" }}>
          {t({ ar: "حسابك في وضع القراءة فقط — لا يمكن إضافة روابط حالياً.", en: "Your account is read-only — links can't be added right now." })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "40px" }}>
          <div><Label htmlFor="fu" required>{t({ ar: "رابط الملف", en: "File Link" })}</Label>
            <TextField id="fu" type="url" dir="ltr" placeholder="https://drive.google.com/..." value={url} onChange={setUrl} /></div>
          <div><Label htmlFor="fl">{t({ ar: "وصف مختصر (اختياري)", en: "Short Label (optional)" })}</Label>
            <TextField id="fl" value={label} onChange={setLabel} /></div>
          {formErr && <div className="f-sans" style={{ padding: "12px 14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{formErr}</div>}
          <button onClick={submit} disabled={saving} className="btn-red" style={{ justifyContent: "center", opacity: saving ? 0.6 : 1, cursor: saving ? "wait" : "pointer" }}>
            <span>{saving ? "..." : t({ ar: "إضافة الرابط", en: "Add Link" })}</span>
          </button>
        </div>
      )}

      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600, marginBottom: "14px" }}>
        {t({ ar: "الروابط المرسلة", en: "Submitted Links" })}
      </div>
      {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>}
      {phase === "ready" && files.length === 0 && <p className="text-white/45" style={{ fontSize: "14px" }}>{t({ ar: "لا توجد روابط بعد.", en: "No links yet." })}</p>}
      {phase === "ready" && files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3" style={{ padding: "13px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                {f.label && <div className="text-white" style={{ fontSize: "13.5px", fontWeight: 600, marginBottom: "3px" }}>{f.label}</div>}
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", direction: "ltr", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>{f.url}</a>
              </div>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", border: "1px solid rgba(227,30,36,0.3)", padding: "7px 12px", borderRadius: "2px", textDecoration: "none", whiteSpace: "nowrap" }}>
                {t({ ar: "فتح", en: "Open" })}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

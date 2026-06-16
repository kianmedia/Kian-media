"use client";
// ════════════════════════════════════════════════════════════════════════
// Dynamic opportunity form: shared fields + the selected type's specific fields.
// Public (no login) → submitOpportunityRequest (anon RPC). Inline validation,
// honeypot anti-spam, consent, inline success/error (no alert()). On success it
// emails Kian (opportunity_new) + the applicant (opportunity_ack) via portal_notify.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SHARED_FIELDS, submitOpportunityRequest, type OppType, type OppField } from "@/lib/opportunities";
import { notifyOpportunityNew, notifyOpportunityAck } from "@/lib/portal/notifyEmail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WA_URL = "https://wa.me/966503422999";

export default function OpportunityForm({ type, onBack }: { type: OppType; onBack: () => void }) {
  const { t, isAr } = useI18n();
  const all: OppField[] = [...SHARED_FIELDS, ...type.fields];
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState(""); // honeypot — must stay empty
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null); // request number (or "")

  // On success, bring the success panel into view (never scroll to other sections).
  useEffect(() => { if (done !== null) window.scrollTo({ top: 0, behavior: "smooth" }); }, [done]);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));

  function validate(): string | null {
    for (const f of all) {
      const v = (values[f.key] || "").trim();
      if (f.required && !v) return t({ ar: `الحقل «${f.ar}» مطلوب`, en: `"${f.en}" is required` });
      if (v && f.type === "email" && !EMAIL_RE.test(v)) return t({ ar: "البريد الإلكتروني غير صحيح", en: "Invalid email address" });
      if (v && f.type === "url" && !/^https?:\/\//i.test(v)) return t({ ar: `رابط «${f.ar}» يجب أن يبدأ بـ http`, en: `"${f.en}" must start with http` });
    }
    if (!consent) return t({ ar: "يجب الموافقة على تواصل كيان معك للمتابعة", en: "You must consent to be contacted to continue" });
    return null;
  }

  async function submit() {
    setErr("");
    const v = validate();
    if (v) { setErr(v); return; }
    if (hp.trim()) { setDone(""); return; } // honeypot tripped — pretend success, send nothing
    setBusy(true);
    const details: Record<string, string> = {};
    for (const f of type.fields) { const val = (values[f.key] || "").trim(); if (val) details[f.key] = val; }
    // Source + UTM attribution (stored in details jsonb; no DB change needed).
    details.source = "website_opportunities_center";
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      for (const k of ["utm_source", "utm_medium", "utm_campaign"]) { const u = p.get(k); if (u) details[k] = u; }
    }
    const r = await submitOpportunityRequest({
      type: type.key,
      full_name: (values.full_name || "").trim(),
      email: (values.email || "").trim() || undefined,
      phone: (values.phone || "").trim() || undefined,
      city: (values.city || "").trim() || undefined,
      message: (values.message || "").trim() || undefined,
      details, consent: true,
    });
    setBusy(false);
    if (!r.ok) { setErr(t({ ar: "تعذّر إرسال الطلب: ", en: "Couldn't submit: " }) + r.error); return; }
    const num = r.data || "";
    // Fire-and-forget emails (Kian + applicant). Never block the success state.
    void notifyOpportunityNew({ type: isAr ? type.ar : type.en, fullName: (values.full_name || "").trim(), email: values.email, phone: values.phone, city: values.city, message: values.message, requestNumber: num });
    if ((values.email || "").trim()) void notifyOpportunityAck({ toEmail: values.email.trim(), fullName: (values.full_name || "").trim(), requestNumber: num });
    setDone(num);
  }

  if (done !== null) {
    return (
      <div className="mx-auto text-center" style={{ maxWidth: "560px", padding: "10px 0 40px" }}>
        <div style={{ width: "64px", height: "64px", margin: "0 auto 22px", borderRadius: "50%", background: "rgba(124,252,154,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#7CFC9A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h2 className="editorial text-white" style={{ fontSize: "24px", marginBottom: "14px" }}>{t({ ar: "تم الإرسال", en: "Submitted" })}</h2>
        <p className="text-white/65" style={{ fontSize: "15px", lineHeight: 1.9, marginBottom: "18px" }}>
          {t({ ar: "تم استلام طلبك بنجاح. سيقوم فريق كيان بمراجعة الطلب والتواصل معك عند توفر فرصة مناسبة.", en: "Your request was received. The Kian team will review it and contact you when a suitable opportunity arises." })}
        </p>
        {done && (
          <div style={{ display: "inline-block", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(227,30,36,0.35)", borderRadius: "6px", padding: "14px 22px", marginBottom: "12px" }}>
            <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: "5px" }}>{t({ ar: "رقم الطلب", en: "Request Number" })}</div>
            <div style={{ direction: "ltr", unicodeBidi: "plaintext", color: "#fff", fontWeight: 700, fontSize: "20px", letterSpacing: "1px" }}>{done}</div>
          </div>
        )}
        {done && <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", marginBottom: "24px" }}>{t({ ar: "احتفظ برقم الطلب للمتابعة.", en: "Keep your request number for follow-up." })}</p>}
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <a href={WA_URL} target="_blank" rel="noopener noreferrer" className="btn-wa" style={{ justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
            <span>{t({ ar: "تواصل معنا عبر واتساب", en: "Contact us on WhatsApp" })}</span>
          </a>
          <button onClick={onBack} className="btn-ghost" style={{ justifyContent: "center" }}><span>{t({ ar: "إرسال طلب آخر", en: "Submit another request" })}</span></button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto" style={{ maxWidth: "640px" }}>
      <button onClick={onBack} className="f-sans inline-flex items-center gap-2 mb-6" style={{ fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", background: "none", border: "none", cursor: "pointer" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "none" : "scaleX(-1)" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        {t({ ar: "كل الفرص", en: "All opportunities" })}
      </button>

      <h2 className="editorial text-white" style={{ fontSize: "clamp(22px,3.5vw,30px)", marginBottom: "6px" }}>{isAr ? type.ar : type.en}</h2>
      <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.7, marginBottom: "26px" }}>{isAr ? type.tagline.ar : type.tagline.en}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {all.map((f) => <Field key={f.key} f={f} value={values[f.key] || ""} onChange={(v) => set(f.key, v)} isAr={isAr} t={t} />)}

        {/* Honeypot — visually hidden; bots fill it, humans don't */}
        <input type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)}
          aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", opacity: 0 }} />

        {/* Consent + privacy */}
        <label className="f-sans" style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "13px", color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: "16px", height: "16px", marginTop: "2px", accentColor: "#E31E24", cursor: "pointer", flexShrink: 0 }} />
          <span>
            {t({ ar: "أوافق على تواصل كيان معي بخصوص هذا الطلب", en: "I consent to Kian contacting me about this request" })}
            <span style={{ color: "#E31E24", marginInlineStart: "4px" }}>*</span>
          </span>
        </label>
        <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.4)", lineHeight: 1.7, marginTop: "-6px" }}>
          {isAr
            ? <>بإرسالك الطلب فأنت تقر باطّلاعك على <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "#E31E24", textDecoration: "underline" }}>سياسة الخصوصية</a>.</>
            : <>By submitting you acknowledge our <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "#E31E24", textDecoration: "underline" }}>Privacy Policy</a>.</>}
        </p>

        {err && <div className="f-sans" style={{ padding: "12px 14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{err}</div>}

        <button onClick={() => void submit()} disabled={busy} className="btn-red" style={{ width: "100%", justifyContent: "center", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
          <span>{busy ? "..." : t({ ar: "إرسال الطلب", en: "Submit Request" })}</span>
        </button>
      </div>
    </div>
  );
}

function Field({ f, value, onChange, isAr, t }: { f: OppField; value: string; onChange: (v: string) => void; isAr: boolean; t: (m: { ar: string; en: string }) => string }) {
  const label = (
    <label htmlFor={f.key} className="f-sans" style={{ display: "block", marginBottom: "7px", fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
      {isAr ? f.ar : f.en}{f.required && <span style={{ color: "#E31E24", marginInlineStart: "4px" }}>*</span>}
    </label>
  );
  const base: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "3px", padding: "12px 14px", color: "#fff", fontSize: "14.5px", fontFamily: "var(--sans)",
    outline: "none", colorScheme: "dark",
  };
  const ltr = f.type === "email" || f.type === "url" || f.type === "tel";
  return (
    <div>
      {label}
      {f.type === "textarea" ? (
        <textarea id={f.key} value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={4000} style={{ ...base, resize: "vertical", lineHeight: 1.6 }} />
      ) : f.type === "select" ? (
        <select id={f.key} value={value} onChange={(e) => onChange(e.target.value)} style={base}>
          <option value="" style={{ background: "#0a0a0a" }}>{t({ ar: "— اختر —", en: "— select —" })}</option>
          {f.options?.map((o) => <option key={o.value} value={o.value} style={{ background: "#0a0a0a" }}>{isAr ? o.ar : o.en}</option>)}
        </select>
      ) : (
        <input id={f.key} type={f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "tel" ? "tel" : f.type === "url" ? "url" : "text"}
          value={value} onChange={(e) => onChange(e.target.value)} dir={ltr ? "ltr" : undefined} style={base} />
      )}
    </div>
  );
}

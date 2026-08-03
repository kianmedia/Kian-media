"use client";
// ════════════════════════════════════════════════════════════════════════
// /share-experience — public testimonial submission (آراء العملاء).
// Anon RPC (kian_submit_testimonial) with server-side rate-limiting. Submissions
// are always accepted as `pending` and only shown publicly after admin approval
// AND the testimonials_enabled flag is on.
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import FormShell from "@/components/forms/FormShell";
import { Label, TextField, TextArea, CheckField } from "@/components/forms/Field";
import { useI18n } from "@/lib/i18n";
import { submitTestimonial, testimonialErrorAr } from "@/lib/portal/testimonials";

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div>
      <Label>{t({ ar: "تقييمك (اختياري)", en: "Your rating (optional)" })}</Label>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n === value ? 0 : n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n}/5`}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "28px", lineHeight: 1, padding: "2px", color: n <= active ? "#E31E24" : "rgba(255,255,255,0.2)", transition: "color 0.15s" }}
          >
            ★
          </button>
        ))}
        {value > 0 && (
          <button type="button" onClick={() => onChange(0)} className="text-white/40 hover:text-white/70" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", marginInlineStart: "8px" }}>
            {t({ ar: "مسح", en: "clear" })}
          </button>
        )}
      </div>
    </div>
  );
}

function Form() {
  const { t, isAr } = useI18n();
  const [f, setF] = useState({ name: "", title: "", company: "", body: "" });
  const [rating, setRating] = useState(0);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setErr("");
    if (f.name.trim().length < 2) { setErr(t({ ar: "الرجاء إدخال اسمك.", en: "Please enter your name." })); return; }
    if (f.body.trim().length < 10) { setErr(t({ ar: "الرجاء كتابة تجربتك (١٠ أحرف على الأقل).", en: "Please write your experience (at least 10 characters)." })); return; }
    if (!consent) { setErr(t({ ar: "يلزم الموافقة على نشر التجربة.", en: "Please consent to publishing your experience." })); return; }
    setSending(true);
    const r = await submitTestimonial({
      name: f.name.trim(),
      body: f.body.trim(),
      title: f.title.trim() || undefined,
      company: f.company.trim() || undefined,
      rating: rating || null,
      lang: isAr ? "ar" : "en",
      consent: true,
    });
    setSending(false);
    if (!r.ok) { setErr(testimonialErrorAr(r.error)); return; }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="glass-red text-center relative overflow-hidden" style={{ padding: "56px 32px" }}>
        <div style={{ fontSize: "44px", color: "var(--red)", marginBottom: "18px" }}>✓</div>
        <h3 className="editorial text-white" style={{ fontSize: "clamp(22px,3vw,30px)", marginBottom: "14px" }}>
          {t({ ar: "شكرًا لمشاركتك", en: "Thank you for sharing" })}
        </h3>
        <p className="text-white/60" style={{ fontSize: "15px", lineHeight: 1.9, maxWidth: "440px", margin: "0 auto 28px" }}>
          {t({
            ar: "وصلتنا تجربتك وستظهر في الموقع بعد مراجعتها من فريقنا. نقدّر لك ثقتك بكيان.",
            en: "We received your experience — it will appear on the site after our team reviews it. We appreciate your trust in Kian.",
          })}
        </p>
        <a href="/" className="btn-red inline-flex"><span>{t({ ar: "العودة للرئيسية", en: "Back to Home" })}</span></a>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }} className="form-row">
        <div><Label htmlFor="tn" required>{t({ ar: "الاسم", en: "Name" })}</Label><TextField id="tn" value={f.name} onChange={(v) => set("name", v)} required /></div>
        <div><Label htmlFor="tt">{t({ ar: "المسمّى / الصفة", en: "Title / Role" })}</Label><TextField id="tt" value={f.title} onChange={(v) => set("title", v)} /></div>
      </div>
      <div><Label htmlFor="tc">{t({ ar: "الجهة / الشركة", en: "Organization / Company" })}</Label><TextField id="tc" value={f.company} onChange={(v) => set("company", v)} /></div>

      <StarPicker value={rating} onChange={setRating} />

      <div>
        <Label htmlFor="tb" required>{t({ ar: "تجربتك مع كيان", en: "Your experience with Kian" })}</Label>
        <TextArea id="tb" value={f.body} onChange={(v) => set("body", v)} rows={6} />
      </div>

      <CheckField
        id="tconsent"
        checked={consent}
        onChange={setConsent}
        label={t({ ar: "أوافق على نشر تجربتي واسمي على موقع كيان بعد المراجعة.", en: "I consent to publishing my experience and name on Kian's website after review." })}
      />

      {err && <p className="text-center" style={{ color: "#ff6b6f", fontSize: "13.5px" }}>{err}</p>}

      <button onClick={submit} disabled={sending} className="btn-red" style={{ width: "100%", justifyContent: "center", marginTop: "6px", opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
        <span>{sending ? "..." : t({ ar: "إرسال التجربة", en: "Submit Experience" })}</span>
      </button>
      <p className="text-center text-white/35" style={{ fontSize: "11.5px", lineHeight: 1.7 }}>
        {t({ ar: "تُراجَع كل المشاركات قبل النشر. لن تُنشر بيانات تواصلك.", en: "All submissions are reviewed before publishing. Your contact details are never published." })}
      </p>
    </div>
  );
}

export default function ShareExperiencePage() {
  return (
    <FormShell
      eyebrow={{ ar: "شارك تجربتك", en: "Share Your Experience" }}
      title={{ ar: "رأيك يصنع الفرق", en: "Your Words Matter" }}
      subtitle={{ ar: "إن كنت من شركاء كيان، شاركنا تجربتك — ستظهر في موقعنا بعد مراجعتها.", en: "If you've partnered with Kian, share your experience — it will appear on our site after review." }}
    >
      <Form />
    </FormShell>
  );
}

"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import ConsentField from "@/components/forms/ConsentField";
import { CONSENT_REQUIRED_MESSAGE, consentBlocksSubmit, consentEnabled, consentPayload } from "@/lib/consent";
import { captureIntake } from "@/lib/submitForm";
import { captureAttribution } from "@/lib/attribution";
import { NAP, primaryPhone, waLink } from "@/content/nap";

const PROJECT_TYPES_AR = ["فيلم مؤسّسي", "إعلان تجاري", "تصوير جوي بالدرون", "بثّ مباشر", "تغطية فعالية", "تصوير عقاري", "فيلم وثائقي", "أعراس", "محتوى سوشيال", "غير ذلك"];
const PROJECT_TYPES_EN = ["Corporate Film", "Commercial / Ad", "Drone Cinematography", "Live Streaming", "Event Coverage", "Real Estate", "Documentary", "Wedding", "Social Reels", "Other"];

const BUDGET_RANGES_AR = ["أقل من ٢٥,٠٠٠ ر.س", "٢٥,٠٠٠ — ٧٥,٠٠٠", "٧٥,٠٠٠ — ٢٠٠,٠٠٠", "٢٠٠,٠٠٠ — ٥٠٠,٠٠٠", "٥٠٠,٠٠٠+"];
const BUDGET_RANGES_EN = ["Under 25,000 SAR", "25,000 — 75,000 SAR", "75,000 — 200,000 SAR", "200,000 — 500,000 SAR", "500,000+ SAR"];

export default function Contact() {
  const { t, isAr } = useI18n();
  const projectTypes = isAr ? PROJECT_TYPES_AR : PROJECT_TYPES_EN;
  const budgetRanges = isAr ? BUDGET_RANGES_AR : BUDGET_RANGES_EN;

  const [form, setForm] = useState({
    name: "", company: "", phone: "", email: "",
    project: "", budget: "", message: "",
  });

  const [agreed, setAgreed] = useState(false);

  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // V2-0.1-A. With the flag off consentBlocksSubmit() is always false, so this
    // guard is inert and the form behaves exactly as it did before Wave 0.
    if (consentBlocksSubmit(agreed)) {
      alert(isAr ? CONSENT_REQUIRED_MESSAGE.ar : CONSENT_REQUIRED_MESSAGE.en);
      return;
    }
    const msg =
      `طلب عرض إنتاج | Kian Media Proposal Request\n\n` +
      `👤 Name: ${form.name}\n🏢 Company: ${form.company}\n` +
      `📞 Phone: ${form.phone}\n✉️  Email: ${form.email}\n` +
      `🎬 Project: ${form.project || projectTypes[0]}\n💰 Budget: ${form.budget || budgetRanges[1]}\n\n` +
      `📝 Message:\n${form.message}`;
    // ── V2-1.6-A — SAVE FIRST, THEN HAND OFF ────────────────────────────────
    // This form used to do nothing but open WhatsApp. If the visitor never sent
    // the pre-filled message — closed the tab, no WhatsApp installed, changed
    // their mind — the enquiry was gone with no trace anywhere on our side.
    //
    // v2.0 §1.6 said to POST to the Apps Script webhook first. v2.1 reverses
    // that deliberately: Apps Script is NOT the lead database. Supabase is
    // written first, so a failure of any downstream leg cannot lose the enquiry.
    //
    // Awaited, but it can never block the hand-off: captureIntake swallows every
    // failure and resolves to { ok: false }. Worst case the visitor still
    // reaches WhatsApp, exactly as before this change.
    setSending(true);
    await captureIntake({
      type: "contact",
      email: form.email,
      phone: form.phone,
      name: form.name,
      company: form.company,
      details: form.message,
      services: form.project ? [form.project] : [],
      preferred_contact: form.budget || undefined,
      source: "website-contact",
      ...captureAttribution(),
      ...(consentPayload(agreed) ?? {}),
    });
    setSending(false);

    window.open(waLink(msg), "_blank");
  };

  const update = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <section id="contact" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 80% 30%, rgba(227,30,36,0.05), transparent 50%)" }} />

      <div className="max-w-6xl mx-auto px-6 lg:px-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">

          {/* Left column */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.85 }}
            className="lg:col-span-5"
            data-reveal
          >
            <div className="eyebrow mb-6">{t({ ar: "ابدأ مشروعك", en: "Start Your Project" })}</div>
            <h2 className="editorial text-white mb-6" style={{ fontSize: "clamp(34px,5vw,56px)" }}>
              {t({ ar: "لنصنع", en: "Let's craft" })}{" "}
              <em>{t({ ar: "شيئًا استثنائيًا", en: "something remarkable" })}</em>.
            </h2>
            <p className="text-white/55 mb-6" style={{ fontSize: "15px", lineHeight: 1.9 }}>
              {t({
                ar: "لكل مشروع كبير بداية واحدة — محادثة. أرسل تفاصيل مشروعك وسيرتدّ عليك فريقنا الإنتاجي بعرض أولي مفصّل.",
                en: "Every great project starts with one conversation. Send your project brief and our production team will respond with a detailed initial proposal.",
              })}
            </p>

            {/* Response time + working days/hours */}
            <div className="mb-10 p-5" style={{ background: "rgba(227,30,36,0.06)", borderLeft: "3px solid #E31E24" }}>
              <div className="flex items-start gap-3">
                <span style={{ color: "#E31E24", fontSize: "16px", marginTop: "2px" }}>◆</span>
                <div className="flex-1">
                  <div className="text-white" style={{ fontSize: "14px", fontWeight: 700, lineHeight: 1.5 }}>
                    {t({ ar: "نرد عليكم في أسرع وقت ممكن", en: "We respond as quickly as possible" })}
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <div className="text-white/65" style={{ fontSize: "12.5px", lineHeight: 1.6 }}>
                      <span style={{ color: "rgba(227,30,36,0.85)", fontWeight: 600 }}>
                        {t({ ar: "أيام العمل: ", en: "Working Days: " })}
                      </span>
                      <span>{t({ ar: "طوال أيام الأسبوع", en: "All Week" })}</span>
                    </div>
                    <div className="text-white/65" style={{ fontSize: "12.5px", lineHeight: 1.6 }}>
                      <span style={{ color: "rgba(227,30,36,0.85)", fontWeight: 600 }}>
                        {t({ ar: "ساعات العمل: ", en: "Working Hours: " })}
                      </span>
                      <span className="phone-ltr" style={{ display: "inline-block" }}>
                        {t({ ar: "من ٧:٠٠ ص إلى ١١:٤٥ م", en: "7:00 AM – 11:45 PM" })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Headquarters */}
              <div>
                <div className="f-sans mb-1.5" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600 }}>
                  {t({ ar: "المقر الرئيسي", en: "Main Headquarters" })}
                </div>
                <div className="text-white" style={{ fontSize: "17px", fontWeight: 600 }}>
                  {t({ ar: `${NAP.address.regionAr} — ${NAP.address.cityAr}`, en: `${NAP.address.regionEn} — ${NAP.address.cityEn}` })}
                </div>
                <div className="text-white/55 mt-1" style={{ fontSize: "13px" }}>
                  {t({ ar: "الرياض · جدة · المدينة المنورة", en: "Riyadh · Jeddah · Madinah" })}
                </div>
              </div>

              <div>
                <div className="f-sans mb-3" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600 }}>{t({ ar: "أرقامنا", en: "Our Numbers" })}</div>
                <div className="phone-ltr space-y-2.5" dir="ltr">
                  {NAP.phones.map((p) => p.e164).map((num) => {
                    const intl = num.replace("+", "");
                    return (
                      <div key={num} className="flex items-center gap-3 group">
                        <a
                          href={`tel:${num}`}
                          className="text-white transition-colors group-hover:text-red-400"
                          style={{ fontSize: "16px", letterSpacing: "0.5px", fontWeight: 500, fontVariantNumeric: "tabular-nums", flex: 1,
                                   // 🔴 Wave 8 — الضغط على رقم للاتصال فعل أساسيّ على
                                   //    الهاتف، وكان ارتفاعه ٢٤px. ٤٤px هو الحدّ الموثَّق.
                                   display: "flex", alignItems: "center", minHeight: "44px" }}
                          aria-label={`Call ${num}`}
                        >
                          {num}
                        </a>
                        <a
                          href={`tel:${num}`}
                          aria-label={`Call ${num}`}
                          className="inline-flex items-center justify-center transition-all"
                          style={{ width: "32px", height: "32px", minWidth: "44px", minHeight: "44px",
                                   border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.75)" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#E31E24"; (e.currentTarget as HTMLAnchorElement).style.color = "#E31E24"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.18)"; (e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.75)"; }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                          </svg>
                        </a>
                        <a
                          href={`https://wa.me/${intl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`WhatsApp ${num}`}
                          className="inline-flex items-center justify-center transition-all"
                          style={{ width: "32px", height: "32px", minWidth: "44px", minHeight: "44px",
                                   border: "1px solid rgba(37,211,102,0.4)", color: "#25D366" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#25D366"; (e.currentTarget as HTMLAnchorElement).style.color = "#fff"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "#25D366"; }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/>
                          </svg>
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="f-sans mb-1.5" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600 }}>{t({ ar: "البريد الإلكتروني", en: "Email" })}</div>
                <a href={`mailto:${NAP.email.primary}`} className="text-white hover:text-red-500 transition" style={{ fontSize: "15px", display: "flex", alignItems: "center", minHeight: "44px" }}>{NAP.email.primary}</a>
                <a href={`mailto:${NAP.email.sales}`} className="text-white hover:text-red-500 transition" style={{ fontSize: "15px", display: "flex", alignItems: "center", minHeight: "44px" }}>{NAP.email.sales}</a>
              </div>

              <div className="pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-white/65" style={{ fontSize: "14px", lineHeight: 1.85, fontWeight: 500 }}>
                  {t({
                    ar: "نخدم جميع مناطق المملكة العربية السعودية، بالإضافة إلى المشاريع والإنتاجات خارج المملكة.",
                    en: "We serve all regions of Saudi Arabia, in addition to projects and productions beyond the Kingdom.",
                  })}
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`https://wa.me/${primaryPhone.e164.replace("+", "")}`} target="_blank" rel="noopener noreferrer" className="btn-wa">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                <span>{t({ ar: "واتساب", en: "WhatsApp" })}</span>
              </a>
              <a href={`tel:${primaryPhone.e164}`} className="btn-ghost">
                <span>{t({ ar: "اتّصل بنا", en: "Call Us" })}</span>
              </a>
            </div>
          </motion.div>

          {/* Right form */}
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.85, delay: 0.1 }}
            className="lg:col-span-7 glass p-8 lg:p-12"
            data-reveal
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <label className="input-label">{t({ ar: "الاسم", en: "Name" })}</label>
                <input required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder={t({ ar: "اسمك الكامل", en: "Your full name" })} className="input-field" />
              </div>
              <div>
                <label className="input-label">{t({ ar: "الجهة", en: "Company" })}</label>
                <input value={form.company} onChange={(e) => update("company", e.target.value)} placeholder={t({ ar: "اسم الشركة / الجهة", en: "Company / Organization" })} className="input-field" />
              </div>
              <div>
                <label className="input-label">{t({ ar: "الجوال", en: "Phone" })}</label>
                <input required type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="05xxxxxxxx" className="input-field phone-ltr" />
              </div>
              <div>
                <label className="input-label">{t({ ar: "البريد", en: "Email" })}</label>
                <input required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="name@company.com" className="input-field" />
              </div>
              <div>
                <label className="input-label">{t({ ar: "نوع المشروع", en: "Project Type" })}</label>
                <select value={form.project} onChange={(e) => update("project", e.target.value)} className="input-field" style={{ background: "#050505" }}>
                  <option value="" style={{ background: "#050505" }}>{t({ ar: "اختر النوع...", en: "Select type..." })}</option>
                  {projectTypes.map((p) => <option key={p} value={p} style={{ background: "#050505" }}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">{t({ ar: "الميزانية", en: "Budget Range" })}</label>
                <select value={form.budget} onChange={(e) => update("budget", e.target.value)} className="input-field" style={{ background: "#050505" }}>
                  <option value="" style={{ background: "#050505" }}>{t({ ar: "اختر النطاق...", en: "Select range..." })}</option>
                  {budgetRanges.map((b) => <option key={b} value={b} style={{ background: "#050505" }}>{b}</option>)}
                </select>
              </div>
              <div className="md:col-span-2 mt-2">
                <label className="input-label">{t({ ar: "تفاصيل المشروع", en: "Project Details" })}</label>
                <textarea value={form.message} onChange={(e) => update("message", e.target.value)} placeholder={t({ ar: "أخبرنا عن مشروعك، الجدول الزمني، والأهداف...", en: "Tell us about your project, timeline, and goals..." })} rows={4} className="input-field" style={{ resize: "vertical" }} />
              </div>
            </div>

            {/* V2-0.1-A — renders nothing while the flag is off. */}
            <ConsentField id="contact-privacy-consent" checked={agreed} onChange={setAgreed} isAr={isAr} />

            <div className="mt-8 flex flex-wrap gap-3 items-center">
              <button type="submit" className="btn-red" disabled={sending} style={{ opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
                <span>{t({ ar: "إرسال عبر واتساب", en: "Send via WhatsApp" })}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "scaleX(-1)" : "none" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>

            {/* Once the explicit checkbox is live the implied-consent clause must go:
                keeping both would claim consent twice, once in a form the visitor
                never actively agreed to. The response-time promise stays either way. */}
            <p className="f-sans mt-6" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.3)" }}>
              {consentEnabled()
                ? t({ ar: "الردّ خلال ٢٤ ساعة.", en: "Response within 24 hours." })
                : t({ ar: "بإرسال النموذج، توافق على تواصلنا بخصوص مشروعك. الردّ خلال ٢٤ ساعة.", en: "By submitting, you agree we'll contact you about your project. Response within 24 hours." })}
            </p>
          </motion.form>
        </div>
      </div>
    </section>
  );
}

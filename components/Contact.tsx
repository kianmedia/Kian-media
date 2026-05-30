"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg =
      `طلب عرض إنتاج | Kian Media Proposal Request\n\n` +
      `👤 Name: ${form.name}\n🏢 Company: ${form.company}\n` +
      `📞 Phone: ${form.phone}\n✉️  Email: ${form.email}\n` +
      `🎬 Project: ${form.project || projectTypes[0]}\n💰 Budget: ${form.budget || budgetRanges[1]}\n\n` +
      `📝 Message:\n${form.message}`;
    window.open(`https://wa.me/966503422999?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const update = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <section id="contact" className="relative overflow-hidden" style={{ background: "#0B0B0B", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 80% 30%, rgba(193,18,31,0.05), transparent 50%)" }} />

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
            <p className="text-white/55 mb-10" style={{ fontSize: "15px", lineHeight: 1.9 }}>
              {t({
                ar: "لكل مشروع كبير بداية واحدة — محادثة. أرسل تفاصيل مشروعك وسيرتدّ عليك فريقنا الإنتاجي خلال ٢٤ ساعة بعرض أولي مفصّل.",
                en: "Every great project starts with one conversation. Send your project brief and our production team will respond within 24 hours with a detailed initial proposal.",
              })}
            </p>

            <div className="space-y-3">
              {/* Headquarters */}
              <div className="contact-pill">
                <div className="f-sans mb-2" style={{ fontSize: "9px", letterSpacing: "3px", color: "var(--red)", textTransform: "uppercase", fontWeight: 700 }}>
                  {t({ ar: "المقر الرئيسي", en: "Main Headquarters" })}
                </div>
                <div className="text-white" style={{ fontSize: "16px", fontWeight: 600 }}>
                  {t({ ar: "المنطقة الشرقية — الدمام", en: "Eastern Province — Dammam" })}
                </div>
                <div className="text-white/55 mt-1" style={{ fontSize: "13px" }}>
                  {t({ ar: "الرياض · جدة · المدينة المنورة", en: "Riyadh · Jeddah · Madinah" })}
                </div>
              </div>

              <div className="contact-pill">
                <div className="f-sans mb-2" style={{ fontSize: "9px", letterSpacing: "3px", color: "var(--red)", textTransform: "uppercase", fontWeight: 700 }}>{t({ ar: "واتساب / جوال", en: "WhatsApp / Mobile" })}</div>
                <a href="https://wa.me/966503422999" target="_blank" rel="noopener noreferrer" className="phone-ltr block text-white hover:opacity-70 transition" style={{ fontSize: "16px", letterSpacing: "0.5px" }}>0503422999</a>
                <a href="https://wa.me/966543553038" target="_blank" rel="noopener noreferrer" className="phone-ltr block text-white hover:opacity-70 transition mt-1" style={{ fontSize: "16px", letterSpacing: "0.5px" }}>0543553038</a>
              </div>

              <div className="contact-pill">
                <div className="f-sans mb-2" style={{ fontSize: "9px", letterSpacing: "3px", color: "var(--red)", textTransform: "uppercase", fontWeight: 700 }}>{t({ ar: "البريد الإلكتروني", en: "Email" })}</div>
                <a href="mailto:info@kianmedia.com" className="block text-white hover:opacity-70 transition" style={{ fontSize: "15px" }}>info@kianmedia.com</a>
                <a href="mailto:sales@kianmedia.com" className="block text-white hover:opacity-70 transition mt-1" style={{ fontSize: "15px" }}>sales@kianmedia.com</a>
              </div>

              <div className="contact-pill">
                <p className="text-white/65" style={{ fontSize: "14px", lineHeight: 1.85, fontWeight: 400 }}>
                  {t({
                    ar: "نخدم جميع مناطق المملكة العربية السعودية، بالإضافة إلى المشاريع والإنتاجات خارج المملكة.",
                    en: "We serve all regions of Saudi Arabia, in addition to projects and productions beyond the Kingdom.",
                  })}
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="https://wa.me/966503422999" target="_blank" rel="noopener noreferrer" className="btn-wa">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                <span>{t({ ar: "واتساب", en: "WhatsApp" })}</span>
              </a>
              <a href="tel:+966503422999" className="btn-ghost">
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
                <select value={form.project} onChange={(e) => update("project", e.target.value)} className="input-field" style={{ background: "#0B0B0B" }}>
                  <option value="" style={{ background: "#0B0B0B" }}>{t({ ar: "اختر النوع...", en: "Select type..." })}</option>
                  {projectTypes.map((p) => <option key={p} value={p} style={{ background: "#0B0B0B" }}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">{t({ ar: "الميزانية", en: "Budget Range" })}</label>
                <select value={form.budget} onChange={(e) => update("budget", e.target.value)} className="input-field" style={{ background: "#0B0B0B" }}>
                  <option value="" style={{ background: "#0B0B0B" }}>{t({ ar: "اختر النطاق...", en: "Select range..." })}</option>
                  {budgetRanges.map((b) => <option key={b} value={b} style={{ background: "#0B0B0B" }}>{b}</option>)}
                </select>
              </div>
              <div className="md:col-span-2 mt-2">
                <label className="input-label">{t({ ar: "تفاصيل المشروع", en: "Project Details" })}</label>
                <textarea value={form.message} onChange={(e) => update("message", e.target.value)} placeholder={t({ ar: "أخبرنا عن مشروعك، الجدول الزمني، والأهداف...", en: "Tell us about your project, timeline, and goals..." })} rows={4} className="input-field" style={{ resize: "vertical" }} />
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3 items-center">
              <button type="submit" className="btn-red">
                <span>{t({ ar: "إرسال عبر واتساب", en: "Send via WhatsApp" })}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "scaleX(-1)" : "none" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>

            <p className="f-sans mt-6" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.3)" }}>
              {t({ ar: "بإرسال النموذج، توافق على تواصلنا بخصوص مشروعك. الردّ خلال ٢٤ ساعة.", en: "By submitting, you agree we'll contact you about your project. Response within 24 hours." })}
            </p>
          </motion.form>
        </div>
      </div>
    </section>
  );
}

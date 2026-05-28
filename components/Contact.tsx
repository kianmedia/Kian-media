"use client";
import { motion } from "framer-motion";
import { useState } from "react";

const PROJECT_TYPES = [
  "Corporate Film",
  "Commercial / Ad",
  "Drone Cinematography",
  "Live Streaming",
  "Event Coverage",
  "Real Estate",
  "Documentary",
  "Wedding",
  "Social Reels",
  "Other",
];

const BUDGET_RANGES = [
  "Under 25,000 SAR",
  "25,000 — 75,000 SAR",
  "75,000 — 200,000 SAR",
  "200,000 — 500,000 SAR",
  "500,000+ SAR",
];

export default function Contact() {
  const [form, setForm] = useState({
    name: "", company: "", phone: "", email: "",
    project: PROJECT_TYPES[0], budget: BUDGET_RANGES[1], message: "",
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Build a WhatsApp message — no backend required
    const msg =
      `طلب عرض إنتاج | Kian Media Proposal Request\n\n` +
      `👤 Name: ${form.name}\n` +
      `🏢 Company: ${form.company}\n` +
      `📞 Phone: ${form.phone}\n` +
      `✉️  Email: ${form.email}\n` +
      `🎬 Project: ${form.project}\n` +
      `💰 Budget: ${form.budget}\n\n` +
      `📝 Message:\n${form.message}`;
    window.open(`https://wa.me/966503422999?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const update = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <section id="contact" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "120px", paddingBottom: "120px" }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 80% 30%, rgba(227,30,36,0.08), transparent 50%)" }} />

      <div className="max-w-6xl mx-auto px-6 lg:px-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">

          {/* Left column: heading + contact info */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5"
            data-reveal
          >
            <div className="eyebrow mb-6">Start Your Project</div>
            <h2 className="editorial text-white mb-6" style={{ fontSize: "clamp(34px,5vw,56px)" }}>
              Let's craft <em>something remarkable</em>.
            </h2>
            <p className="f-arabic text-white/55 mb-10" style={{ fontSize: "16px", lineHeight: 1.9 }}>
              لكل مشروع كبير بداية واحدة — محادثة. أرسل تفاصيل مشروعك وسيرتدّ عليك فريقنا الإنتاجي خلال ٢٤ ساعة بعرض أولي مفصّل.
            </p>

            <div className="space-y-6">
              <div>
                <div className="f-sans mb-1" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase" }}>WhatsApp</div>
                <a href="https://wa.me/966503422999" target="_blank" rel="noopener noreferrer" className="f-sans text-white hover:text-red-500 transition" style={{ fontSize: "18px", letterSpacing: "1px" }}>+966 50 342 2999</a>
              </div>
              <div>
                <div className="f-sans mb-1" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase" }}>Direct Line</div>
                <a href="tel:+966543553038" className="f-sans text-white hover:text-red-500 transition" style={{ fontSize: "18px", letterSpacing: "1px" }}>+966 54 355 3038</a>
              </div>
              <div>
                <div className="f-sans mb-1" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase" }}>Email</div>
                <a href="mailto:info@kianmedia.com" className="f-sans text-white hover:text-red-500 transition" style={{ fontSize: "18px", letterSpacing: "0.5px" }}>info@kianmedia.com</a>
              </div>
              <div>
                <div className="f-sans mb-1" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase" }}>Coverage</div>
                <span className="f-arabic text-white" style={{ fontSize: "16px" }}>المملكة العربية السعودية · ١٣ منطقة</span>
              </div>
            </div>
          </motion.div>

          {/* Right column: form */}
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="lg:col-span-7 glass p-8 lg:p-12"
            data-reveal
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <label className="input-label">Name · الاسم</label>
                <input required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="John Doe" className="input-field" />
              </div>
              <div>
                <label className="input-label">Company · الجهة</label>
                <input value={form.company} onChange={(e) => update("company", e.target.value)} placeholder="Company / Organization" className="input-field" />
              </div>
              <div>
                <label className="input-label">Phone · الجوال</label>
                <input required type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+966 ..." className="input-field" />
              </div>
              <div>
                <label className="input-label">Email · البريد</label>
                <input required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="name@company.com" className="input-field" />
              </div>
              <div>
                <label className="input-label">Project Type · نوع المشروع</label>
                <select value={form.project} onChange={(e) => update("project", e.target.value)} className="input-field" style={{ background: "#050505" }}>
                  {PROJECT_TYPES.map((t) => <option key={t} value={t} style={{ background: "#050505" }}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">Budget Range · الميزانية</label>
                <select value={form.budget} onChange={(e) => update("budget", e.target.value)} className="input-field" style={{ background: "#050505" }}>
                  {BUDGET_RANGES.map((b) => <option key={b} value={b} style={{ background: "#050505" }}>{b}</option>)}
                </select>
              </div>
              <div className="md:col-span-2 mt-2">
                <label className="input-label">Project Details · تفاصيل المشروع</label>
                <textarea value={form.message} onChange={(e) => update("message", e.target.value)} placeholder="Tell us about your project, timeline, and goals..." rows={4} className="input-field" style={{ resize: "vertical" }} />
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3 items-center">
              <button type="submit" className="btn-red">
                <span>Send via WhatsApp</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
              <a href="tel:+966503422999" className="btn-ghost">
                <span>Book a Call</span>
              </a>
            </div>

            <p className="f-sans mt-6" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.3)" }}>
              By submitting, you agree we'll contact you about your project. Response within 24 hours.
            </p>
          </motion.form>
        </div>
      </div>
    </section>
  );
}

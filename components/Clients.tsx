"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

// Client roster — bilingual names. Logos will replace text once provided.
const CLIENTS = [
  { ar: "أرامكو السعودية",                en: "Aramco" },
  { ar: "الشركة السعودية للكهرباء",       en: "Saudi Electricity Company" },
  { ar: "معادن",                          en: "Maaden" },
  { ar: "إثراء",                          en: "Ithra" },
  { ar: "بوبا العربية",                   en: "Bupa Arabia" },
  { ar: "هيئة الأفلام السعودية",          en: "Saudi Film Commission" },
  { ar: "مهرجان أفلام السعودية",          en: "Saudi Film Festival" },
  { ar: "جمعية السينما",                  en: "Cinema Association" },
  { ar: "جامعة الملك فهد للبترول والمعادن", en: "KFUPM" },
  { ar: "وزارة الموارد البشرية",          en: "Ministry of HR & Social Dev." },
  { ar: "أمانة المنطقة الشرقية",          en: "Eastern Province Municipality" },
  { ar: "الإدارة العامة للمرور",          en: "General Directorate of Traffic" },
  { ar: "عاشي وبوشناق",                   en: "Ashi & Bushnaq" },
  { ar: "الشركة السعودية للديزل",         en: "Saudi Diesel Equipment Co." },
  { ar: "جاك موتورز",                     en: "JAC Motors" },
  { ar: "أراسكو",                         en: "ARASCO" },
  { ar: "GAL",                            en: "GAL" },
  { ar: "ندسكو",                          en: "NADSCO" },
  { ar: "دلتا",                           en: "Delta" },
  { ar: "أفكار ذهبية",                    en: "Golden Ideas" },
  { ar: "أدمكس",                          en: "Admex" },
  { ar: "العتيشان القابضة",               en: "Al Otaishan Holding" },
  { ar: "روانة",                          en: "Rawana" },
  { ar: "الدارة",                         en: "Aldarah" },
  { ar: "عدل العقارية",                   en: "Adl Real Estate" },
  { ar: "ريفايفا",                        en: "Reviva" },
  { ar: "كأس الخبر",                      en: "Khobar Cup" },
  { ar: "ميدان الدمام للفروسية",          en: "Dammam Equestrian Field" },
  { ar: "مدينة الدمام العالمية",          en: "Global City Dammam" },
  { ar: "وندر هيلز الجبيل",               en: "Wonder Hills Jubail" },
  { ar: "بوفيه عمر",                      en: "Omar Buffet" },
  { ar: "مطعم أسياخ",                     en: "Asyakh Restaurant" },
  { ar: "عيادات بي كير",                  en: "B Care Clinics" },
  { ar: "عيادات زارا",                    en: "Zara Clinics" },
  { ar: "عيادات شام",                     en: "Sham Clinics" },
  { ar: "مجمع الحقيل الطبي",              en: "Al Hekail Medical" },
  { ar: "جمعية العطاء بالقطيف",           en: "Al Ataa Society — Qatif" },
  { ar: "جمعية اليمامة",                  en: "Al Yamama Society" },
  { ar: "جمعية البر",                     en: "Al Bir Society" },
];

export default function Clients() {
  const { t } = useI18n();
  // Triple for seamless marquee
  const loop = [...CLIENTS, ...CLIENTS, ...CLIENTS];
  return (
    <section className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
          className="text-center mb-16"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "عملاؤنا", en: "Our Clients" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "علامات وجهات", en: "Brands & institutions" })}{" "}
            <em>{t({ ar: "نفخر بإنتاجها", en: "we're proud to have produced for" })}</em>.
          </h2>
          <p className="text-white/45 mt-4" style={{ fontSize: "15px", lineHeight: 1.8, maxWidth: "640px", margin: "16px auto 0" }}>
            {t({
              ar: "أكثر من ٢٠٠٠ عميل من القطاعات الحكومية، الشركات الكبرى، والعلامات التجارية الفاخرة.",
              en: "Over 2,000 clients across government, major corporates, and luxury brands.",
            })}
          </p>
        </motion.div>

        {/* Premium grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
          {CLIENTS.slice(0, 30).map((c, i) => (
            <motion.div
              key={c.en}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: (i % 10) * 0.04 }}
              className="group flex items-center justify-center text-center transition-all duration-500 hover:bg-black"
              style={{ background: "#080808", minHeight: "100px", padding: "16px" }}
            >
              <span className="text-white/40 group-hover:text-white transition-colors duration-500" style={{ fontSize: "13px", fontWeight: 500, lineHeight: 1.3 }}>
                {t({ ar: c.ar, en: c.en })}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Marquee tail with remaining clients */}
        <div className="mt-12 overflow-hidden" style={{ maskImage: "linear-gradient(to right, transparent, black 12%, black 88%, transparent)", WebkitMaskImage: "linear-gradient(to right, transparent, black 12%, black 88%, transparent)" }}>
          <div className="anim-mq" style={{ gap: "48px" }}>
            {loop.slice(30).concat(loop.slice(30)).map((c, i) => (
              <span key={i} className="text-white/35 whitespace-nowrap" style={{ fontSize: "14px", fontWeight: 500 }}>
                {t({ ar: c.ar, en: c.en })}
                <span className="mx-12" style={{ color: "rgba(227,30,36,0.4)" }}>◆</span>
              </span>
            ))}
          </div>
        </div>

        <p className="text-center mt-12 f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
          {t({ ar: "وأكثر من ٢٠٠٠ علامة تجارية وجهة", en: "& over 2,000 brands and institutions" })}
        </p>
      </div>
    </section>
  );
}

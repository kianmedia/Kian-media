// Client roster.
// `hasLogo: true` means a PNG exists at /public/clients/{slug}.png
// Order: Tier 1 → Tier 5 (logos first), then name-only clients at the end.

export type Client = {
  slug: string;
  en: string;
  ar: string;
  hasLogo?: boolean;
};

export const CLIENTS: Client[] = [
  // ─── TIER 1: National giants & government (with logos) ──────────────────
  { slug: "aramco",                en: "Saudi Aramco",                              ar: "أرامكو السعودية",                hasLogo: true },
  { slug: "maaden",                en: "Maaden",                                    ar: "معادن",                          hasLogo: true },
  { slug: "saudi-electricity",     en: "Saudi Electricity",                         ar: "الشركة السعودية للكهرباء",       hasLogo: true },
  { slug: "ithra",                 en: "Ithra",                                     ar: "إثراء",                          hasLogo: true },
  { slug: "royal-commission",      en: "Royal Commission for Jubail & Yanbu",       ar: "الهيئة الملكية للجبيل وينبع",     hasLogo: true },
  { slug: "kfupm",                 en: "King Fahd University of Petroleum & Minerals", ar: "جامعة الملك فهد للبترول والمعادن", hasLogo: true },
  { slug: "traffic-dept",          en: "General Traffic Department",                ar: "الإدارة العامة للمرور",          hasLogo: true },
  { slug: "eastern-municipality",  en: "Eastern Province Municipality",             ar: "أمانة المنطقة الشرقية",          hasLogo: true },

  // ─── TIER 2: Major corporates (with logos) ──────────────────────────────
  { slug: "bupa",                  en: "Bupa Arabia",                               ar: "بوبا العربية",                   hasLogo: true },
  { slug: "arasco",                en: "ARASCO",                                    ar: "أراسكو",                         hasLogo: true },
  { slug: "saudi-diesel",          en: "Saudi Diesel Equipment",                    ar: "الشركة السعودية لمعدات الديزل",  hasLogo: true },
  { slug: "jac-motors",            en: "JAC Motors",                                ar: "جاك موتورز",                     hasLogo: true },
  { slug: "ibn-zahr",              en: "Ibn Zahr",                                  ar: "ابن زهر",                        hasLogo: true },
  { slug: "zid",                   en: "Zid",                                       ar: "شركة زد",                        hasLogo: true },
  { slug: "gal",                   en: "JAL",                                       ar: "شركة جال",                       hasLogo: true },
  { slug: "jabeen",                en: "Jabeen",                                    ar: "شركة جبين",                      hasLogo: true },
  { slug: "alotaishan",            en: "Alotaishan Logistics",                      ar: "العديشان اللوجستية",             hasLogo: true },

  // ─── TIER 3: Real estate, specialized & developers (with logos) ─────────
  { slug: "aldarah",               en: "Aldarah Real Estate Development",           ar: "الدارة للتطوير العقاري",          hasLogo: true },
  { slug: "rowana",                en: "Rowana",                                    ar: "روانا",                          hasLogo: true },
  { slug: "alhekail",              en: "Al-Hekail Group",                           ar: "مجموعة الحقيل",                  hasLogo: true },
  { slug: "reviva",                en: "Reviva",                                    ar: "ريفايفا",                        hasLogo: true },
  { slug: "alzahid-electra",       en: "Al-Zahid Electra",                          ar: "الزاهد إلكترا",                  hasLogo: true },
  { slug: "rafed",                 en: "Rafed",                                     ar: "رافد",                           hasLogo: true },
  { slug: "ashi-bushnaq",          en: "Ashi & Bushnaq",                            ar: "آشي وبشناق",                     hasLogo: true },
  { slug: "almuttahida",           en: "Al-Muttahida Logistics",                    ar: "المتحدة الفاخرة للخدمات اللوجستية", hasLogo: true },
  { slug: "global-city-dammam",    en: "Global City Dammam",                        ar: "المدينة العالمية بالدمام",        hasLogo: true },
  { slug: "shorofat-park",         en: "Shorofat Park",                             ar: "شرفات بارك",                     hasLogo: true },

  // ─── TIER 4: Brands & consumer (with logos) ────────────────────────────
  { slug: "oreo",                  en: "Oreo",                                      ar: "أوريو",                          hasLogo: true },
  { slug: "doritos",               en: "Doritos",                                   ar: "دوريتوز",                        hasLogo: true },
  { slug: "reefi",                 en: "Reefi",                                     ar: "ريفي",                           hasLogo: true },
  { slug: "omar-buffet",           en: "Omar Buffet",                               ar: "بوفية عمر",                       hasLogo: true },
  { slug: "takya",                 en: "Takya",                                     ar: "تكية",                           hasLogo: true },
  { slug: "otto",                  en: "Otto",                                      ar: "شركة أوتو",                       hasLogo: true },
  { slug: "cause",                 en: "Cause Creative",                            ar: "كوز الإبداعية",                   hasLogo: true },
  { slug: "golden-ideas",          en: "Golden Ideas",                              ar: "الأفكار الذهبية",                hasLogo: true },
  { slug: "admex",                 en: "Admex",                                     ar: "أدمكس",                          hasLogo: true },

  // ─── TIER 5: Societies & associations (with logos) ─────────────────────
  { slug: "cinema-association",    en: "Cinema Association",                        ar: "جمعية السينما",                  hasLogo: true },
  { slug: "alataa-qatif",          en: "Al-Ataa Society — Qatif",                   ar: "جمعية العطاء بالقطيف",            hasLogo: true },
  { slug: "alyamama",              en: "Al-Yamamah Society",                        ar: "جمعية اليمامة الأهلية",          hasLogo: true },

  // ═══════════════════════════════════════════════════════════════════════
  // Name-only clients (no logo file yet)
  // ═══════════════════════════════════════════════════════════════════════

  { slug: "esports-world-cup",     en: "Esports World Cup",                         ar: "كأس العالم للرياضات الإلكترونية" },
  { slug: "mokbel-al-khalaf",      en: "Mokbel Al Khalaf Sons Co.",                 ar: "شركة أبناء مقبل الخلف التجارية" },
  { slug: "bateel",                en: "Bateel International",                       ar: "بتيل" },
  { slug: "abunayyan",             en: "Abunayyan Holding",                          ar: "أبو نيان القابضة" },
  { slug: "ardara",                en: "Ardara",                                     ar: "أردارا" },
  { slug: "alshaya",               en: "Alshaya International Co.",                  ar: "الشايع" },
  { slug: "bsf",                   en: "BSF",                                        ar: "البنك السعودي الفرنسي" },
  { slug: "pepsico",               en: "PepsiCo",                                    ar: "بيبسيكو" },
  { slug: "naif-arab-univ",        en: "Naif Arab University for Security Sciences", ar: "جامعة نايف العربية للعلوم الأمنية" },
  { slug: "olayan",                en: "Olayan Financing Company",                   ar: "شركة العليان المالية" },
  { slug: "baja",                  en: "Baja Food Industries",                       ar: "بهجة للصناعات الغذائية" },
  { slug: "egis",                  en: "Egis Saudi Arabia",                          ar: "إيجيس السعودية" },
  { slug: "alayuni",               en: "Al Ayuni Investment & Contracting",          ar: "العيوني للاستثمار والمقاولات" },
  { slug: "schs",                  en: "Saudi Commission for Health Specialties",    ar: "الهيئة السعودية للتخصصات الصحية" },
  { slug: "ceer",                  en: "CEER Motors",                                ar: "سير للسيارات" },
  { slug: "dan-company",           en: "DAN Company",                                ar: "شركة دان" },
  { slug: "rolls-royce",           en: "Rolls-Royce Saudi Arabia",                   ar: "رولز رويس السعودية" },
  { slug: "talemia",               en: "Talemia",                                    ar: "تعلمية" },
  { slug: "tatweer-buildings",     en: "Tatweer for Buildings",                      ar: "تطوير للمباني" },
  { slug: "rafid",                 en: "Rafid – Tatweer Transport",                  ar: "رافد لخدمات النقل" },
  { slug: "tetco",                 en: "TETCO",                                      ar: "تيتكو" },
  { slug: "riyadh-air",            en: "Riyadh Air",                                 ar: "طيران الرياض" },
  { slug: "henkel",                en: "Henkel Arabia",                              ar: "هنكل العربية" },
  { slug: "united-seqa",           en: "United Seqa Group",                          ar: "مجموعة السقا المتحدة" },
  { slug: "hevolution",            en: "Hevolution Foundation",                      ar: "مؤسسة هيفولوشن" },
  { slug: "saudi-film-commission", en: "Saudi Film Commission",                      ar: "هيئة الأفلام السعودية" },
  { slug: "saudi-film-festival",   en: "Saudi Film Festival",                        ar: "مهرجان أفلام السعودية" },
  { slug: "hrsd",                  en: "Ministry of HR & Social Dev.",               ar: "وزارة الموارد البشرية" },
  { slug: "nadsco",                en: "NADSCO",                                     ar: "ندسكو" },
  { slug: "delta",                 en: "Delta",                                      ar: "دلتا" },
  { slug: "adl",                   en: "Adl Real Estate",                            ar: "عدل العقارية" },
  { slug: "khobar-cup",            en: "Khobar Cup",                                 ar: "كأس الخبر" },
  { slug: "dammam-equestrian",     en: "Dammam Equestrian Field",                    ar: "ميدان الدمام للفروسية" },
  { slug: "wonder-hills",          en: "Wonder Hills Jubail",                        ar: "وندر هيلز الجبيل" },
  { slug: "asyakh",                en: "Asyakh Restaurant",                          ar: "مطعم أسياخ" },
  { slug: "bcare",                 en: "B Care Clinics",                             ar: "عيادات بي كير" },
  { slug: "zara-clinics",          en: "Zara Clinics",                               ar: "عيادات زارا" },
  { slug: "sham-clinics",          en: "Sham Clinics",                               ar: "عيادات شام" },
  { slug: "albir",                 en: "Al Bir Society",                             ar: "جمعية البر" },
];

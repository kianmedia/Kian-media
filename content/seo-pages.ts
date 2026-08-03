// ════════════════════════════════════════════════════════════════════════════
// content/seo-pages.ts — the SEO landing system's content layer.
//
// Wave 1 · V2-1.11  (MASTER_BRIEF_v2.1.md §4 WAVE 1)
//
// Six service pages and three city pages, Arabic + English, from ONE data
// source. The route components render this; they hold no copy of their own, so
// a page cannot drift from its translation and there is no per-page component
// to keep in sync.
//
// ⛔ EVERY FACT HERE IS ALREADY ESTABLISHED IN THIS REPOSITORY.
// Nothing was invented. Specifically there are NO client names, NO awards, NO
// ratings, NO project counts per city, NO "trusted by N brands", NO turnaround
// promises and NO pricing. The services come from the portfolio categories and
// the contact form's project types; the geography comes from components/
// Contact.tsx (HQ in Dammam, Eastern Province, and coverage of Riyadh, Jeddah
// and Madinah); the response window comes from the same file.
//
// ⚠️ THE PROSE IS NEW AND UNREVIEWED. It is descriptive rather than
// promotional for exactly that reason, but it is still marketing copy that will
// carry Kian's name in search results. Recorded as PENDING KHALED CONTENT
// REVIEW in the Wave 1 report. Do not treat it as approved.
//
// 🔒 Every page is gated by SHOW_SEO_PAGES (default OFF). While the flag is off
// the routes 404, they are absent from the sitemap, and nothing links to them.
// ════════════════════════════════════════════════════════════════════════════

export type SeoKind = "service" | "city";

export interface SeoPage {
  slug: string;
  kind: SeoKind;
  /** Arabic — the default locale. */
  titleAr: string;
  descriptionAr: string;
  h1Ar: string;
  introAr: string;
  /** Points shown as a list. Descriptive capability, never a claim of outcome. */
  pointsAr: string[];
  /** English mirror. */
  titleEn: string;
  descriptionEn: string;
  h1En: string;
  introEn: string;
  pointsEn: string[];
  /** Portfolio category this page relates to, when one exists. Used to link to
   *  real published work instead of describing work that is not shown. */
  relatedCategory?: string;
}

/**
 * Is the SEO landing system switched on?
 *
 * Default OFF. Read through a function so the value is resolved at call time;
 * NEXT_PUBLIC_* is inlined at build time, so the whole branch is eliminated when
 * the flag is off and the pages cannot be reached, linked or indexed.
 */
export function seoPagesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_SEO_PAGES === "true";
}

// ─── Six service pages ──────────────────────────────────────────────────────

const SERVICES: SeoPage[] = [
  {
    slug: "drone-filming",
    kind: "service",
    relatedCategory: "realestate",
    titleAr: "التصوير الجوي بالدرون في السعودية | كيان ميديا",
    descriptionAr:
      "تصوير جوي بالدرون للمشاريع العقارية والفعاليات والأفلام المؤسسية في المملكة — تخطيط للمسارات الجوية وتنفيذ ميداني ضمن الاشتراطات النظامية.",
    h1Ar: "التصوير الجوي بالدرون",
    introAr:
      "نستخدم التصوير الجوي حين يضيف معنى لا تبلغه الكاميرا الأرضية: مقياس المشروع، وعلاقته بمحيطه، وحركة تربط أجزاءه في لقطة واحدة.",
    pointsAr: [
      "مسارات جوية مخططة مسبقًا لا لقطات عشوائية",
      "دمج اللقطات الجوية مع التصوير الأرضي في سرد واحد",
      "التنفيذ ضمن الاشتراطات النظامية للتصوير الجوي في المملكة",
      "تغطية المشاريع العقارية والفعاليات والأفلام المؤسسية",
    ],
    titleEn: "Aerial & Drone Filming in Saudi Arabia | Kian Media",
    descriptionEn:
      "Aerial drone filming for real-estate projects, events and corporate films across Saudi Arabia — planned flight paths and field execution within the regulatory requirements.",
    h1En: "Aerial & Drone Filming",
    introEn:
      "We use aerial work where it adds something the ground camera cannot reach: the scale of a project, how it sits in its surroundings, and movement that ties its parts together in one shot.",
    pointsEn: [
      "Planned flight paths, not incidental footage",
      "Aerial and ground coverage cut into a single narrative",
      "Executed within the Kingdom's regulatory requirements for aerial filming",
      "Real-estate projects, events and corporate films",
    ],
  },
  {
    slug: "live-streaming",
    kind: "service",
    relatedCategory: "events",
    titleAr: "البث المباشر للفعاليات في السعودية | كيان ميديا",
    descriptionAr:
      "بث مباشر متعدد الكاميرات للمؤتمرات والفعاليات والافتتاحات — إخراج مباشر وخطة اتصال احتياطية وتسليم التسجيل بعد الحدث.",
    h1Ar: "البث المباشر",
    introAr:
      "البث المباشر لا يقبل إعادة. لذلك يبدأ العمل قبل يوم الحدث: معاينة الموقع، وخطة الكاميرات، واتصال احتياطي مستقل عن الشبكة الأساسية.",
    pointsAr: [
      "إخراج مباشر متعدد الكاميرات",
      "خطة اتصال احتياطية مستقلة",
      "معاينة الموقع قبل يوم الحدث",
      "تسليم التسجيل الكامل بعد انتهاء البث",
    ],
    titleEn: "Live Event Streaming in Saudi Arabia | Kian Media",
    descriptionEn:
      "Multi-camera live streaming for conferences, events and openings — live direction, an independent backup connection, and the full recording delivered afterwards.",
    h1En: "Live Streaming",
    introEn:
      "A live broadcast gets no second take. So the work starts before the day: a site survey, a camera plan, and a backup connection that does not depend on the venue's main network.",
    pointsEn: [
      "Multi-camera live direction",
      "Independent backup connectivity",
      "Site survey ahead of the event day",
      "Full recording delivered after the broadcast",
    ],
  },
  {
    slug: "real-estate-videography",
    kind: "service",
    relatedCategory: "realestate",
    titleAr: "التصوير العقاري السينمائي | كيان ميديا",
    descriptionAr:
      "تصوير عقاري للمشاريع والفلل ونماذج العرض — جولات كاميرا متصلة وتصوير جوي وأرضي يُظهر المساحات والتشطيب كما هي.",
    h1Ar: "التصوير العقاري",
    introAr:
      "المشتري يقرأ المساحة قبل أن يقرأ الوصف. نصوّر المشروع بحركة متصلة تقود المشاهد عبر المكان بدل أن تعرضه لقطات منفصلة.",
    pointsAr: [
      "جولات كاميرا متصلة داخل المساحات",
      "دمج التصوير الجوي والأرضي",
      "إضاءة تُظهر الخامات والتشطيب دون مبالغة",
      "توثيق مراحل الإنشاء عند الحاجة",
    ],
    titleEn: "Real Estate Videography | Kian Media",
    descriptionEn:
      "Real-estate video for projects, villas and show units — continuous camera tours plus aerial and ground coverage that show the spaces and the finish as they are.",
    h1En: "Real Estate Videography",
    introEn:
      "A buyer reads the space before they read the description. We shoot in continuous movement that walks the viewer through a property, rather than a run of disconnected shots.",
    pointsEn: [
      "Continuous camera tours through the spaces",
      "Aerial and ground coverage combined",
      "Lighting that shows materials and finish without overstating them",
      "Construction-progress documentation where needed",
    ],
  },
  {
    slug: "corporate-films",
    kind: "service",
    relatedCategory: "corporate",
    titleAr: "إنتاج الأفلام المؤسسية | كيان ميديا",
    descriptionAr:
      "أفلام مؤسسية وتعريفية للشركات والجهات الحكومية — من كتابة المعالجة إلى التصوير والمونتاج والتسليم النهائي.",
    h1Ar: "الأفلام المؤسسية",
    introAr:
      "الفيلم المؤسسي ليس عرضًا للمنشأة، بل ترجمة لما تفعله الجهة إلى لغة بصرية يفهمها من لا يعرفها.",
    pointsAr: [
      "معالجة مكتوبة قبل التصوير لا ارتجال في الموقع",
      "هوية بصرية متسقة عبر أعمال الجهة الواحدة",
      "تصوير المقابلات والعمليات الميدانية",
      "نسخ متعددة المدد للمنصات المختلفة عند الطلب",
    ],
    titleEn: "Corporate Film Production | Kian Media",
    descriptionEn:
      "Corporate and profile films for companies and government entities — from written treatment through filming, edit and final delivery.",
    h1En: "Corporate Films",
    introEn:
      "A corporate film is not a tour of the premises. It translates what an organisation actually does into a visual language someone outside it can follow.",
    pointsEn: [
      "A written treatment before the shoot, not improvisation on location",
      "A consistent visual identity across an organisation's work",
      "Interview and operational field coverage",
      "Multiple durations for different platforms on request",
    ],
  },
  {
    slug: "documentary-production",
    kind: "service",
    relatedCategory: "documentary",
    titleAr: "إنتاج الأفلام الوثائقية | كيان ميديا",
    descriptionAr:
      "إنتاج وثائقي يوثّق المواقع التاريخية والحرف والقصص المحلية — بحث ميداني وتصوير وسرد بصري متكامل.",
    h1Ar: "الأفلام الوثائقية",
    introAr:
      "الوثائقي عمل بحث قبل أن يكون عمل كاميرا. نبدأ بما يمكن إثباته عن الموضوع، ثم نبني الصورة على ذلك.",
    pointsAr: [
      "بحث ميداني قبل التصوير",
      "توثيق المواقع والحرف قبل أن تتغيّر ملامحها",
      "سرد بصري يعتمد المكان والشهادات",
      "أرشفة المادة الخام للرجوع إليها لاحقًا",
    ],
    titleEn: "Documentary Production | Kian Media",
    descriptionEn:
      "Documentary production recording heritage sites, crafts and local stories — field research, filming and a complete visual narrative.",
    h1En: "Documentary Production",
    introEn:
      "A documentary is research before it is camera work. We start from what can be established about the subject, then build the picture on that.",
    pointsEn: [
      "Field research before filming",
      "Recording sites and crafts before their features change",
      "A narrative carried by place and testimony",
      "Raw material archived for later reference",
    ],
  },
  {
    slug: "podcast-production",
    kind: "service",
    relatedCategory: "corporate",
    titleAr: "إنتاج البودكاست | كيان ميديا",
    descriptionAr:
      "إنتاج بودكاست متعدد الكاميرات — تجهيز الاستوديو والصوت والتصوير والمونتاج ومقاطع قصيرة للمنصات.",
    h1Ar: "إنتاج البودكاست",
    introAr:
      "البودكاست سلسلة لا حلقة. نجهّز الإعداد مرة واحدة بحيث تُصوَّر الحلقات التالية بنفس الجودة ونفس الإيقاع.",
    pointsAr: [
      "تجهيز استوديو ثابت قابل للتكرار عبر الحلقات",
      "تسجيل صوت منفصل لكل متحدث",
      "تصوير متعدد الكاميرات",
      "استخراج مقاطع قصيرة عمودية من كل حلقة",
    ],
    titleEn: "Podcast Production | Kian Media",
    descriptionEn:
      "Multi-camera podcast production — studio and audio setup, filming, edit, and short vertical cuts for social platforms.",
    h1En: "Podcast Production",
    introEn:
      "A podcast is a series, not an episode. We build the setup once so later episodes are shot at the same quality and the same rhythm.",
    pointsEn: [
      "A repeatable studio setup across episodes",
      "Separate audio capture per speaker",
      "Multi-camera filming",
      "Short vertical cuts pulled from every episode",
    ],
  },
];

// ─── Three city pages ───────────────────────────────────────────────────────
//
// ⚠️ These describe SERVICE COVERAGE, not offices. components/Contact.tsx
// establishes one headquarters — Eastern Province, Dammam — and lists Riyadh,
// Jeddah and Madinah alongside it. Claiming a branch in a city we have not
// established one in would be a fabricated credential, so the wording is
// "we work in", never "our office in".

const CITIES: SeoPage[] = [
  {
    slug: "riyadh",
    kind: "city",
    titleAr: "إنتاج الفيديو في الرياض | كيان ميديا",
    descriptionAr:
      "خدمات إنتاج الفيديو في الرياض: أفلام مؤسسية، إعلانات، تغطية فعاليات، بث مباشر وتصوير جوي — فريق ينتقل بمعداته إلى موقع التصوير.",
    h1Ar: "إنتاج الفيديو في الرياض",
    introAr:
      "نعمل في الرياض بفريق ومعدات تنتقل إلى موقع التصوير. المقر الرئيسي في الدمام، والتغطية تشمل الرياض ضمن نطاق عملنا في المملكة.",
    pointsAr: [
      "أفلام مؤسسية وتعريفية",
      "تغطية المؤتمرات والفعاليات",
      "بث مباشر متعدد الكاميرات",
      "تصوير جوي بالدرون ضمن الاشتراطات النظامية",
    ],
    titleEn: "Video Production in Riyadh | Kian Media",
    descriptionEn:
      "Video production services in Riyadh: corporate films, commercials, event coverage, live streaming and aerial filming — a crew that travels to the location with its equipment.",
    h1En: "Video Production in Riyadh",
    introEn:
      "We work in Riyadh with a crew and equipment that travel to the location. The headquarters is in Dammam, and Riyadh sits within our coverage across the Kingdom.",
    pointsEn: [
      "Corporate and profile films",
      "Conference and event coverage",
      "Multi-camera live streaming",
      "Aerial drone filming within the regulatory requirements",
    ],
  },
  {
    slug: "jeddah",
    kind: "city",
    titleAr: "إنتاج الفيديو في جدة | كيان ميديا",
    descriptionAr:
      "خدمات إنتاج الفيديو في جدة: أفلام مؤسسية، إعلانات تجارية، تغطية فعاليات، بث مباشر وتصوير عقاري.",
    h1Ar: "إنتاج الفيديو في جدة",
    introAr:
      "نغطي جدة ضمن نطاق عملنا في المملكة، بفريق ومعدات تنتقل إلى الموقع. المقر الرئيسي في الدمام.",
    pointsAr: [
      "أفلام مؤسسية وإعلانات تجارية",
      "تغطية الفعاليات والافتتاحات",
      "تصوير عقاري جوي وأرضي",
      "بث مباشر للمؤتمرات",
    ],
    titleEn: "Video Production in Jeddah | Kian Media",
    descriptionEn:
      "Video production services in Jeddah: corporate films, commercials, event coverage, live streaming and real-estate videography.",
    h1En: "Video Production in Jeddah",
    introEn:
      "Jeddah sits within our coverage across the Kingdom, served by a crew and equipment that travel to the location. The headquarters is in Dammam.",
    pointsEn: [
      "Corporate films and commercials",
      "Event and opening coverage",
      "Aerial and ground real-estate filming",
      "Live streaming for conferences",
    ],
  },
  {
    slug: "dammam",
    kind: "city",
    titleAr: "إنتاج الفيديو في الدمام والمنطقة الشرقية | كيان ميديا",
    descriptionAr:
      "المقر الرئيسي لكيان ميديا في الدمام — إنتاج فيديو سينمائي وأفلام مؤسسية وتغطية فعاليات وبث مباشر وتصوير جوي في المنطقة الشرقية.",
    h1Ar: "إنتاج الفيديو في الدمام والمنطقة الشرقية",
    introAr:
      "الدمام هي المقر الرئيسي لكيان ميديا. من هنا تنطلق فرق التصوير إلى مواقع العمل في المنطقة الشرقية وبقية مناطق المملكة.",
    pointsAr: [
      "المقر الرئيسي وفرق التصوير",
      "أفلام مؤسسية وإعلانات",
      "تغطية الفعاليات والبث المباشر",
      "تصوير عقاري وجوي",
    ],
    titleEn: "Video Production in Dammam & the Eastern Province | Kian Media",
    descriptionEn:
      "Kian Media's headquarters is in Dammam — cinematic video production, corporate films, event coverage, live streaming and aerial filming across the Eastern Province.",
    h1En: "Video Production in Dammam & the Eastern Province",
    introEn:
      "Dammam is Kian Media's headquarters. Crews deploy from here to locations across the Eastern Province and the rest of the Kingdom.",
    pointsEn: [
      "Headquarters and production crews",
      "Corporate films and commercials",
      "Event coverage and live streaming",
      "Real-estate and aerial filming",
    ],
  },
];

export const SEO_PAGES: SeoPage[] = [...SERVICES, ...CITIES];

export const seoPageBySlug = (kind: SeoKind, slug: string): SeoPage | undefined =>
  SEO_PAGES.find((p) => p.kind === kind && p.slug === slug);

export const seoPagesOfKind = (kind: SeoKind): SeoPage[] =>
  SEO_PAGES.filter((p) => p.kind === kind);

/** URL path for a page in a locale. Services live under /services, cities under /cities. */
export function seoPagePath(page: SeoPage, locale: "ar" | "en" = "ar"): string {
  const base = page.kind === "service" ? `/services/${page.slug}` : `/cities/${page.slug}`;
  return locale === "ar" ? base : `/en${base}`;
}

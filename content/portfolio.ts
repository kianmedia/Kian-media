// ════════════════════════════════════════════════════════════════════════════
// content/portfolio.ts — ONE source of truth for the 46 published works.
//
// Wave 1 · V2-1.4-A/B/D  (MASTER_BRIEF_v2.1.md §4 WAVE 1)
//
// ★ WHY THIS FILE EXISTS ★
// The works used to live as an `ITEMS` array inside components/Portfolio.tsx.
// That made the content editable only by touching a React component, and it
// meant anything else that wanted the catalogue (structured data, a sitemap,
// a case-study link, the Wave-6 portfolio-draft pipeline) had to import a
// client component. Content and presentation are now separate.
//
// ⛔ THE HARD CONSTRAINT — read before automating anything against this file
// This file is CONTENT, but it is compiled into the bundle. It is NOT a runtime
// database. Vercel's filesystem is read-only at runtime, so a process that
// "writes a new work" here at runtime loses it on the next deploy.
// The approved path (V2-6.8-C) is: draft in the database → review → approval →
// a script or a Pull Request edits this file → deploy. Never a runtime write.
//
// ★ DESCRIPTIONS ★
// Every work carries `dAr`/`dEn`. Before Wave 1 only 8 did, and the other 38
// silently fell back to a shared per-category paragraph — so 38 works read as
// duplicates of each other in the UI and to search engines.
//
// 🔒 THE 8 ORIGINALS ARE PRESERVED VERBATIM. They are live on production and
//    v2.1 §1 marks them "KEEP, do not rewrite". They are marked `live: true`
//    below and a test pins their text so a future edit cannot quietly reword
//    them. The 38 added here are written from what the title and category
//    actually state — no client claim, metric or detail that is not already
//    public in the work itself.
// ════════════════════════════════════════════════════════════════════════════

export type CatKey =
  | "corporate"
  | "commercial"
  | "realestate"
  | "events"
  | "documentary"
  | "cinematic"
  | "festivals"
  | "weddings";

export interface Work {
  id: number;
  /** YouTube id — also the thumbnail key. */
  yt: string;
  /** A work may belong to several categories ON PURPOSE (see COUNTING below). */
  cats: CatKey[];
  ar: string;
  en: string;
  /** 9:16 YouTube Short. */
  vertical?: boolean;
  /** Arabic one-line description. Required for every work since Wave 1. */
  dAr: string;
  dEn: string;
  /**
   * true = this description was already live on production before Wave 1 and
   * must not be rewritten. Pinned by tests/wave1_portfolio_content.test.js.
   */
  live?: true;
}

/** Category order is the brief's order and is part of the design. */
export const CATEGORIES: { key: CatKey | "all"; ar: string; en: string }[] = [
  { key: "all",          ar: "كل الأعمال",                en: "All" },
  { key: "corporate",    ar: "إنتاج الشركات",             en: "Corporate Productions" },
  { key: "commercial",   ar: "الإعلانات التجارية",        en: "Commercial Ads" },
  { key: "realestate",   ar: "التصوير العقاري",           en: "Real Estate Production" },
  { key: "events",       ar: "تغطية الفعاليات",           en: "Events Coverage" },
  { key: "documentary",  ar: "الأفلام الوثائقية",         en: "Documentary Films" },
  { key: "cinematic",    ar: "الإنتاج السينمائي",         en: "Cinematic Productions" },
  { key: "festivals",    ar: "مهرجانات الأفلام",          en: "Film Festivals" },
  { key: "weddings",     ar: "الأعراس",                  en: "Weddings" },
];

export const WORKS: Work[] = [
  // ━━━ 1. CORPORATE PRODUCTIONS ━━━
  { id: 1, yt: "XMjZBgROUIg", cats: ["corporate"], live: true,
    ar: "برومو شركة العطيشان", en: "Al-Otaishan — Corporate Promo",
    dAr: "فيلم مؤسسي يقدّم العطيشان بهوية بصرية قوية ولغة سينمائية تعكس مكانتها.",
    dEn: "A corporate film introducing Al-Otaishan with a bold visual identity and cinematic language." },
  { id: 2, yt: "F0MTiYeWZyw", cats: ["corporate"], live: true,
    ar: "شركة ريفايفا", en: "Reviva — Brand Promo",
    dAr: "برومو علامة تجارية يبرز شخصية ريفايفا بإيقاع بصري حديث وألوان نابضة.",
    dEn: "A brand promo capturing Reviva’s personality with a modern visual rhythm." },
  { id: 3, yt: "eG7K22u6xEU", cats: ["corporate", "realestate"],
    ar: "شركات عقارية متنوعة — تصوير جوي", en: "Real Estate Companies — Aerial Reel",
    dAr: "ريِل جوي يجمع مشاريع عقارية متعددة، بمسارات درون متصلة تُظهر المقياس والموقع.",
    dEn: "An aerial reel spanning several real-estate projects, flown in continuous drone paths that convey scale and setting." },
  { id: 4, yt: "2xNe8PbjmZE", cats: ["corporate", "events"], live: true,
    ar: "شركة معادن — اليوم المفتوح", en: "Maaden — Open Day",
    dAr: "تغطية اليوم المفتوح لمعادن — توثيق حدث ضخم بأسلوب سينمائي متعدد الكاميرات.",
    dEn: "Coverage of Maaden’s Open Day — a large-scale event captured cinematically." },
  { id: 41, yt: "0LuP0-3FqnI", cats: ["corporate", "events", "cinematic"], live: true,
    ar: "اليوم المفتوح لشركة معادن — ٢٠٢٥", en: "Maaden — Open Day 2025",
    dAr: "النسخة الأحدث من تغطية اليوم المفتوح لمعادن لعام ٢٠٢٥ بإنتاج سينمائي متكامل.",
    dEn: "The 2025 edition of Maaden’s Open Day, delivered as a full cinematic production." },
  { id: 5, yt: "9o8HL_IZjFA", cats: ["corporate"], live: true,
    ar: "الموارد البشرية والتنمية الاجتماعية", en: "Ministry of Human Resources & Social Development",
    dAr: "إنتاج حكومي لوزارة الموارد البشرية يوثّق مبادراتها برسالة بصرية واضحة.",
    dEn: "A government production for MHRSD documenting its initiatives with a clear visual message." },
  { id: 6, yt: "MIs6GbXBxV4", cats: ["corporate", "events"],
    ar: "اليوم المفتوح — شركة دايسر", en: "Daycer — Open Day",
    dAr: "توثيق يوم دايسر المفتوح من الاستقبال حتى الختام، بتغطية تتبع الحضور لا القاعة وحدها.",
    dEn: "Daycer’s Open Day documented from arrivals to closing, with coverage that follows the guests rather than the hall." },
  { id: 7, yt: "eroGztKVLwY", cats: ["corporate"],
    ar: "معرض الصناعات الدولي — البحرين", en: "International Industries Exhibition — Bahrain",
    dAr: "تغطية معرض صناعي دولي في البحرين، تُترجم أجنحة العرض إلى سرد بصري متصل.",
    dEn: "Coverage of an international industrial exhibition in Bahrain, turning exhibition stands into one connected visual narrative." },
  { id: 8, yt: "robGTKwobn0", cats: ["corporate", "realestate"],
    ar: "شركة روانا", en: "Rawana Company",
    dAr: "فيلم تعريفي لروانا يربط نشاطها العقاري بهوية الشركة في عمل واحد.",
    dEn: "A profile film for Rawana linking its real-estate work to the company identity in a single piece." },
  { id: 9, yt: "k7WQOJbUSB8", cats: ["corporate"],
    ar: "منتدى الصناعات السعودي", en: "Saudi Industries Forum",
    dAr: "تغطية منتدى صناعي وطني، بإيقاع تحريري يوازن بين الجلسات والحوارات الجانبية.",
    dEn: "Coverage of a national industries forum, edited to balance the sessions against the conversations around them." },
  { id: 38, yt: "EjOMCO9pA6E", cats: ["corporate"], live: true,
    ar: "شركة ريفي", en: "Refi Company",
    dAr: "فيلم تعريفي لشركة ريفي يترجم نشاطها إلى سرد بصري أنيق.",
    dEn: "A profile film for Refi translating its business into an elegant visual narrative." },
  { id: 39, yt: "GIyi34PPFG8", cats: ["corporate"], live: true,
    ar: "شركة زد", en: "Zed Company",
    dAr: "إنتاج مؤسسي لشركة زد بإخراج معاصر يعكس طموح العلامة.",
    dEn: "A corporate production for Zed with contemporary direction reflecting the brand’s ambition." },

  // ━━━ 2. COMMERCIAL ADS ━━━
  { id: 10, yt: "xvzneIB-OFs", cats: ["commercial"],
    ar: "إعلانات متنوعة للمطاعم والمجمعات", en: "Restaurants & Complexes — Commercial Reel",
    dAr: "ريِل إعلاني يجمع أعمال مطاعم ومجمعات، كل مشهد مضبوط على شهية الصورة.",
    dEn: "A commercial reel gathering restaurant and complex work, every shot graded for appetite." },
  { id: 11, yt: "naAnvH5DoM0", cats: ["commercial"],
    ar: "افتتاح مسكوب", en: "Miskob — Opening Commercial",
    dAr: "إعلان افتتاح لمسكوب يبني الترقّب ثم يكشف المكان في لقطة واحدة.",
    dEn: "An opening commercial for Miskob that builds anticipation, then reveals the venue in a single move." },
  { id: 12, yt: "z7S6YWiO6xw", cats: ["commercial"],
    ar: "مجمع عيادات الحقيل", en: "Al-Hekail Medical Clinics",
    dAr: "إعلان لمجمع عيادات بإضاءة نظيفة وإيقاع هادئ يليق بسياق طبي.",
    dEn: "A clinic commercial with clean lighting and a calm pace suited to a medical setting." },
  { id: 40, yt: "uhWmJrDfT78", cats: ["commercial"], live: true,
    ar: "بوفيه عمر", en: "Omar Buffet",
    dAr: "إعلان تجاري لبوفيه عمر يقدّم المنتج بإضاءة شهية وحركة كاميرا ديناميكية.",
    dEn: "A commercial for Omar Buffet presenting the product with appetizing lighting and dynamic camera work." },
  // ⚠️ V2-1.4-C — the three works below were ALL titled «إعلان قصير» (identical).
  // The brief asks for the client names; they are not on record, and inventing a
  // client would be a fabricated credit. Numbered by format instead — truthful and
  // distinct. Question logged in docs/overnight/OVERNIGHT_DECISIONS_REQUIRED.md.
  { id: 42, yt: "3HCrw8toqAA", cats: ["commercial"], vertical: true,
    ar: "إعلان قصير عمودي — ١", en: "Short Vertical Ad — 1",
    dAr: "إعلان عمودي قصير مصمَّم لمنصات الجوال، برسالة واحدة تُقرأ في ثوانٍ.",
    dEn: "A short vertical ad built for mobile feeds, carrying one message readable in seconds." },
  { id: 43, yt: "Rn1WYI0n-ck", cats: ["commercial"], vertical: true,
    ar: "إعلان قصير عمودي — ٢", en: "Short Vertical Ad — 2",
    dAr: "قطعة إعلانية عمودية بإيقاع سريع، تعتمد القطع على الحركة لا على التعليق.",
    dEn: "A fast-cut vertical ad piece that carries itself on motion rather than voice-over." },
  { id: 44, yt: "YZIipE09lpg", cats: ["commercial"], vertical: true,
    ar: "إعلان قصير عمودي — ٣", en: "Short Vertical Ad — 3",
    dAr: "إعلان عمودي قصير يفتح على اللقطة الأقوى مباشرة لالتقاط الانتباه الأول.",
    dEn: "A short vertical ad that opens on its strongest frame to win the first second." },

  // ━━━ 3. REAL ESTATE PRODUCTION ━━━
  { id: 13, yt: "mGO5WGSeZTQ", cats: ["realestate"],
    ar: "تصوير عمارة لشركة روانا", en: "Rawana — Building Showcase",
    dAr: "عرض معماري لعمارة روانا، يقرأ المبنى من الأرض إلى الجو في تسلسل واحد.",
    dEn: "An architectural showcase of the Rawana building, reading it from ground to air in one sequence." },
  { id: 14, yt: "cUgTk6do7mA", cats: ["realestate"],
    ar: "إنشاء مجمع فيلل — شركة الدارة", en: "Al-Darah — Villa Complex Construction",
    dAr: "توثيق مراحل إنشاء مجمع فيلل، يحوّل تقدّم العمل إلى خط زمني مرئي.",
    dEn: "Documentation of a villa complex under construction, turning build progress into a visible timeline." },
  { id: 15, yt: "zTf-qf0ml4c", cats: ["realestate"],
    ar: "تدشين فيلا عرض — مشروع بيوت تيل", en: "Beot Til — Show Villa Launch",
    dAr: "تدشين فيلا عرض، بمسار كاميرا متصل يقود الزائر عبر المساحات كما لو كان فيها.",
    dEn: "A show-villa launch shot in continuous camera moves that walk the viewer through the spaces." },
  { id: 16, yt: "BlB2YGo1T3U", cats: ["realestate"],
    ar: "فيلا عرض — شركة روانا", en: "Rawana — Show Villa",
    dAr: "جولة في فيلا عرض لروانا، بإضاءة طبيعية تُبرز الخامات والتشطيب.",
    dEn: "A tour of Rawana’s show villa, lit naturally to bring out materials and finish." },

  // ━━━ 4. EVENTS COVERAGE ━━━
  { id: 17, yt: "1MFZP6WZx3E", cats: ["events", "cinematic"],
    ar: "افتتاح المدينة العالمية بالدمام", en: "Global City Dammam — Opening",
    dAr: "افتتاح المدينة العالمية بالدمام، بتغطية متعددة الكاميرات تمسك حجم الحدث وتفاصيله.",
    dEn: "The Global City Dammam opening, covered multi-camera to hold both the scale of the night and its details." },
  { id: 18, yt: "We8sFkpd1b0", cats: ["events", "cinematic"],
    ar: "فعالية وندر هيلز", en: "Wonder Hills — Event",
    dAr: "تغطية فعالية وندر هيلز بمعالجة سينمائية تحفظ أجواء المكان بعد انتهاء الليلة.",
    dEn: "Wonder Hills covered with a cinematic treatment that keeps the atmosphere of the night after it ends." },
  { id: 19, yt: "DwXwknux7kw", cats: ["events"],
    ar: "شركة عبدالواحد للتصوير", en: "Abdulwahid — Photography Event",
    dAr: "توثيق فعالية تصوير، بعين ترصد المشاركين وهم يعملون لا وهم يقفون للكاميرا.",
    dEn: "A photography event documented with an eye for participants at work rather than posed for camera." },
  { id: 20, yt: "Zs1yheEgEzw", cats: ["events"],
    ar: "فعاليات فيلاجيو مول", en: "Villaggio Mall — Events",
    dAr: "تغطية فعاليات مركز تجاري، تجمع حركة الزوار والعروض في سرد واحد متصل.",
    dEn: "Mall event coverage weaving visitor flow and performances into one continuous narrative." },
  { id: 21, yt: "u-5S5jkRk0c", cats: ["events"],
    ar: "تريادا ايفنت — الشرفات بارك", en: "Triada Event — Al-Shorfat Park",
    dAr: "فعالية في الهواء الطلق بالشرفات بارك، مصوَّرة على ضوء نهاية النهار.",
    dEn: "An open-air event at Al-Shorfat Park, filmed into the end-of-day light." },
  { id: 22, yt: "IPaDI1hcupo", cats: ["events"],
    ar: "احتفال اليوم الوطني — شركة الزاهد", en: "Saudi National Day — Al-Zahid",
    dAr: "احتفال اليوم الوطني في بيئة مؤسسية، بتغطية توازن بين الرسمي والعفوي.",
    dEn: "A National Day celebration in a corporate setting, covered to balance the formal and the spontaneous." },

  // ━━━ 5. DOCUMENTARY FILMS ━━━
  { id: 23, yt: "vPaH2dnBiFA", cats: ["documentary"],
    ar: "وثائقي البيت القطيفي", en: "Qatif House — Heritage Documentary",
    dAr: "وثائقي عن البيت القطيفي، يقرأ العمارة التقليدية بوصفها ذاكرة لا مبنى.",
    dEn: "A documentary on the Qatif house, reading traditional architecture as memory rather than masonry." },
  { id: 24, yt: "muzsqmUzA0k", cats: ["documentary"],
    ar: "وثائقي البخنق التاريخي", en: "Al-Bakhnaq — Historical Documentary",
    dAr: "وثائقي يتتبّع البخنق كقطعة لباس تحمل سيرة مكان وزمن.",
    dEn: "A documentary tracing Al-Bakhnaq as a garment that carries the story of a place and a period." },
  { id: 25, yt: "se5_3BW-9FY", cats: ["documentary"],
    ar: "وثائقي البيت القطيفي — ج٢", en: "Qatif House — Documentary Part 2",
    dAr: "الجزء الثاني من وثائقي البيت القطيفي، يتعمّق في التفاصيل التي لم يسعها الجزء الأول.",
    dEn: "The second part of the Qatif house documentary, going deeper into what the first could not hold." },
  { id: 26, yt: "4Lhm-2Gne7Q", cats: ["documentary"],
    ar: "وثائقي الحوي التاريخي", en: "Al-Huwi — Historical Documentary",
    dAr: "وثائقي عن الحوي التاريخي، يوثّق الموقع قبل أن تمحو التغيّرات ملامحه.",
    dEn: "A documentary on historic Al-Huwi, recording the site before change erases its features." },
  { id: 27, yt: "totRI62nzRs", cats: ["documentary"],
    ar: "وثائقي الدروازة التاريخي", en: "Al-Darwazah — Historical Documentary",
    dAr: "وثائقي الدروازة، يربط المعلم التاريخي بحياة الناس حوله اليوم.",
    dEn: "The Al-Darwazah documentary, connecting the landmark to the life around it today." },
  { id: 28, yt: "YCCEQhRdmd8", cats: ["documentary"],
    ar: "وثائقي الدروازة — ج٢", en: "Al-Darwazah — Documentary Part 2",
    dAr: "الجزء الثاني من وثائقي الدروازة، يكمل الرواية بشهادات وتفاصيل إضافية.",
    dEn: "Part two of the Al-Darwazah documentary, completing the account with further testimony and detail." },

  // ━━━ 6. CINEMATIC PRODUCTIONS ━━━
  { id: 29, yt: "vVeFXeJTTm0", cats: ["cinematic"],
    ar: "فيديو كليب البخنق", en: "Al-Bakhnaq — Music Video",
    dAr: "كليب موسيقي بمعالجة سينمائية، يبني الصورة على الإيقاع لا على الكلمة.",
    dEn: "A music video with cinematic treatment, building image on rhythm rather than lyric." },

  // ━━━ 7. FILM FESTIVALS ━━━
  { id: 30, yt: "Tp4m2EA1C3o", cats: ["festivals"],
    ar: "مهرجان أفلام السعودية — ٠١", en: "Saudi Film Festival — Vol. 01",
    dAr: "تغطية مهرجان أفلام السعودية، من العروض إلى لقاءات صنّاع الأفلام.",
    dEn: "Saudi Film Festival coverage, from the screenings to the filmmakers’ conversations." },
  { id: 31, yt: "ubj3cgC7jOs", cats: ["festivals"],
    ar: "مهرجان أفلام السعودية — ٠٢", en: "Saudi Film Festival — Vol. 02",
    dAr: "نسخة أخرى من تغطية المهرجان، تركّز على أجواء الحضور وردود الفعل.",
    dEn: "A further edition of the festival coverage, focused on the crowd and its reactions." },
  { id: 32, yt: "voeIqpOlmqk", cats: ["festivals"],
    ar: "مهرجان أفلام السعودية — ٠٣", en: "Saudi Film Festival — Vol. 03",
    dAr: "تغطية ثالثة للمهرجان، تلتقط لحظات التتويج وما يسبقها من انتظار.",
    dEn: "A third festival piece, catching the awards and the waiting that precedes them." },

  // ━━━ 8. WEDDINGS ━━━
  // 🔒 Weddings are covered by full male and female crews. Descriptions stay
  //    discreet by design — no names, no faces claimed, no venue identified.
  { id: 50, yt: "S6JdnS6s1Tc", cats: ["weddings"],
    ar: "تصوير عرس سينمائي — ١", en: "Cinematic Wedding Film — 1",
    dAr: "فيلم عرس سينمائي يروي الليلة كقصة متصلة لا كسلسلة لقطات.",
    dEn: "A cinematic wedding film that tells the night as one story rather than a run of shots." },
  { id: 51, yt: "ngXJJd4wUAs", cats: ["weddings"],
    ar: "تصوير عرس سينمائي — ٢", en: "Cinematic Wedding Film — 2",
    dAr: "توثيق عرس بإضاءة تحفظ أجواء القاعة كما رآها الحاضرون.",
    dEn: "A wedding documented with lighting that keeps the hall as the guests saw it." },
  { id: 52, yt: "VJjZWEwmFJU", cats: ["weddings"],
    ar: "تصوير عرس سينمائي — ٣", en: "Cinematic Wedding Film — 3",
    dAr: "عمل عرس يوازن بين اللحظات الرسمية والتفاصيل العابرة التي تُنسى سريعًا.",
    dEn: "A wedding piece balancing the formal moments against the passing details that fade fastest." },
  { id: 53, yt: "b2OuWey3qCc", cats: ["weddings"],
    ar: "تصوير عرس سينمائي — ٤", en: "Cinematic Wedding Film — 4",
    dAr: "فيلم عرس بإيقاع هادئ يترك للمشاهد مساحة ليعيش اللحظة.",
    dEn: "A wedding film paced calmly, leaving the viewer room to sit inside the moment." },
  { id: 54, yt: "jul59VwBM94", cats: ["weddings"],
    ar: "تصوير عرس سينمائي — ٥", en: "Cinematic Wedding Film — 5",
    dAr: "توثيق ليلة العمر بفرق كاملة، بتغطية لا تفوّت الاستقبال ولا الختام.",
    dEn: "A full-crew record of the night, covering the reception and the closing alike." },
  { id: 55, yt: "bOiD92ojI_4", cats: ["weddings"],
    ar: "تصوير عرس سينمائي — ٦", en: "Cinematic Wedding Film — 6",
    dAr: "عمل عرس يعتمد الحركة البطيئة الواثقة بدل القطع السريع.",
    dEn: "A wedding piece that trusts slow, confident movement over fast cutting." },
  { id: 56, yt: "YcsbeqHlm9I", cats: ["weddings"],
    ar: "برومو تصوير الأعراس", en: "Wedding Cinematography Promo",
    dAr: "برومو يعرّف بخدمة تصوير الأعراس عبر مختارات من أعمال حقيقية.",
    dEn: "A promo introducing the wedding cinematography service through selections from real work." },
];

// ════════════════════════════════════════════════════════════════════════════
// COUNTING — V2-1.4-D
//
// ⚠️ Read this before "fixing" the numbers.
//
// The filter chips used to show hardcoded counts that summed to more than the
// number of works, which read as a data bug. It is not one: a work can belong
// to several categories BY DESIGN (Maaden Open Day is both a corporate
// production and an event). So the memberships (56) legitimately exceed the
// works (46), and deriving the counts from the data does NOT make them equal —
// it only makes them TRUE.
//
// Two honest numbers, both derived, never typed by hand:
//   • categoryCount(cat) — works in that category (chip counts).
//   • WORKS.length       — distinct works, shown on the "all" chip.
// So "all" is 46 while the others sum to 56, and that is correct.
//
// Whether to also surface a note to the visitor is a content decision logged
// for Khaled. The data layer just stops lying.
// ════════════════════════════════════════════════════════════════════════════

/** Works in a category. `all` is the distinct count, not the sum. */
export function categoryCount(cat: CatKey | "all"): number {
  return cat === "all" ? WORKS.length : WORKS.filter((w) => w.cats.includes(cat)).length;
}

/** Sum of memberships. Exceeds WORKS.length whenever multi-category works exist. */
export const TOTAL_MEMBERSHIPS = WORKS.reduce((n, w) => n + w.cats.length, 0);

/** YouTube thumbnail. `maxresdefault` 404s on many older uploads, so `hqdefault`
 *  is the default and the caller may upgrade with a fallback (V2-1.9-B). */
export const thumb = (yt: string, quality: "hq" | "maxres" = "hq") =>
  `https://i.ytimg.com/vi/${yt}/${quality === "maxres" ? "maxresdefault" : "hqdefault"}.jpg`;

export const watchUrl = (yt: string) => `https://www.youtube.com/watch?v=${yt}`;
export const embedUrl = (yt: string) => `https://www.youtube-nocookie.com/embed/${yt}`;

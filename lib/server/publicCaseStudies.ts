// ════════════════════════════════════════════════════════════════════════════
// lib/server/publicCaseStudies.ts — قراءة السطح العامّ لدراسات الحالة.
//
// ★ ثلاث قواعد تحكم هذا الملفّ ★
//  ١) **بالمفتاح العامّ (anon) وحده.** لا مفتاح خدمة هنا إطلاقًا: الدوالّ
//     الثلاث المستدعاة SECURITY DEFINER وتُطبّق البوّابة والأقنعة بنفسها،
//     فاستعمال مفتاح الخدمة كان سيضيف قوّة بلا حاجة — وهو تعريف الخطر.
//  ٢) **الفشل يُخفي القسم ولا يخترع بيانات.** ترحيلة غير مطبَّقة، أو مفتاح
//     مفقود، أو شبكة ساقطة → `{ enabled:false, items:[] }`. الصفحة العامّة
//     تُخفي القسم. ⛔ لا «قريبًا» كاذبة فوق بيانات وهمية، ولا صفر يُقرأ
//     كأنّه «لا أعمال لدينا».
//  ٣) **التخزين المؤقّت هو الكابح.** كبح المعدّل داخل القاعدة غير ممكن بصدق
//     لقراءة عامّة: rl_consume عدّاد كتابة دائم بلا معرفة بعنوان الطالب، فمفتاح
//     عامّ واحد يُسقط الموقع عند أوّل ذروة. البديل الصحيح أن نقرأ من القاعدة
//     مرّةً كلّ خمس دقائق لكلّ مسار (revalidate) مهما بلغ عدد الزوّار.
//
// ⛔ ولا شيء هنا يبني رابط تخزين ولا يقرأ مسارًا: الدوالّ العامّة لا تعيد أيّ
//    عمود مسار أصلًا (أُثبت في POSTCHECK)، وهذا الملفّ يمرّر ما وصله كما هو.
// ════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** ثوانٍ. القراءة من القاعدة مرّة واحدة لكلّ مسار خلال هذه النافذة. */
const REVALIDATE_SECONDS = 300;

export interface PublicMedia {
  id?: string;
  kind: string;
  url?: string | null;
  video_provider?: "youtube" | "vimeo" | null;
  video_id?: string | null;
  video_title_ar?: string | null;
  video_title_en?: string | null;
  alt_ar?: string | null;
  alt_en?: string | null;
  caption_ar?: string | null;
  caption_en?: string | null;
  width?: number | null;
  height?: number | null;
  pair_key?: string | null;
  sort_order?: number;
}

export interface PublicTaxon { slug: string; name_ar: string; name_en: string }

export interface PublicCaseStudyCard {
  slug: string;
  title_ar?: string | null;
  title_en?: string | null;
  summary_ar?: string | null;
  summary_en?: string | null;
  client_label_ar?: string | null;
  client_label_en?: string | null;
  client_named?: boolean;
  featured?: boolean;
  published_at?: string | null;
  updated_at?: string | null;
  sectors?: PublicTaxon[];
  services?: PublicTaxon[];
  hero?: PublicMedia | null;
  locations?: string[];
  crew_size_min?: number | null;
  crew_size_max?: number | null;
  project_start?: string | null;
  project_end?: string | null;
}

export interface PublicCaseStudy extends PublicCaseStudyCard {
  seo?: Record<string, string | null>;
  body?: Record<string, string | null>;
  media?: PublicMedia[];
  metrics?: { label_ar?: string | null; label_en?: string | null; value_text: string; unit_ar?: string | null; unit_en?: string | null }[];
  credits?: { role_ar?: string | null; role_en?: string | null; name: string }[];
  testimonial?: { ar?: string | null; en?: string | null; author?: string | null; author_title?: string | null } | null;
}

export interface PublicIndex {
  enabled: boolean;
  total: number;
  page: number;
  page_size: number;
  items: PublicCaseStudyCard[];
  sectors: PublicTaxon[];
  services: PublicTaxon[];
}

const EMPTY_INDEX: PublicIndex = {
  enabled: false, total: 0, page: 1, page_size: 0, items: [], sectors: [], services: [],
};

/**
 * نداء RPC واحد بالمفتاح العامّ. لا يرمي أبدًا: كلّ فشل يعود null، ويقرأه
 * المتصل «الميزة غير متاحة» لا «صفر نتائج».
 */
async function anonRpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  if (!SUPABASE_URL || !ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;   // 404/PGRST202 = الترحيلة غير مطبَّقة بعد
    return (await res.json()) as T;
  } catch {
    return null;                // الشبكة لم تصل إلى Postgres — ليست «لا أعمال»
  }
}

/** فهرس دراسات الحالة المنشورة. enabled=false ⇒ الصفحة تُخفي القسم. */
export async function publicCaseStudyIndex(
  params: { sector?: string; service?: string; featured?: boolean; page?: number } = {},
): Promise<PublicIndex> {
  const p: Record<string, string> = {};
  if (params.sector) p.sector = params.sector;
  if (params.service) p.service = params.service;
  if (params.featured) p.featured = "true";
  if (params.page && params.page > 1) p.page = String(params.page);

  const data = await anonRpc<PublicIndex>("cs_public_index", { p_params: p });
  if (!data || typeof data !== "object" || data.enabled !== true) return EMPTY_INDEX;
  return {
    enabled: true,
    total: Number(data.total ?? 0),
    page: Number(data.page ?? 1),
    page_size: Number(data.page_size ?? 0),
    items: Array.isArray(data.items) ? data.items : [],
    sectors: Array.isArray(data.sectors) ? data.sectors : [],
    services: Array.isArray(data.services) ? data.services : [],
  };
}

/** دراسة واحدة بالـslug + الدراسات ذات الصلة. */
export async function publicCaseStudy(
  slug: string,
): Promise<{ enabled: boolean; found: boolean; study: PublicCaseStudy | null; related: PublicCaseStudyCard[] }> {
  const off = { enabled: false, found: false, study: null, related: [] as PublicCaseStudyCard[] };
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return off;
  const data = await anonRpc<{ enabled?: boolean; found?: boolean; study?: PublicCaseStudy; related?: PublicCaseStudyCard[] }>(
    "cs_public_study", { p_slug: slug },
  );
  if (!data || data.enabled !== true) return off;
  if (!data.found || !data.study) return { enabled: true, found: false, study: null, related: [] };
  return {
    enabled: true, found: true, study: data.study,
    related: Array.isArray(data.related) ? data.related : [],
  };
}

/** الـslugs المنشورة — لخريطة الموقع وحدها. لا تعيد أيّ حقل آخر. */
export async function publicCaseStudySlugs(): Promise<{ slug: string; updated_at: string | null }[]> {
  const data = await anonRpc<{ enabled?: boolean; items?: { slug: string; updated_at: string | null }[] }>(
    "cs_public_slugs", {},
  );
  if (!data || data.enabled !== true || !Array.isArray(data.items)) return [];
  return data.items.filter((x) => x && typeof x.slug === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x.slug));
}

// ─── مساعدات عرض آمنة ──────────────────────────────────────────────────────

/**
 * ★ الطبقة الأخيرة ضدّ الحقن ★ الخادم يعقّم عند الكتابة وعند الإخراج، وهذه
 * ثالثة: React يهرّب النصّ أصلًا، لكنّ أيّ نصّ يمرّ إلى سمة (alt/title/og)
 * يُنظَّف هنا كذلك. الدفاع الذي يعتمد على طبقة واحدة يسقط بخطأ واحد.
 */
export function safeText(v: unknown, max = 400): string {
  const s = typeof v === "string" ? v : "";
  return s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** رابط صورة عامّ مقبول: مسار مستودع مطلق أو https. أيّ شيء آخر يُسقَط. */
export function safeImageUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (/^\/[A-Za-z0-9._~%!$&*+,;=:@/-]{1,300}$/.test(s)) return s;
  if (/^https:\/\/[A-Za-z0-9.-]{3,120}\/[A-Za-z0-9._~%!$&*+,;=:@/-]{0,300}$/.test(s)) {
    // حتّى لو مرّ قيد القاعدة يومًا، لا نعرض رابطًا موقَّعًا ولا مسار دلو خاصّ.
    if (/[?&]token=|\/storage\/v1\/object\/(sign|authenticated)/i.test(s)) return null;
    return s;
  }
  return null;
}

/** مضمّن فيديو بمزوّد ومعرّف فقط — لا iframe بعنوان حرّ. */
export function safeEmbedUrl(provider: unknown, id: unknown): string | null {
  const p = provider === "youtube" || provider === "vimeo" ? provider : null;
  const v = typeof id === "string" && /^[A-Za-z0-9_-]{5,64}$/.test(id) ? id : null;
  if (!p || !v) return null;
  return p === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${v}`
    : `https://player.vimeo.com/video/${v}`;
}

// ════════════════════════════════════════════════════════════════════════
// Kian Portal — bilingual quote-form options. `en` is the canonical value
// stored in quote_requests.services / budget_range (stable for later Zoho
// mapping); `ar` is the display label.
// ════════════════════════════════════════════════════════════════════════

export interface Bi { en: string; ar: string }

export const SERVICES: Bi[] = [
  { en: "Corporate Films",                 ar: "إنتاج أفلام الشركات" },
  { en: "Commercial & Advertising",        ar: "التصوير التجاري والإعلاني" },
  { en: "Documentary Films",               ar: "الأفلام الوثائقية" },
  { en: "Events & Conferences Coverage",   ar: "تغطية الفعاليات والمؤتمرات" },
  { en: "Live Streaming",                  ar: "البث المباشر" },
  { en: "Real Estate Media",               ar: "التصوير العقاري" },
  { en: "Drone Filming",                   ar: "تصوير الدرون" },
  { en: "Photography",                     ar: "التصوير الفوتوغرافي" },
  { en: "Product Photography",             ar: "تصوير المنتجات" },
  { en: "Podcast Production",              ar: "إنتاج البودكاست" },
  { en: "Motion Graphics",                 ar: "الموشن جرافيك" },
  { en: "Video Editing",                   ar: "المونتاج" },
  { en: "Short Reels",                     ar: "صناعة الريلز القصيرة" },
  { en: "Social Media Management",         ar: "إدارة منصات التواصل" },
  { en: "Wedding Coverage",                ar: "تغطية الأعراس" },
  { en: "Other",                           ar: "أخرى" },
];

export const BUDGETS: Bi[] = [
  { en: "Under 10,000 SAR",      ar: "أقل من ١٠٬٠٠٠ ريال" },
  { en: "10,000 - 25,000 SAR",   ar: "١٠٬٠٠٠ - ٢٥٬٠٠٠ ريال" },
  { en: "25,000 - 50,000 SAR",   ar: "٢٥٬٠٠٠ - ٥٠٬٠٠٠ ريال" },
  { en: "50,000 - 100,000 SAR",  ar: "٥٠٬٠٠٠ - ١٠٠٬٠٠٠ ريال" },
  { en: "Above 100,000 SAR",     ar: "أكثر من ١٠٠٬٠٠٠ ريال" },
];

export const CONTACT_PREFS: Bi[] = [
  { en: "WhatsApp", ar: "واتساب" },
  { en: "Phone Call", ar: "مكالمة هاتفية" },
  { en: "Email", ar: "البريد الإلكتروني" },
];

export const QUOTE_STATUS_LABELS: Record<string, Bi> = {
  new:       { ar: "جديد",        en: "New" },
  in_review: { ar: "قيد المراجعة", en: "In Review" },
  quoted:    { ar: "تم التسعير",   en: "Quoted" },
  accepted:  { ar: "مقبول",        en: "Accepted" },
  rejected:  { ar: "مرفوض",        en: "Rejected" },
  archived:  { ar: "مؤرشف",        en: "Archived" },
};

export function labelFor(list: Bi[], en: string, isAr: boolean): string {
  const hit = list.find((x) => x.en === en);
  return hit ? (isAr ? hit.ar : hit.en) : en;
}

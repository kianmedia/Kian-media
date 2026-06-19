// ════════════════════════════════════════════════════════════════════════
// Kian — deterministic (NO AI) Arabic summary of a WhatsApp conversation, for
// the Zoho Lead Description. Reads recent customer (incoming) messages and
// extracts a structured, sales-readable summary. Phase 3 AI can later improve
// quality, but this works without any AI. Pure — no DB, no secrets, no DOM.
// ════════════════════════════════════════════════════════════════════════

export interface SummaryMessage {
  body: string | null;
  direction: string;      // 'incoming' | 'outgoing' | 'internal_note'
  created_at: string;
}

export interface SummaryInput {
  displayName: string | null;
  phone: string | null;
  waId: string;
  salesStage: string | undefined;
  conversationLink: string;
  messages: SummaryMessage[];   // any order
}

const NA = "غير محدد";

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[ً-ْ]/g, "")   // strip Arabic diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

const STAGE_AR: Record<string, string> = {
  new: "جديد", collecting: "جمع البيانات", quote_requested: "طلب عرض سعر",
  awaiting_sales_review: "بانتظار مراجعة المبيعات", quote_sent: "أُرسل العرض",
  follow_up: "متابعة", converted: "تم التحويل", rejected: "مرفوض",
};

const CITIES: Array<[string, string]> = [
  ["الرياض", "الرياض"], ["جده", "جدة"], ["مكه", "مكة"], ["المدينه", "المدينة المنورة"],
  ["الدمام", "الدمام"], ["الخبر", "الخبر"], ["الظهران", "الظهران"], ["الطايف", "الطائف"],
  ["ابها", "أبها"], ["خميس مشيط", "خميس مشيط"], ["تبوك", "تبوك"], ["بريده", "بريدة"],
  ["القصيم", "القصيم"], ["عنيزه", "عنيزة"], ["حايل", "حائل"], ["نجران", "نجران"],
  ["جازان", "جازان"], ["الاحساء", "الأحساء"], ["الهفوف", "الهفوف"], ["ينبع", "ينبع"],
  ["الجبيل", "الجبيل"], ["عرعر", "عرعر"], ["سكاكا", "سكاكا"], ["الباحه", "الباحة"],
];

function detectService(t: string, droneOnly: boolean): string {
  if (/(زواج|زفاف|عرس|ملكه|قران|عروس)/.test(t)) return "تصوير زواج";
  if (/(بث مباشر|بث|ستريم|لايف|live)/.test(t)) return "بث مباشر";
  if (/(مؤتمر|فعاليه|حفل|معرض|تخرج|افتتاح|مناسبه)/.test(t)) return "تغطية فعالية / مؤتمر";
  if (/(اعلان|تجاري|منتج|منتجات|براند|بروشور)/.test(t)) return "تصوير إعلاني / منتجات";
  if (/(محتوى|سوشيال|سوشال|ريلز|reels|تيك توك|تيكتوك|انستقرام|انستجرام)/.test(t)) return "إدارة / إنتاج محتوى";
  if (/(عقار|مطعم|كافيه|فندق|شقه)/.test(t)) return "تصوير عقاري / تجاري";
  if (/(تصوير|فيديو|انتاج|مونتاج|فوتو|صور|كليب)/.test(t)) return "تصوير / إنتاج فيديو";
  if (droneOnly) return "تصوير جوي بالدرون";
  return NA;
}

function detectRequestType(t: string): string {
  if (/(عرض سعر|عرض السعر|تسعير|كم سعر|كم تكلف|كم يكلف|كم السعر|بكم|سعر|تكلفه|اسعار|اسعاركم|price|quote)/.test(t)) return "عرض سعر";
  if (/(احجز|حجز|ابغى احجز|ابي احجز|اريد الحجز|booking|book)/.test(t)) return "حجز";
  if (/(استفسار|استفسر|سؤال|اسال|اسئله|معلومات|تفاصيل|info)/.test(t)) return "استفسار";
  return NA;
}

function detectCity(t: string): string {
  for (const [k, label] of CITIES) if (t.includes(k)) return label;
  return NA;
}

function detectDateTime(t: string): string {
  const days = ["الاحد", "الاثنين", "الثلاثاء", "الاربعاء", "الخميس", "الجمعه", "السبت"];
  for (const d of days) if (t.includes(d)) return d.replace("الجمعه", "الجمعة");
  const rel = ["بعد بكره", "بعد غد", "بكره", "بكرا", "غدا", "اليوم", "الليله", "نهايه الاسبوع", "الويكند"];
  for (const r of rel) if (t.includes(r)) return r;
  const months = ["محرم", "صفر", "ربيع", "جمادى", "رجب", "شعبان", "رمضان", "شوال", "ذو القعده", "ذو الحجه",
    "يناير", "فبراير", "مارس", "ابريل", "مايو", "يونيو", "يوليو", "اغسطس", "سبتمبر", "اكتوبر", "نوفمبر", "ديسمبر"];
  for (const m of months) if (t.includes(m)) return "مذكور (راجع الملاحظات)";
  const num = t.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
  if (num) return num[0];
  return NA;
}

function detectDuration(t: string): string {
  const m = t.match(/([0-9٠-٩]+)\s*(ساعات|ساعه|دقايق|دقيقه|ايام|يوم)/);
  if (m) return m[0];
  if (/ساعتين/.test(t)) return "ساعتين";
  if (/يومين/.test(t)) return "يومين";
  if (/(نص يوم|نصف يوم)/.test(t)) return "نصف يوم";
  if (/(يوم كامل|طول اليوم)/.test(t)) return "يوم كامل";
  return NA;
}

/** Build the structured Arabic Zoho Description. Always returns a full block;
 *  missing facts render as "غير محدد". */
export function buildZohoDescription(input: SummaryInput): string {
  const incoming = input.messages
    .filter((m) => m.direction === "incoming" && (m.body || "").trim().length > 0)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const original = incoming.map((m) => (m.body || "").trim());
  const t = normalize(original.join(" \n "));

  const lastMsg = original.length ? original[original.length - 1] : NA;
  const droneYes = /(درون|drone)/.test(t);
  const hasOtherService = /(زواج|زفاف|عرس|بث|مؤتمر|فعاليه|حفل|اعلان|منتج|محتوى|عقار|تصوير|فيديو|انتاج)/.test(t);

  const customer = (input.displayName || "").trim() || input.waId || NA;
  const phone = (input.phone || "").trim() || input.waId || NA;
  const service = detectService(t, droneYes && !hasOtherService);
  const reqType = detectRequestType(t);
  const city = detectCity(t);
  const dateTime = detectDateTime(t);
  const duration = detectDuration(t);
  const drone = droneYes ? "نعم / مهتم بالدرون" : NA;
  const editing = /(مونتاج|مونتير|تعديل|تركيب|قص|مكساج|edit)/.test(t) ? "نعم / مطلوب" : NA;
  const stage = STAGE_AR[input.salesStage || ""] || NA;
  const urgent = /(عاجل|ضروري|بسرعه|باسرع|مستعجل|urgent|asap)/.test(t);

  const noteMsgs = original.slice(-6).map((m) => `- ${m.length > 140 ? m.slice(0, 137) + "…" : m}`);
  if (urgent) noteMsgs.unshift("- ⚠️ العميل يطلب الاستعجال / الطلب عاجل");
  const notes = noteMsgs.length ? noteMsgs.join("\n") : `- ${NA}`;

  return [
    "ملخص طلب العميل عبر واتساب:",
    "",
    `- العميل: ${customer}`,
    `- رقم الجوال: ${phone}`,
    `- الخدمة المطلوبة: ${service}`,
    `- نوع الطلب: ${reqType}`,
    `- المدينة/الموقع: ${city}`,
    `- التاريخ/الوقت: ${dateTime}`,
    `- المدة: ${duration}`,
    `- الدرون: ${drone}`,
    `- المونتاج: ${editing}`,
    `- حالة العميل: ${stage}`,
    `- آخر رسالة من العميل: ${lastMsg}`,
    `- رابط المحادثة في بوابة كيان: ${input.conversationLink || NA}`,
    "",
    "ملاحظات المحادثة:",
    notes,
  ].join("\n");
}

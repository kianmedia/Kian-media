// ════════════════════════════════════════════════════════════════════════
// Kian — WhatsApp message classification (Phase 6 foundation).
//
// Rule-based for now (no external AI call). The shape of the return value is
// deliberately the SAME one a real model would produce, so swapping in an
// OpenAI/Claude call later is a one-function change inside classifyWhatsAppMessage
// — every caller (the ingest route) already passes category/priority/summary/
// confidence straight into the DB.
//
// SAFE BY DESIGN: this module is pure (no network, no secrets) and importable
// from anywhere. The real-AI version MUST stay server-only (it needs an API key).
// ════════════════════════════════════════════════════════════════════════

/** Conversation categories — MUST match whatsapp_conversations.category CHECK. */
export type WaCategory =
  | "sales" | "project_support" | "pricing_request" | "job_request"
  | "training_request" | "supplier_request" | "finance" | "spam" | "unknown";

/** Conversation priorities — MUST match whatsapp_conversations.priority CHECK. */
export type WaPriority = "low" | "normal" | "high" | "urgent";

export interface WaClassification {
  category: WaCategory;
  priority: WaPriority;
  summary: string;
  suggested_department: string;
  confidence: number; // 0..1
}

/** Department label per category (display + future CRM routing). */
const DEPARTMENT: Record<WaCategory, string> = {
  pricing_request:  "Sales",
  sales:            "Sales",
  project_support:  "Production / Support",
  job_request:      "HR",
  training_request: "Training",
  supplier_request: "Procurement",
  finance:          "Finance",
  spam:             "None",
  unknown:          "Triage",
};

// Keyword tables (Arabic + a few English equivalents). Order = priority of match.
// First matching rule wins, so the more specific intents are listed first.
const RULES: { category: WaCategory; keywords: string[] }[] = [
  { category: "finance",          keywords: ["فاتورة", "فواتير", "دفع", "سداد", "تحويل", "invoice", "payment", "بنك", "iban"] },
  { category: "pricing_request",  keywords: ["عرض سعر", "السعر", "سعر", "تكلفة", "كم سعر", "كم تكلفة", "كم", "بكم", "اسعار", "أسعار", "price", "quote", "cost"] },
  { category: "job_request",      keywords: ["وظيفة", "توظيف", "تقديم", "سيرة ذاتية", "السيرة الذاتية", "cv", "vacancy", "job", "hiring"] },
  { category: "training_request", keywords: ["تدريب", "كورس", "دورة", "ورشة", "training", "course", "workshop"] },
  { category: "supplier_request", keywords: ["مورد", "توريد", "عرض توريد", "supplier", "vendor"] },
  { category: "project_support",  keywords: ["مشروع", "تعديل", "تعديلات", "معاينة", "تسليم", "المونتاج", "تصوير سابق", "project", "revision", "edit"] },
  { category: "sales",            keywords: ["خدمة", "خدماتكم", "تصوير", "إعلان", "تسويق", "باقة", "service", "marketing", "ad"] },
];

const URGENT = ["عاجل", "ضروري", "بأسرع", "حالاً", "urgent", "asap"];

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[ً-ْ]/g, "")   // strip Arabic diacritics
    .replace(/[إأآا]/g, "ا")          // normalise alef forms
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a raw WhatsApp message body. Always returns a valid, DB-safe object;
 * empty / unknown input falls back to { category: "unknown", priority: "normal" }.
 */
export function classifyWhatsAppMessage(messageText: string | null | undefined): WaClassification {
  const raw = (messageText ?? "").trim();
  const text = normalize(raw);

  let category: WaCategory = "unknown";
  let confidence = 0.25;

  if (text.length > 0) {
    for (const rule of RULES) {
      if (rule.keywords.some((k) => text.includes(normalize(k)))) {
        category = rule.category;
        confidence = 0.7;
        break;
      }
    }
  }

  // Priority heuristics (kept intentionally light).
  let priority: WaPriority = "normal";
  if (URGENT.some((k) => text.includes(normalize(k)))) priority = "urgent";
  else if (category === "pricing_request" || category === "finance") priority = "high";
  else if (category === "unknown") priority = "low";

  const summary = raw.length > 140 ? `${raw.slice(0, 137)}…` : raw;

  return {
    category,
    priority,
    summary,
    suggested_department: DEPARTMENT[category],
    confidence,
  };
}

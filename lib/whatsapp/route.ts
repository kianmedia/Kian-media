// ════════════════════════════════════════════════════════════════════════
// Kian — deterministic (NO AI) department routing for a single WhatsApp message.
// Returns the PRIMARY department (mirrors the SQL ingest category→dept mapping)
// plus the FULL set of departments the message touches (so one message can be
// visible to e.g. both Sales and Finance). Pure — no DB, no secrets.
// ════════════════════════════════════════════════════════════════════════
import type { WaDepartment } from "@/lib/whatsapp/types";
import type { WaCategory } from "@/lib/whatsapp/classify";

function normalize(s: string): string {
  return (s || "").toLowerCase()
    .replace(/[ً-ْ]/g, "").replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}

// Keyword sets (normalized forms; substring match catches ال-prefixes, plurals).
const FINANCE = [
  "فاتوره", "فواتير", "دفع", "دفعه", "سداد", "تحويل", "حواله", "مبلغ", "ضريبه",
  "سعر", "عرض سعر", "تسعيره", "تسعير", "اسعار",
  "invoice", "payment", "paid", "transfer", "quote", "estimate", "vat", "bank", "iban",
];
const SALES = [
  "تصوير", "فيديو", "انتاج", "زواج", "زفاف", "عرس", "بث", "درون", "محتوى", "سوشيال",
  "اعلان", "تسويق", "باقه", "خدمه", "خدماتكم", "ريلز", "مشروع",
  "video", "photo", "shoot", "marketing", "ad", "package", "service", "drone", "reels",
];
const SUPPORT = [
  "مشكله", "شكوى", "شكوي", "استفسار", "متابعه", "تعديل", "تعديلات", "تسليم", "معاينه",
  "دعم", "مساعده", "support", "issue", "problem", "complaint", "revision", "help",
];
const HR = [
  "وظيفه", "توظيف", "تقديم", "سيره", "سيره ذاتيه", "مستقل", "فريلانسر", "مورد", "توريد",
  "شراكه", "تدريب", "كورس", "دوره", "cv", "job", "hiring", "vacancy", "internship",
  "freelancer", "supplier", "vendor", "partnership",
];

/** Classifier category → primary department (mirrors the SQL ingest mapping). */
export function mapCategoryToDepartment(category: WaCategory | string): WaDepartment {
  switch (category) {
    case "sales": case "pricing_request": return "sales_marketing";
    case "finance": return "finance";
    case "project_support": return "support";
    case "job_request": case "training_request": case "supplier_request": return "hr";
    default: return "unassigned";
  }
}

export interface RoutingDecision {
  primary: WaDepartment;
  departments: WaDepartment[];   // every department this message routes to
  reason: string;
}

/** Route ONE message. primary = category-derived (matches ingest); departments =
 *  primary ∪ every keyword-matched department (so e.g. a quote is Sales+Finance). */
export function routeDepartments(category: WaCategory | string, text: string): RoutingDecision {
  const t = normalize(text);
  const set = new Set<WaDepartment>();
  const matched: string[] = [];

  const primary = mapCategoryToDepartment(category);
  if (primary !== "unassigned") { set.add(primary); matched.push(`category:${primary}`); }

  if (FINANCE.some((k) => t.includes(k))) { set.add("finance"); matched.push("kw:finance"); }
  if (SALES.some((k) => t.includes(k)))   { set.add("sales_marketing"); matched.push("kw:sales_marketing"); }
  if (SUPPORT.some((k) => t.includes(k))) { set.add("support"); matched.push("kw:support"); }
  if (HR.some((k) => t.includes(k)))      { set.add("hr"); matched.push("kw:hr"); }

  if (set.size === 0) set.add("unassigned");
  const departments = Array.from(set).filter((d) => d !== "unassigned" || set.size === 1);
  const prim: WaDepartment = primary !== "unassigned" ? primary : (departments[0] ?? "unassigned");

  return { primary: prim, departments, reason: matched.length ? matched.join("+") : "none" };
}

// ════════════════════════════════════════════════════════════════════════
// Kian — WhatsApp inbox row types + label maps. Mirrors docs/whatsapp_inbox_RUNME.sql.
// ════════════════════════════════════════════════════════════════════════
import type { WaCategory, WaPriority } from "@/lib/whatsapp/classify";

export type WaStatus = "new" | "open" | "pending" | "assigned" | "closed" | "spam";
export type WaDirection = "incoming" | "outgoing" | "internal_note";

/** Sales pipeline stage (whatsapp_conversations.sales_stage) — mirrors Zoho stages. */
export type WaSalesStage =
  | "new" | "collecting" | "quote_requested" | "awaiting_sales_review"
  | "quote_sent" | "follow_up" | "converted" | "rejected";

/** Routing department (whatsapp_conversations.assigned_department). */
export type WaDepartment =
  | "sales_marketing" | "finance" | "support" | "hr" | "operations" | "owner_admin" | "unassigned";

export interface WaContact {
  id: string;
  wa_id: string;
  phone: string | null;
  display_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  source: string;
  crm_lead_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaConversation {
  id: string;
  contact_id: string;
  status: WaStatus;
  category: WaCategory;
  priority: WaPriority;
  assigned_to: string | null;
  linked_client_id: string | null;
  linked_project_id: string | null;
  crm_lead_id: string | null;
  crm_synced_at: string | null;
  sales_stage: WaSalesStage;
  assigned_department: WaDepartment;
  routed_departments: WaDepartment[];
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  ai_summary: string | null;
  ai_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface WaMessage {
  id: string;
  conversation_id: string;
  contact_id: string;
  direction: WaDirection;
  whatsapp_message_id: string | null;
  message_type: string;
  body: string | null;
  status: string;
  sent_by: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface WaAssignment {
  id: string;
  conversation_id: string;
  assigned_to: string;
  assigned_by: string | null;
  reason: string | null;
  created_at: string;
}

export interface WaInternalNote {
  id: string;
  conversation_id: string;
  author_id: string;
  note: string;
  created_at: string;
}

export type WaQuoteStatus =
  | "new" | "in_review" | "quoted" | "accepted" | "rejected" | "archived"
  | "draft" | "approved" | "sent" | "converted" | "cancelled";
/** Statuses that count as an OPEN (still-actionable) quote request — drives the
 *  find-or-edit-existing behaviour so repeated clicks don't create duplicates. */
export const WA_QUOTE_OPEN_STATUSES: WaQuoteStatus[] = ["new", "in_review", "draft"];

export interface WaQuoteRequest {
  id: string;
  /** Human-friendly request number (e.g. the Sheets reference). Added additively
   *  via docs/whatsapp_quote_request_schema_fix_RUNME.sql; null on older rows. */
  external_request_id: string | null;
  whatsapp_conversation_id: string;
  whatsapp_contact_id: string | null;
  phone: string | null;
  full_name: string | null;
  company: string | null;
  // `services` may be null on legacy rows even though the column defaults to '{}'.
  services: string[] | null;
  category: string | null;
  city: string | null;
  preferred_date: string | null;
  message: string | null;
  budget_range: string | null;
  status: WaQuoteStatus | null;
  crm_lead_id: string | null;
  source: string | null;
  // Full quote detail (additive — docs/whatsapp_quote_books_fix_RUNME.sql).
  email: string | null;
  priority: string | null;
  lead_source: string | null;
  duration: string | null;
  assigned_department: string | null;
  internal_notes: string | null;
  // Zoho Books estimate (the financial quote — distinct from the CRM lead).
  zoho_books_estimate_id: string | null;
  zoho_books_estimate_number: string | null;
  zoho_books_estimate_url: string | null;
  zoho_books_estimate_status: string | null;
  zoho_books_estimate_total: number | null;
  zoho_books_estimate_currency: string | null;
  zoho_books_estimate_created_by: string | null;
  zoho_books_estimate_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export const WA_QUOTE_STATUS_LABELS: Record<WaQuoteStatus, { ar: string; en: string }> = {
  new:       { ar: "جديد",        en: "New" },
  in_review: { ar: "قيد المراجعة", en: "In review" },
  quoted:    { ar: "تم التسعير",   en: "Quoted" },
  accepted:  { ar: "مقبول",       en: "Accepted" },
  rejected:  { ar: "مرفوض",       en: "Rejected" },
  archived:  { ar: "مؤرشف",       en: "Archived" },
  draft:     { ar: "مسودة",       en: "Draft" },
  approved:  { ar: "معتمد",       en: "Approved" },
  sent:      { ar: "مُرسل",        en: "Sent" },
  converted: { ar: "تم التحويل",   en: "Converted" },
  cancelled: { ar: "ملغي",        en: "Cancelled" },
};

/** Zoho Books estimate lifecycle status → Arabic. Books returns lowercase. */
export const WA_BOOKS_ESTIMATE_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  draft:    { ar: "مسودة",  en: "Draft" },
  sent:     { ar: "مُرسل",   en: "Sent" },
  invoiced: { ar: "مفوتر",  en: "Invoiced" },
  accepted: { ar: "مقبول",  en: "Accepted" },
  declined: { ar: "مرفوض",  en: "Declined" },
  expired:  { ar: "منتهٍ",   en: "Expired" },
};

// ─── Bilingual labels (AR/EN) for the filter chips + badges ───
export const WA_STATUS_LABELS: Record<WaStatus, { ar: string; en: string }> = {
  new:      { ar: "جديدة",   en: "New" },
  open:     { ar: "مفتوحة",  en: "Open" },
  pending:  { ar: "معلّقة",  en: "Pending" },
  assigned: { ar: "مُسندة",  en: "Assigned" },
  closed:   { ar: "مغلقة",   en: "Closed" },
  spam:     { ar: "سبام",    en: "Spam" },
};

export const WA_CATEGORY_LABELS: Record<WaCategory, { ar: string; en: string }> = {
  sales:            { ar: "مبيعات",        en: "Sales" },
  pricing_request:  { ar: "طلب تسعير",     en: "Pricing" },
  project_support:  { ar: "دعم مشروع",     en: "Project Support" },
  finance:          { ar: "مالية",         en: "Finance" },
  job_request:      { ar: "طلب توظيف",     en: "Job Request" },
  training_request: { ar: "طلب تدريب",     en: "Training" },
  supplier_request: { ar: "طلب توريد",     en: "Supplier" },
  spam:             { ar: "سبام",          en: "Spam" },
  unknown:          { ar: "غير مصنّفة",    en: "Unknown" },
};

export const WA_PRIORITY_LABELS: Record<WaPriority, { ar: string; en: string }> = {
  low:    { ar: "منخفضة", en: "Low" },
  normal: { ar: "عادية",  en: "Normal" },
  high:   { ar: "عالية",  en: "High" },
  urgent: { ar: "عاجلة",  en: "Urgent" },
};

export const WA_SALES_STAGE_LABELS: Record<WaSalesStage, { ar: string; en: string }> = {
  new:                   { ar: "جديد",              en: "New" },
  collecting:            { ar: "جمع البيانات",       en: "Collecting" },
  quote_requested:       { ar: "طلب عرض سعر",        en: "Quote Requested" },
  awaiting_sales_review: { ar: "بانتظار المبيعات",   en: "Awaiting Sales" },
  quote_sent:            { ar: "أُرسل العرض",         en: "Quote Sent" },
  follow_up:             { ar: "متابعة",             en: "Follow-up" },
  converted:             { ar: "تم التحويل",          en: "Converted" },
  rejected:              { ar: "مرفوض",              en: "Rejected" },
};
export const WA_SALES_STAGE_ORDER: WaSalesStage[] = [
  "new", "collecting", "quote_requested", "awaiting_sales_review",
  "quote_sent", "follow_up", "converted", "rejected",
];

export const WA_DEPARTMENT_LABELS: Record<WaDepartment, { ar: string; en: string }> = {
  sales_marketing: { ar: "المبيعات والتسويق", en: "Sales & Marketing" },
  finance:         { ar: "المالية",           en: "Finance" },
  support:         { ar: "الدعم",             en: "Support" },
  hr:              { ar: "الموارد البشرية",    en: "HR" },
  operations:      { ar: "العمليات",          en: "Operations" },
  owner_admin:     { ar: "الإدارة",           en: "Owner / Admin" },
  unassigned:      { ar: "غير محدّد",         en: "Unassigned" },
};
export const WA_DEPARTMENT_ORDER: WaDepartment[] = [
  "sales_marketing", "finance", "support", "hr", "operations", "owner_admin", "unassigned",
];

export const WA_STATUS_ORDER: WaStatus[] = ["new", "open", "assigned", "pending", "closed", "spam"];
export const WA_CATEGORY_ORDER: WaCategory[] = [
  "sales", "pricing_request", "project_support", "finance",
  "job_request", "training_request", "supplier_request", "unknown",
];
export const WA_PRIORITY_ORDER: WaPriority[] = ["low", "normal", "high", "urgent"];

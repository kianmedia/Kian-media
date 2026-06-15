// ════════════════════════════════════════════════════════════════════════
// Kian Portal — shared project/deliverable status metadata (labels + order).
// Single source for the projects list, project detail timeline, and S7/S8.
// ════════════════════════════════════════════════════════════════════════

export const STATUS_STEPS: { key: string; ar: string; en: string }[] = [
  { key: "request_received",   ar: "استلام الطلب",   en: "Request Received" },
  { key: "pre_production",     ar: "مرحلة التحضير",  en: "Pre-Production" },
  { key: "shooting_scheduled", ar: "جدولة التصوير",  en: "Shooting Scheduled" },
  { key: "shooting_completed", ar: "اكتمال التصوير", en: "Shooting Completed" },
  { key: "editing",            ar: "المونتاج",        en: "Editing" },
  { key: "ready_for_review",   ar: "جاهز للمراجعة",  en: "Ready for Review" },
  { key: "delivered",          ar: "تم التسليم",      en: "Delivered" },
];

export function projectStatusLabel(status: string): { ar: string; en: string } {
  return STATUS_STEPS.find((s) => s.key === status) ?? { ar: status, en: status };
}

export const DELIVERY_LABELS: Record<string, { ar: string; en: string }> = {
  pending:     { ar: "قيد الانتظار", en: "Pending" },
  in_progress: { ar: "جارٍ التجهيز", en: "In Progress" },
  delivered:   { ar: "تم التسليم",   en: "Delivered" },
};

export const REVISION_LABELS: Record<string, { ar: string; en: string }> = {
  none:        { ar: "لا توجد مراجعات", en: "No Revisions" },
  in_revision: { ar: "قيد المراجعة",     en: "In Revision" },
  approved:    { ar: "معتمد",            en: "Approved" },
};

export const DLV_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  client_review:      { ar: "بانتظار مراجعتك",    en: "Awaiting Your Review" },
  revision_requested: { ar: "قيد التعديل",         en: "In Revision" },
  approved:           { ar: "معتمد",               en: "Approved" },
  final_delivered:    { ar: "تم التسليم النهائي", en: "Final Delivered" },
};

/** All deliverable statuses (admin dropdown). Order matches the workflow. */
export const DELIVERABLE_STATUSES: { key: string; ar: string; en: string }[] = [
  { key: "draft",              ar: "مسودة",            en: "Draft" },
  { key: "internal_review",    ar: "مراجعة داخلية",    en: "Internal Review" },
  { key: "client_review",      ar: "مراجعة العميل",    en: "Client Review" },
  { key: "revision_requested", ar: "طلب تعديل",        en: "Revision Requested" },
  { key: "approved",           ar: "معتمد",            en: "Approved" },
  { key: "final_delivered",    ar: "تم التسليم النهائي", en: "Final Delivered" },
  { key: "archived",           ar: "مؤرشف",            en: "Archived" },
];

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

export function deliverableStatusLabel(status: string): { ar: string; en: string } {
  return DELIVERABLE_STATUSES.find((s) => s.key === status) ?? { ar: status, en: status };
}

/** Client review decision → label (admin client-notes section). */
export const REVIEW_DECISION_LABELS: Record<string, { ar: string; en: string }> = {
  approved:           { ar: "اعتماد",    en: "Approved" },
  revision_requested: { ar: "طلب تعديل", en: "Revision Requested" },
};

// ─── Derived summary cards (computed from live deliverable/review data) ───
// These replace the unmaintained legacy projects.delivery_status /
// projects.revision_status free-text columns.

/**
 * حالة التصوير — real shooting_date if set; else "تم التصوير" once the project
 * timeline reached shooting_completed (or later); else "لم يُحدد بعد".
 * For a real date both ar/en hold the same string (renders verbatim via t()).
 */
export function computeShootingStatus(
  shootingDate: string | null, projectStatus: string,
): { ar: string; en: string } {
  if (shootingDate) return { ar: shootingDate, en: shootingDate };
  const idx = STATUS_STEPS.findIndex((s) => s.key === projectStatus);
  const shotIdx = STATUS_STEPS.findIndex((s) => s.key === "shooting_completed");
  if (idx >= 0 && idx >= shotIdx) return { ar: "تم التصوير", en: "Shot / Completed" };
  return { ar: "لم يُحدد بعد", en: "Not set yet" };
}

/**
 * حالة التسليم — highest-precedence deliverable state present, else project
 * status. Never reports "ready to deliver" until the client has actually
 * approved (client_review shows "awaiting client approval", not "ready").
 */
export function computeDeliveryStatus(
  deliverables: { status: string }[], projectStatus: string,
): { ar: string; en: string } {
  const has = (s: string) => deliverables.some((d) => d.status === s);
  if (has("final_delivered"))    return { ar: "تم التسليم",            en: "Delivered" };
  if (has("approved"))           return { ar: "معتمد — جاهز للتسليم",   en: "Approved — Ready to Deliver" };
  if (has("client_review"))      return { ar: "بانتظار اعتماد العميل",  en: "Awaiting Client Approval" };
  if (has("revision_requested")) return { ar: "تعديل مطلوب قبل التسليم", en: "Revision Needed Before Delivery" };
  const ps = STATUS_STEPS.find((s) => s.key === projectStatus);
  return ps ? { ar: ps.ar, en: ps.en } : { ar: "قيد الانتظار", en: "Pending" };
}

/**
 * Active timeline step — project.status mapping, overridden by live deliverable
 * state so the bar reflects the real operational stage (the legacy projects.status
 * column isn't auto-advanced when a deliverable is delivered). Display-only;
 * never writes the DB. Precedence mirrors the delivery card.
 */
export function computeTimelineIndex(
  deliverables: { status: string }[], projectStatus: string,
): number {
  const idxOf = (k: string) => STATUS_STEPS.findIndex((s) => s.key === k);
  const base = Math.max(0, idxOf(projectStatus));
  const has = (s: string) => deliverables.some((d) => d.status === s);
  const delivered = idxOf("delivered");
  const ready = idxOf("ready_for_review");
  const editing = idxOf("editing");
  if (has("final_delivered"))     return delivered;                        // تم التسليم
  if (has("approved"))            return ready;                            // ready for final delivery (not delivered)
  if (has("client_review"))       return ready;                            // جاهز للمراجعة (even if project.status was advanced)
  if (has("revision_requested"))  return Math.min(ready, Math.max(base, editing)); // review/revision, never delivered
  return base;
}

/** حالة المراجعات — latest review decision, else awaiting-review / none. */
export function computeReviewStatus(
  deliverables: { status: string }[],
  reviews: { decision: string; created_at: string }[],
): { ar: string; en: string } {
  if (reviews.length > 0) {
    const latest = reviews.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
    if (latest.decision === "revision_requested") return { ar: "توجد ملاحظات", en: "Notes Provided" };
    if (latest.decision === "approved")            return { ar: "معتمد",        en: "Approved" };
  }
  if (deliverables.some((d) => d.status === "client_review")) return { ar: "بانتظار المراجعة", en: "Awaiting Review" };
  return { ar: "لا توجد مراجعات", en: "No Reviews" };
}

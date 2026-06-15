// ════════════════════════════════════════════════════════════════════════
// Kian Portal — shared project/deliverable status metadata (labels + order).
// Single source for the projects list, project detail timeline, and S7/S8.
// ════════════════════════════════════════════════════════════════════════

// Project STATUS values the DB actually supports (admin_set_project_status RPC
// validates against exactly these 7). The admin stage dropdown is built from
// these; setting any other value is rejected by the RPC.
export const STATUS_STEPS: { key: string; ar: string; en: string }[] = [
  { key: "request_received",   ar: "استلام الطلب",   en: "Request Received" },
  { key: "pre_production",     ar: "مرحلة التحضير",  en: "Pre-Production" },
  { key: "shooting_scheduled", ar: "جدولة التصوير",  en: "Shooting Scheduled" },
  { key: "shooting_completed", ar: "اكتمال التصوير", en: "Shooting Completed" },
  { key: "editing",            ar: "مرحلة المونتاج", en: "Editing" },
  { key: "ready_for_review",   ar: "جاهز للمراجعة",  en: "Ready for Review" },
  { key: "delivered",          ar: "تم التسليم",      en: "Delivered" },
];

export function projectStatusLabel(status: string): { ar: string; en: string } {
  return STATUS_STEPS.find((s) => s.key === status) ?? { ar: status, en: status };
}

// ─── Unified 10-step VISUAL timeline (project detail). Some steps are set by the
// admin (project.status, DB-backed) and some are reached only by deliverable
// state (client_review/approved/final_delivered). `filming` has no DB project
// status yet — see docs/phase1_project_stages_PROPOSAL.sql.
export type TimelineSource = "project" | "deliverable" | "proposed";
export const TIMELINE_STEPS: { key: string; ar: string; en: string; source: TimelineSource }[] = [
  { key: "request_received",   ar: "استلام الطلب",         en: "Request Received",        source: "project" },
  { key: "pre_production",     ar: "مرحلة التحضير",        en: "Pre-Production",          source: "project" },
  { key: "shooting_scheduled", ar: "جدولة التصوير",        en: "Shooting Scheduled",      source: "project" },
  { key: "filming",            ar: "مرحلة التصوير",        en: "Filming",                 source: "proposed" },
  { key: "shooting_completed", ar: "اكتمال التصوير",       en: "Shooting Completed",      source: "project" },
  { key: "editing",            ar: "مرحلة المونتاج",       en: "Editing",                 source: "project" },
  { key: "ready_for_review",   ar: "جاهز للمراجعة",        en: "Ready for Review",        source: "project" },
  { key: "client_review",      ar: "بانتظار اعتماد العميل", en: "Awaiting Client Approval", source: "deliverable" },
  { key: "approved",           ar: "معتمد",                en: "Approved",                source: "deliverable" },
  { key: "delivered",          ar: "تم التسليم",           en: "Delivered",               source: "project" },
];

// Map a DB project.status → its index in the 10-step visual timeline.
const PROJECT_STATUS_TO_TIMELINE: Record<string, number> = {
  request_received: 0, pre_production: 1, shooting_scheduled: 2,
  filming: 3, shooting_completed: 4, editing: 5, ready_for_review: 6, delivered: 9,
};

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
 * حالة التصوير — derived from the project stage (4 states):
 *   shooting_completed or later → تم التصوير
 *   filming                     → جاري التصوير
 *   shooting_scheduled / a date → تم جدولة التصوير
 *   before shooting             → لم يبدأ التصوير
 */
export function computeShootingStatus(
  shootingDate: string | null, projectStatus: string,
): { ar: string; en: string } {
  const idx = STATUS_STEPS.findIndex((s) => s.key === projectStatus);
  const scheduledIdx = STATUS_STEPS.findIndex((s) => s.key === "shooting_scheduled");
  const shotIdx = STATUS_STEPS.findIndex((s) => s.key === "shooting_completed");
  if (idx >= 0 && idx >= shotIdx)             return { ar: "تم التصوير",       en: "Shooting Completed" };
  if (projectStatus === "filming")            return { ar: "جاري التصوير",     en: "Filming" };
  if ((idx >= 0 && idx >= scheduledIdx) || shootingDate) return { ar: "تم جدولة التصوير", en: "Shooting Scheduled" };
  return { ar: "لم يبدأ التصوير", en: "Not Started" };
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
 * Active step in the 10-step visual timeline. Follows the admin-set project
 * stage first; live deliverable state can only override FORWARD (when stronger):
 *   final_delivered → تم التسليم (9)
 *   approved        → معتمد (8, or further if the project stage is already past it)
 *   client_review   → بانتظار اعتماد العميل (7, or further)
 *   revision_requested → back at the review/revision stage, never "delivered"
 * Display-only; never writes the DB.
 */
export function computeTimelineIndex(
  deliverables: { status: string }[], projectStatus: string,
): number {
  const base = PROJECT_STATUS_TO_TIMELINE[projectStatus] ?? 0;
  const has = (s: string) => deliverables.some((d) => d.status === s);
  const REVIEW = 6; // ready_for_review — the highest a revision round may show
  if (has("final_delivered"))     return 9;                            // تم التسليم
  if (has("approved"))            return Math.max(base, 8);            // معتمد
  if (has("client_review"))       return Math.max(base, 7);            // بانتظار اعتماد العميل
  if (has("revision_requested"))  return Math.min(REVIEW, Math.max(base, 5)); // review/revision, never delivered
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

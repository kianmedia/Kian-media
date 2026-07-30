// ════════════════════════════════════════════════════════════════════════════
// lib/portal/crm.ts — Phase 3: أساس إدارة علاقات العملاء والمبيعات.
//
// أغلفة رقيقة فوق دوالّ crm_* (كلّها SECURITY DEFINER على الخادم). لا منطق
// صلاحيات هنا: ما تراه الواجهة تجميل، والمنع الحقيقيّ في القاعدة.
//
// ★ الحالة الثلاثية بدل boolean ★
//   needs_migration → الدالّة غير موجودة (PGRST202/42883) ⇒ «بانتظار تفعيل
//                      قاعدة البيانات». الكود يُنشر قبل تشغيل الـSQL، فهذه
//                      حالة طبيعية لا عطل.
//   denied          → 42501/not authorized ⇒ «لا تملك صلاحية». لا يجوز أبدًا
//                      أن تُعرض كـ«ترحيلة ناقصة» — هذا الخلط أضاع دورة كاملة.
//   error/ok        → الباقي.
//
// ★ حدّ العقد مع منصّة المشاريع ★
//   لا دالّة في هذا الملفّ تُنشئ مشروعًا ولا تكتب في منصّة المشاريع. ربح
//   الفرصة يُسجَّل كـ«جاهزة لإنشاء يدويّ»، وcrmHandoffConfirm تسجّل أنّ
//   الإنشاء تمّ يدويًّا خارج الوحدة. راجع docs/CRM_PROJECT_HANDOFF_CONTRACT.md.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

export const CRM_MIGRATION_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/crm_sales_FOUNDATION_RUNME.sql. لا يوجد خطأ في صلاحياتك.";

export type CrmState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "denied"; message: string }
  | { state: "error"; message: string };

/** Map a raw PostgREST result into the tri-state above. Never guesses. */
function toState<T>(r: Result<unknown>): CrmState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: CRM_MIGRATION_AR };
    if (d.kind === "permission_denied" || /not authorized/i.test(r.error ?? "")) {
      return { state: "denied", message: "لا تملك صلاحية هذا الإجراء في وحدة المبيعات." };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status) };
  }
  const data = (r.data ?? {}) as Record<string, unknown>;
  // الخادم يعيد ok:false مع سبب مقروء لحالات العمل (لا استثناء) — تُعرض كما هي.
  if (data.ok === false) {
    return { state: "error", message: String(data.message ?? crmReasonAr(String(data.reason ?? "unknown"))) };
  }
  return { state: "ok", data: data as unknown as T };
}

/** أسباب العمل التي يعيدها الخادم بلا رسالة — تُترجم هنا ولا تُخترع. */
export function crmReasonAr(reason: string): string {
  switch (reason) {
    case "lead_not_found":          return "العميل المحتمل غير موجود أو محذوف.";
    case "opportunity_not_found":   return "الفرصة غير موجودة أو محذوفة.";
    case "company_not_found":       return "الشركة غير موجودة.";
    case "contact_not_found":       return "جهة الاتصال غير موجودة.";
    case "competitor_not_found":    return "المنافس غير موجود.";
    case "activity_not_found":      return "النشاط غير موجود.";
    case "target_not_found":        return "الهدف غير موجود.";
    case "plan_not_found":          return "خطّة العمولة غير موجودة.";
    case "record_not_found":        return "السجلّ غير موجود.";
    case "rule_not_found":          return "قاعدة الدرجة غير موجودة.";
    case "team_not_found":          return "الفريق غير موجود.";
    case "duplicate_suspected":     return "يوجد سجلّ مطابق — راجعه قبل الإنشاء.";
    case "already_converted":       return "العميل محوَّل إلى فرصة بالفعل.";
    case "already_closed":          return "الفرصة مغلقة بالفعل.";
    case "already_open":            return "الفرصة مفتوحة بالفعل.";
    case "handoff_recorded":        return "سُجِّل إنشاء مشروع لهذه الفرصة — لا تُعاد فتحها.";
    case "not_won":                 return "لا يُسجَّل تسليم لفرصة غير مربوحة.";
    case "not_open":                return "الفرصة ليست مفتوحة.";
    case "use_close":               return "الربح والخسارة يُضبطان من شاشة الإغلاق لا بتحريك المرحلة.";
    case "stage_not_found":         return "المرحلة غير موجودة.";
    case "stage_pipeline_mismatch": return "المرحلة تتبع خطّ أنابيب آخر.";
    case "lost_reason_required":    return "سبب الخسارة إلزاميّ.";
    case "reason_required":         return "السبب مطلوب (٣ أحرف على الأقلّ).";
    case "invalid_status":          return "حالة غير معروفة.";
    case "invalid_result":          return "نتيجة إغلاق غير معروفة.";
    case "invalid_kind":            return "نوع نشاط غير معروف.";
    case "parent_required":         return "النشاط يجب أن يتبع عميلًا محتملًا أو فرصة.";
    case "self_target_denied":      return "لا تُحرَّر أهدافك بنفسك.";
    case "self_commission_denied":  return "لا تُحرَّر عمولتك بنفسك.";
    case "owner_required":          return "مالك الهدف مطلوب.";
    case "period_required":         return "فترة الهدف مطلوبة.";
    case "idempotency_key_required":return "مفتاح تكرار الاستيراد مطلوب (٨ محارف فأكثر).";
    case "rows_must_be_array":      return "صيغة ملفّ الاستيراد غير صحيحة.";
    case "too_many_rows":           return "عدد الصفوف يتجاوز الحدّ (١٠٠٠ صفّ للدفعة).";
    case "unknown_entity":          return "نوع تصدير غير معروف.";
    case "unknown_setting":         return "إعداد غير معروف.";
    case "projects_absent":         return "جدول المشاريع غير موجود — سجّل التسليم بلا ربط.";
    case "project_not_found":       return "لم يُعثر على مشروع بهذا المعرّف.";
    case "no_pipeline":             return "لا يوجد خطّ أنابيب مفعّل.";
    case "no_stage":                return "لا توجد مرحلة صالحة للبدء.";
    case "key_required":            return "مفتاح القاعدة مطلوب.";
    case "adjust_out_of_range":     return "التعديل اليدويّ خارج المدى المسموح (−٥٠ إلى ٥٠).";
    case "override_out_of_range":   return "التجاوز خارج المدى المسموح (٠ إلى ١٠٠).";
    default:                        return "تعذّر تنفيذ الطلب.";
  }
}

// ─── العقد مع القاعدة (أسماء وتوقيعات) ─────────────────────────────────────

export interface CrmAccess {
  ok: boolean; authenticated: boolean; user_id: string | null;
  can_view: boolean; can_manage: boolean;
  can_view_team: boolean; team_key_exists: boolean;
  can_manage_pipeline: boolean; can_manage_scoring: boolean;
  can_manage_targets: boolean; can_manage_commission: boolean;
  can_view_others_commission: boolean;
  can_import: boolean; is_owner_role: boolean; is_client: boolean;
  quotes_available: boolean; projects_available: boolean;
  message: string | null;
}

export type CrmLeadStatus =
  | "new" | "contacted" | "working" | "qualified" | "unqualified" | "converted" | "dropped";
export type CrmOppStatus = "open" | "won" | "lost" | "abandoned";
export type CrmActivityKind =
  | "call" | "email" | "meeting" | "whatsapp_note" | "follow_up" | "note" | "demo" | "site_visit";
export type CrmHandoffState =
  | "not_ready" | "ready_for_manual_creation" | "manually_created" | "not_applicable";

export const LEAD_STATUS_AR: Record<CrmLeadStatus, string> = {
  new: "جديد", contacted: "جرى التواصل", working: "قيد العمل", qualified: "مؤهَّل",
  unqualified: "غير مؤهَّل", converted: "محوَّل", dropped: "مُسقَط",
};
export const LEAD_STATUS_COLOR: Record<CrmLeadStatus, string> = {
  new: "text-sky-300", contacted: "text-cyan-300", working: "text-amber-300",
  qualified: "text-emerald-300", unqualified: "text-stone-400",
  converted: "text-emerald-200", dropped: "text-red-300",
};
export const OPP_STATUS_AR: Record<CrmOppStatus, string> = {
  open: "مفتوحة", won: "مربوحة", lost: "مخسورة", abandoned: "متروكة",
};
export const OPP_STATUS_COLOR: Record<CrmOppStatus, string> = {
  open: "text-amber-300", won: "text-emerald-300", lost: "text-red-300", abandoned: "text-stone-400",
};
export const SOURCE_AR: Record<string, string> = {
  website: "الموقع", referral: "ترشيح", whatsapp: "واتساب", instagram: "إنستغرام",
  x: "منصّة X", linkedin: "لينكدإن", tiktok: "تيك توك", email: "بريد", phone: "هاتف",
  walk_in: "زيارة مباشرة", event: "فعالية", campaign: "حملة", partner: "شريك",
  existing_client: "عميل حاليّ", cold_outreach: "تواصل بارد", import: "استيراد", other: "أخرى",
};
export const BUDGET_AR: Record<string, string> = {
  unknown: "غير معروفة", under_10k: "أقلّ من ١٠ آلاف", "10k_50k": "١٠–٥٠ ألفًا",
  "50k_200k": "٥٠–٢٠٠ ألف", over_200k: "أكثر من ٢٠٠ ألف",
};
export const AUTHORITY_AR: Record<string, string> = {
  unknown: "غير معروف", gatekeeper: "حاجب", influencer: "مؤثّر", decision_maker: "صاحب قرار",
};
export const NEED_AR: Record<string, string> = {
  unknown: "غير معروفة", low: "منخفضة", medium: "متوسّطة", high: "عالية",
};
export const TIMELINE_AR: Record<string, string> = {
  unknown: "غير معروف", immediate: "فوريّ", this_quarter: "هذا الربع",
  this_year: "هذا العام", no_timeline: "بلا إطار",
};
export const ACTIVITY_AR: Record<CrmActivityKind, string> = {
  call: "اتصال", email: "بريد", meeting: "اجتماع", whatsapp_note: "ملاحظة واتساب",
  follow_up: "متابعة", note: "ملاحظة", demo: "عرض تجريبيّ", site_visit: "زيارة موقع",
};
export const LOST_REASON_AR: Record<string, string> = {
  price: "السعر", timing: "التوقيت", scope: "النطاق", competitor: "منافس",
  no_budget: "لا ميزانية", no_response: "لا ردّ", internal: "قرار داخليّ", other: "أخرى",
};
export const HANDOFF_AR: Record<CrmHandoffState, string> = {
  not_ready: "غير جاهزة",
  ready_for_manual_creation: "جاهزة لإنشاء المشروع يدويًّا",
  manually_created: "سُجِّل الإنشاء اليدويّ",
  not_applicable: "لا ينطبق",
};
export const GRADE_AR: Record<string, string> = { hot: "ساخن", warm: "دافئ", cold: "بارد" };
export const GRADE_COLOR: Record<string, string> = {
  hot: "text-red-300", warm: "text-amber-300", cold: "text-stone-400",
};

/** صفوف تُمرَّر كما هي — الخادم مصدر أسماء الحقول، لا نعيد تشكيلها. */
export type CrmRow = Record<string, unknown>;

export interface CrmScoreComponent {
  key: string; label_ar: string; label_en: string;
  field: string; operator: string; points: number; matched: boolean;
}
export interface CrmScore {
  ok: boolean; lead_id?: string; score: number; rules_total?: number;
  manual_adjust?: number; manual_reason?: string | null;
  override?: number | null; override_reason?: string | null;
  grade: string; activity_count?: number;
  components: CrmScoreComponent[]; explain?: string; reason?: string;
}
export interface CrmLeadRow {
  id: string; lead_code: string; contact_name: string; company_name: string | null;
  company_id: string | null; email: string | null; phone: string | null;
  source: string; status: CrmLeadStatus;
  budget_band: string; authority: string; need_level: string; timeline: string;
  estimated_value: number | null; currency: string;
  owner_user_id: string | null; next_action: string | null; next_action_due: string | null;
  last_activity_at: string | null; created_at: string;
  duplicate_of_id: string | null; score: number; grade: string;
}
export interface CrmDuplicateCandidate {
  lead_id: string; match_on: string; visible: boolean;
  lead_code: string | null; contact_name: string | null; company_name: string | null;
  status: string | null; created_at: string | null; note: string | null;
}
export interface CrmDuplicates {
  ok: boolean; checked: boolean; candidates: CrmDuplicateCandidate[];
  count?: number; window_days?: number; message?: string;
}
export interface CrmOppRow {
  id: string; opp_code: string; title: string; status: CrmOppStatus;
  stage_id: string; stage_key: string; stage_name_ar: string; stage_order: number;
  company_id: string | null; company_name: string | null;
  contact_id: string | null; contact_name: string | null;
  estimated_value: number; currency: string;
  probability: number; probability_is_manual: boolean; weighted_value: number;
  expected_close_date: string | null; owner_user_id: string | null;
  next_action: string | null; next_action_due: string | null;
  last_activity_at: string | null; stage_changed_at: string;
  lost_reason: string | null; competitor_id: string | null;
  handoff_state: CrmHandoffState; quote_request_id: string | null; created_at: string;
}
export interface CrmReadinessCheck { key: string; ar: string; required: boolean; ok: boolean }
export interface CrmReadiness {
  ok: boolean; opportunity_id?: string; score: number; passed?: number; required?: number;
  ready?: boolean; handoff_state?: CrmHandoffState; checks: CrmReadinessCheck[];
  contract?: string; reason?: string;
}
export interface CrmQuoteRef {
  available: boolean; id?: string; reference?: string | null; status?: string;
  created_at?: string; read_only?: boolean; reason?: string;
}
export interface CrmOppDetail {
  ok: boolean; can_edit: boolean;
  opportunity: CrmRow; stage: CrmRow | null;
  company: CrmRow | null; contact: CrmRow | null; competitor: CrmRow | null;
  quote: CrmQuoteRef | null; handoff_project_name: string | null;
  activities: CrmRow[]; stage_history: CrmRow[];
  readiness: CrmReadiness;
  /** null عندما لا يملك القارئ رؤية العمولة — وهذا ليس خطأً بل صلاحية. */
  commission: CrmRow[] | null; commission_visible: boolean;
}
export interface CrmLeadDetail {
  ok: boolean; can_edit: boolean; lead: CrmRow; score: CrmScore;
  company: CrmRow | null; contact: CrmRow | null;
  activities: CrmRow[]; opportunities: CrmRow[]; duplicates: CrmDuplicates;
}
export interface CrmStageColumn {
  stage_id: string; key: string; name_ar: string; name_en: string; sort_order: number;
  default_probability: number; is_won: boolean; is_lost: boolean;
  count: number; value: number; weighted: number;
}
export interface CrmBoard {
  ok: boolean; columns: CrmStageColumn[]; currency: string; can_manage: boolean;
}
export interface CrmForecastMonth {
  month: string; count: number; pipeline_value: number;
  weighted_value: number; committed_value: number; won_value: number;
}
export interface CrmForecast {
  ok: boolean; months: CrmForecastMonth[];
  no_close_date: { count: number; pipeline_value: number; weighted_value: number };
  currency: string; method: string;
}
export interface CrmStaleRow {
  opportunity_id: string; opp_code: string; title: string; owner_user_id: string | null;
  stage_name_ar: string; estimated_value: number; probability: number;
  expected_close_date: string | null; last_activity_at: string | null;
  days_since_activity: number | null; days_in_stage: number; reasons: string[];
}
export interface CrmStale { ok: boolean; rows: CrmStaleRow[]; count: number; stale_days: number; stage_days: number }
export interface CrmDashboard {
  ok: boolean; generated_at: string; can_manage: boolean;
  counters: Record<string, number>;
  pipeline: CrmBoard; forecast: CrmForecast; stale: CrmStale;
  funnel: Record<string, number>;
  sources: { source: string; count: number }[];
  my_targets: { period_start: string; period_end: string; period_type: string;
                target_value: number; achieved_value: number }[];
  currency: string;
}
export interface CrmLookups {
  ok: boolean; currency: string; stale_days: number;
  pipelines: { id: string; key: string; name_ar: string; name_en: string; is_default: boolean }[];
  stages: CrmStageColumn[];
  competitors: { id: string; name: string }[];
  companies: { id: string; name: string; city: string | null }[];
  contacts: { id: string; full_name: string; company_id: string | null;
              email: string | null; phone: string | null }[];
  teams: { id: string; name: string; manager_user_id: string | null }[];
  owners: { user_id: string; name: string }[];
  score_rules: CrmRow[];
}
export interface CrmCommissionList {
  ok: boolean; rows: CrmRow[]; plans: CrmRow[] | null;
  sees_others: boolean; can_manage_commission: boolean; note: string | null;
}
export interface CrmExport {
  ok: boolean; entity: string; columns: string[]; rows: (string | number | null)[][];
  commission_included: boolean; note: string;
}

export const STALE_REASON_AR: Record<string, string> = {
  no_activity: "بلا نشاط", stage_stuck: "عالقة في المرحلة",
  next_action_overdue: "الإجراء التالي متأخّر", no_next_action: "بلا إجراء تالٍ",
  close_date_passed: "تجاوزت تاريخ الإغلاق",
};

// ─── القراءة ────────────────────────────────────────────────────────────────

export const crmAccess = () =>
  prpc<CrmAccess>("crm_access", {}).then((r) => toState<CrmAccess>(r));

export const crmLookups = () =>
  prpc<unknown>("crm_lookups", {}).then((r) => toState<CrmLookups>(r));

export const crmLeadsList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_leads_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: CrmLeadRow[]; can_manage: boolean }>(r));

export const crmLeadDetail = (leadId: string) =>
  prpc<unknown>("crm_lead_detail", { p_lead: leadId }).then((r) => toState<CrmLeadDetail>(r));

export const crmDuplicates = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_duplicates", { p_payload: payload }).then((r) => toState<CrmDuplicates>(r));

export const crmOpportunitiesList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_opportunities_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: CrmOppRow[]; weighted_total: number; can_manage: boolean }>(r));

export const crmOpportunityDetail = (oppId: string) =>
  prpc<unknown>("crm_opportunity_detail", { p_opp: oppId }).then((r) => toState<CrmOppDetail>(r));

export const crmPipelineBoard = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_pipeline_board", { p_filters: filters }).then((r) => toState<CrmBoard>(r));

export const crmForecast = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_forecast", { p_filters: filters }).then((r) => toState<CrmForecast>(r));

export const crmStaleAlerts = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_stale_alerts", { p_filters: filters }).then((r) => toState<CrmStale>(r));

export const crmActivitiesList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_activities_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: CrmRow[] }>(r));

export const crmTargetsList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_targets_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: CrmRow[]; can_manage_targets: boolean }>(r));

export const crmCommissionList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_commission_list", { p_filters: filters }).then((r) => toState<CrmCommissionList>(r));

export const crmDashboard = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_dashboard", { p_filters: filters }).then((r) => toState<CrmDashboard>(r));

export const crmExport = (entity: "leads" | "opportunities" | "activities",
                          filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_export", { p_entity: entity, p_filters: filters }).then((r) => toState<CrmExport>(r));

export const crmAuditList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_audit_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: CrmRow[] }>(r));

// ─── الكتابة ────────────────────────────────────────────────────────────────

export const crmCompanyUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_company_upsert", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; created: boolean }>(r));

export const crmContactUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_contact_upsert", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; created: boolean }>(r));

export const crmCompetitorUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_competitor_upsert", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

/**
 * إنشاء/تعديل عميل محتمل. عند الإنشاء يرفض الخادم بـduplicate_suspected إن
 * وجد سجلًّا مطابقًا؛ أعد الإرسال مع confirm_duplicate: true بعد المراجعة.
 * ملاحظة: هذه الحالة تصل هنا كـstate:"error" برسالة الخادم — وهذا مقصود:
 * التكرار قرار بشريّ لا يُتجاوز صامتًا.
 */
export const crmLeadUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_lead_upsert", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; created: boolean; idempotent?: boolean; score: CrmScore }>(r));

/** يعيد نتيجة الخادم الخام — لعرض قائمة المطابقات بدل رسالة نصّية فقط. */
export async function crmLeadUpsertRaw(payload: Record<string, unknown>): Promise<
  | { kind: "ok"; id: string; created: boolean; idempotent: boolean }
  | { kind: "duplicate"; duplicates: CrmDuplicates; message: string }
  | { kind: "fail"; state: CrmState<never> }
> {
  const r = await prpc<Record<string, unknown>>("crm_lead_upsert", { p_payload: payload });
  if (!r.ok) return { kind: "fail", state: toState<never>(r) };
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (d.ok === false && d.reason === "duplicate_suspected") {
    return { kind: "duplicate", duplicates: d.duplicates as CrmDuplicates, message: String(d.message ?? "") };
  }
  if (d.ok === false) return { kind: "fail", state: toState<never>(r) };
  return { kind: "ok", id: String(d.id), created: Boolean(d.created), idempotent: Boolean(d.idempotent) };
}

export const crmLeadSetStatus = (leadId: string, status: CrmLeadStatus, reason?: string) =>
  prpc<unknown>("crm_lead_set_status", { p_lead: leadId, p_status: status, p_reason: reason ?? null })
    .then((r) => toState<{ ok: boolean; from: string; to: string }>(r));

export const crmLeadScoreAdjust = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_lead_score_adjust", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; score: CrmScore }>(r));

/** يُنشئ فرصة بيعية داخل المبيعات فقط — لا مشروع ولا كتابة في المنصّة. */
export const crmLeadConvert = (leadId: string, payload: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_lead_convert", { p_lead: leadId, p_payload: payload })
    .then((r) => toState<{ ok: boolean; lead_id: string; opportunity_id: string; opp_code: string; note: string }>(r));

export const crmLeadDelete = (leadId: string, reason: string) =>
  prpc<unknown>("crm_lead_delete", { p_lead: leadId, p_reason: reason })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmOpportunityUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_opportunity_upsert", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; created: boolean }>(r));

/** ربط مرجع عرض السعر — قراءة فقط، ولا تُعدَّل quote_requests إطلاقًا. */
export const crmOpportunityLinkQuote = (oppId: string, quoteId: string | null) =>
  prpc<unknown>("crm_opportunity_link_quote", { p_opp: oppId, p_quote: quoteId })
    .then((r) => toState<{ ok: boolean; id: string; quote: CrmQuoteRef; read_only: boolean }>(r));

export const crmOpportunitySetStage = (oppId: string, stageId: string, note?: string) =>
  prpc<unknown>("crm_opportunity_set_stage", { p_opp: oppId, p_stage: stageId, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string; stage_id: string; stage_key: string }>(r));

/** الربح يسجّل «جاهزة لإنشاء يدويّ» ولا يُنشئ مشروعًا. الخسارة تتطلّب سببًا. */
export const crmOpportunityClose = (
  oppId: string, result: "won" | "lost" | "abandoned", payload: Record<string, unknown> = {},
) =>
  prpc<unknown>("crm_opportunity_close", { p_opp: oppId, p_result: result, p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; status: string; handoff_state: CrmHandoffState;
                           readiness: CrmReadiness; contract: string | null }>(r));

export const crmOpportunityReopen = (oppId: string, reason: string) =>
  prpc<unknown>("crm_opportunity_reopen", { p_opp: oppId, p_reason: reason })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmOpportunityDelete = (oppId: string, reason: string) =>
  prpc<unknown>("crm_opportunity_delete", { p_opp: oppId, p_reason: reason })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

/**
 * ★ عقد التسليم: يسجّل أنّ العميل/المشروع أُنشئ **يدويًّا** خارج هذه الوحدة.
 *   لا يُنشئ شيئًا، ولا يكتب في منصّة المشاريع. أقصى ما يفعله: حفظ معرّف مشروع
 *   اختياريّ (يتحقّق أوّلًا من وجوده) وملاحظة تسليم.
 */
export const crmHandoffConfirm = (oppId: string, payload: Record<string, unknown> = {}) =>
  prpc<unknown>("crm_handoff_confirm", { p_opp: oppId, p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; handoff_state: CrmHandoffState;
                           handoff_project_id: string | null; project_name: string | null;
                           contract: string }>(r));

export const crmActivityLog = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_activity_log", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmActivityDelete = (id: string, reason: string) =>
  prpc<unknown>("crm_activity_delete", { p_id: id, p_reason: reason })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmScoreRuleUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_score_rule_upsert", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmSettingsSet = (key: string, value: unknown) =>
  prpc<unknown>("crm_settings_set", { p_key: key, p_value: value }).then((r) => toState<{ ok: boolean; key: string }>(r));

export const crmTeamUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_team_upsert", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmTeamMemberSet = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_team_member_set", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; team_id: string; user_id: string; removed: boolean }>(r));

/** الخادم يرفض تحرير هدفك أنت (self_target_denied) — لا تُلطَّف الرسالة هنا. */
export const crmTargetUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_target_upsert", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmTargetDelete = (id: string, reason: string) =>
  prpc<unknown>("crm_target_delete", { p_id: id, p_reason: reason }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmCommissionRecalc = (oppId: string) =>
  prpc<unknown>("crm_commission_recalc", { p_opp: oppId }).then((r) => toState<CrmRow>(r));

export const crmCommissionPlanUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_commission_plan_upsert", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmCommissionAssign = (payload: Record<string, unknown>) =>
  prpc<unknown>("crm_commission_assign", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const crmCommissionSetStatus = (id: string, status: "draft" | "approved" | "void", note?: string) =>
  prpc<unknown>("crm_commission_set_status", { p_id: id, p_status: status, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string; status: string }>(r));

export const crmImportLeads = (rows: Record<string, unknown>[], idempotencyKey: string) =>
  prpc<unknown>("crm_import_leads", { p_rows: rows, p_idempotency_key: idempotencyKey })
    .then((r) => toState<{ ok: boolean; batch_id: string; rows: number; inserted: number;
                           duplicates: number; errors: number; idempotent?: boolean;
                           result: { rows: CrmRow[] } }>(r));

// ─── مساعدات عرض ───────────────────────────────────────────────────────────

/** وقت الرياض — لا UTC. */
export function crmDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ar-SA-u-nu-latn",
      { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Riyadh" });
  } catch { return String(iso).slice(0, 10); }
}
export function crmDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const t = d.toLocaleTimeString("ar-SA-u-nu-latn",
      { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
    return `${crmDate(iso)} · ${t}`;
  } catch { return String(iso); }
}
/** YYYY-MM-DD في توقيت الرياض — لقيم <input type="date">. */
export function crmIsoDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
/** مبلغ بالأرقام اللاتينية — الأرقام المالية تُقرأ وتُنسخ، لا تُزخرف. */
export function crmMoney(v: number | string | null | undefined, currency = "SAR"): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}
export function scoreColor(score: number): string {
  if (score >= 70) return "text-red-300";
  if (score >= 40) return "text-amber-300";
  return "text-stone-400";
}
/** مفتاح تكرار مستقرّ لدفعة استيراد: نفس الملفّ ⇒ نفس المفتاح ⇒ لا ازدواج. */
export function crmImportKey(fileName: string, rowCount: number, firstCell: string): string {
  const raw = `${fileName}|${rowCount}|${firstCell}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return `imp_${h.toString(36)}_${rowCount}_${fileName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`.slice(0, 60);
}

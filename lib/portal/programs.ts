// ════════════════════════════════════════════════════════════════════════════
// lib/portal/programs.ts — Batch 8A: إدارة البرامج والإنتاج المستمرّ.
// يمتدّ فوق الهرمية القائمة (6A/6B): المشروع الرئيسي = البرنامج، والفرع = وحدة
// (حلقة/مرحلة/موقع/شهر/فعالية). لا مستوى هرميّ ثالث ولا نظام تقدّم موازٍ.
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type OperatingModel =
  | "phased_program" | "episode_series" | "monthly_retainer" | "campaign"
  | "multi_location" | "event_series" | "custom";
export type CadenceType = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "custom";
export type UnitType = "phase" | "episode" | "location" | "month" | "event" | "campaign_item" | "batch" | "custom";

export interface ProgramSettings {
  project_id: string; operating_model: OperatingModel;
  unit_label_ar: string | null; unit_label_en: string | null;
  numbering_prefix: string | null; numbering_start: number; target_units: number | null;
  planned_start_date: string | null; planned_end_date: string | null;
  cadence_type: CadenceType; cadence_interval: number;
  default_child_template_id: string | null; default_child_duration_days: number | null;
  default_manager_inheritance: boolean; default_team_inheritance: boolean;
  default_governance_inheritance: boolean; default_closure_inheritance: boolean;
  require_all_units_closed_before_program_close: boolean;
  client_program_view_enabled: boolean;
  version: number; created_at: string; updated_at: string;
}
export interface ProgramMilestone { id: string; title: string; at: string; status: string; overdue: boolean }
export interface ProgramWarning { code: string; ar: string; count: number }
export interface ProgramForecast {
  available: boolean; reason?: "no_target" | "no_velocity" | "target_met";
  remaining_units?: number; units_per_30d?: number; projected_finish?: string; basis?: string;
}
export interface ProgramDashboard {
  project_id: string;
  settings: ProgramSettings | null;
  units: {
    target: number | null; created: number; unplanned: number | null;
    active: number; delayed: number; critical: number;
    awaiting_client: number; delivered: number; closed: number;
  };
  own_health: string | null;
  children_aggregate_health: string | null;
  progress: { own: number | null; children_aggregate: number | null; operational_by_count_pct: number | null };
  dates: { earliest_due: string | null; latest_due: string | null; planned_start: string | null; planned_end: string | null };
  /** available=false يعني «لا وحدة مُسلَّمة تحمل تاريخ تسليم» لا «السرعة صفر». */
  velocity: { delivered_7d: number; delivered_30d: number; delivered_90d: number; available: boolean; dated_units: number; basis: string };
  forecast: ProgramForecast;
  /** المصدر الغائب يعيد "unavailable" لا صفرًا مضلِّلًا. تعارضات الموارد ليست هنا:
   *  محرّكها لا يقبل تصفية بالمشروع، فرقمها على مستوى المنظّمة ويُعرض في 7B/4D. */
  governance: {
    critical_risks: number | "unavailable"; critical_issues: number | "unavailable";
    overdue_approvals: number | "unavailable"; change_requests_pending: number | "unavailable";
  };
  milestones: ProgramMilestone[];
  warnings: ProgramWarning[];
  today: string; generated_at: string;
}

export interface ProgramUnit {
  project_id: string; project_name: string;
  unit_number: number | null; unit_code: string | null; unit_type: UnitType | null;
  season_number: number | null; batch_number: number | null; workstream: string | null;
  core_stage: string; health: string | null;
  start_date: string | null; due_date: string | null;
  planned_release_date: string | null; actual_release_date: string | null;
  progress_pct: number | null; manager_name: string | null;
  overdue_tasks: number; critical_risks: number; critical_issues: number; pending_approvals: number;
  closure_status: string | null;
}
export interface ProgramUnits {
  units: ProgramUnit[]; total: number; limit: number; offset: number;
  has_more: boolean; today: string; generated_at: string;
}
export interface UnitFilters extends Record<string, unknown> {
  core_stage?: string; unit_type?: string; season_number?: number; batch_number?: number;
  manager_id?: string; health?: string; overdue_only?: boolean; critical_only?: boolean;
  awaiting_client?: boolean; not_started?: boolean; closed_only?: boolean;
  search?: string; limit?: number; offset?: number;
}

export const projectProgramDashboard = (projectId: string) =>
  prpc<ProgramDashboard>("project_program_dashboard", { p_project: projectId });
export const projectProgramUnits = (projectId: string, filters: UnitFilters = {}) =>
  prpc<ProgramUnits>("project_program_units", { p_project: projectId, p_filters: filters });
export const projectProgramSettingsUpsert = (projectId: string, data: Record<string, unknown>, expectedVersion?: number) =>
  prpc<ProgramSettings>("project_program_settings_upsert", { p_project: projectId, p_data: data, p_expected_version: expectedVersion ?? null });
export const projectUnitMetadataUpsert = (projectId: string, data: Record<string, unknown>, reason?: string) =>
  prpc<{ ok: boolean; project_id: string; unit_number: number | null }>("project_unit_metadata_upsert",
    { p_project: projectId, p_data: data, p_reason: reason ?? null });

export const OPERATING_MODEL_AR: Record<OperatingModel, string> = {
  phased_program: "برنامج بمراحل", episode_series: "سلسلة حلقات", monthly_retainer: "عقد شهري",
  campaign: "حملة", multi_location: "مواقع متعددة", event_series: "سلسلة فعاليات", custom: "مخصّص",
};
export const UNIT_TYPE_AR: Record<UnitType, string> = {
  phase: "مرحلة", episode: "حلقة", location: "موقع", month: "شهر",
  event: "فعالية", campaign_item: "عنصر حملة", batch: "دفعة", custom: "وحدة",
};
export const CADENCE_AR: Record<CadenceType, string> = {
  none: "بلا تواتر", daily: "يومي", weekly: "أسبوعي", biweekly: "كل أسبوعين", monthly: "شهري", custom: "مخصّص",
};
/** تسمية الوحدة المعروضة: إعداد البرنامج أوّلًا ثم النوع ثم افتراضي محايد. */
export const unitLabel = (s: ProgramSettings | null, unitType?: UnitType | null): string =>
  s?.unit_label_ar || (unitType ? UNIT_TYPE_AR[unitType] : null) || "وحدة";

export function programErr(e: string): string {
  if (/program_requires_master/.test(e)) return "إدارة البرنامج متاحة للمشروع الرئيسي فقط.";
  if (/unit_requires_subproject/.test(e)) return "بيانات الوحدة تُسنَد للمشاريع الفرعية فقط.";
  if (/duplicate_unit_number/.test(e)) return "رقم الوحدة مستخدم بالفعل داخل هذا البرنامج.";
  if (/reason_required/.test(e)) return "تغيير رقم الوحدة يتطلّب سببًا.";
  if (/stale_update/.test(e)) return "توجد نسخة أحدث من الإعدادات — أعد التحميل.";
  if (/bad_unit_type/.test(e)) return "نوع الوحدة غير صالح.";
  if (/not_found/.test(e)) return "المشروع غير موجود.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية إدارة هذا البرنامج.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "وحدة البرامج (8A) غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}

// ════════════════════════════════════════════════════════════════════════════
// Batch 8B — مخطّط الموجة المتدرّجة (معاينة بلا كتابة ثمّ تطبيق ذرّي).
// ════════════════════════════════════════════════════════════════════════════
export interface PlanRow {
  index: number; unit_number: number; unit_code: string | null; project_name: string;
  unit_type: string | null; season_number: number | null; batch_number: number | null;
  workstream: string | null; start_date: string | null; due_date: string | null;
  duplicate_number: boolean;
}
export interface PlanNote { code: string; ar: string; [k: string]: unknown }
export interface PlanPreview {
  plan: { rows: PlanRow[]; count: number; start_number: number; duplicate_count: number; parent_name: string | null; settings_present: boolean };
  template_id: string | null;
  existing_units: number;
  target_units: number | null;
  remaining_after: number | null;
  warnings: PlanNote[];
  errors: PlanNote[];
  /** غير null ⇒ سبق تطبيق نفس المفتاح، والتطبيق سيُعيد النتيجة بلا إنشاء جديد. */
  already_applied: { created_count: number; created_at: string } | null;
  can_apply: boolean;
  generated_at: string;
}
export interface PlanApplyResult {
  ok: boolean; replayed: boolean; created_count: number;
  first_unit_number?: number; last_unit_number?: number;
  units?: { project_id: string; unit_number: number; project_name: string }[];
  summary?: Record<string, unknown>;
}
export interface ShiftPreview {
  ok: boolean; applied: boolean; units: number; days: number;
  rows: { project_id: string; project_name: string; from_start: string | null; to_start: string | null; from_due: string | null; to_due: string | null }[];
}
export interface PlanPayload extends Record<string, unknown> {
  count?: number; start_number?: number; numbering_prefix?: string; name_pattern?: string;
  cadence?: CadenceType; cadence_interval?: number; first_start_date?: string;
  unit_duration_days?: number; gap_days?: number;
  unit_type?: UnitType; season_number?: number; batch_number?: number; workstream?: string;
  template_id?: string; modules?: string[]; idempotency_key?: string;
  inherit_manager?: boolean; inherit_team?: boolean; inherit_governance?: boolean;
  core_stage?: string; priority?: string;
}

export const programPlanPreview = (parentId: string, payload: PlanPayload = {}) =>
  prpc<PlanPreview>("project_program_plan_preview", { p_parent: parentId, p_payload: payload });
export const programPlanApply = (parentId: string, payload: PlanPayload, idempotencyKey: string) =>
  prpc<PlanApplyResult>("project_program_plan_apply", { p_parent: parentId, p_payload: payload, p_idempotency_key: idempotencyKey });
export const programUnitsShiftDates = (parentId: string, unitIds: string[], days: number, reason: string, apply = false) =>
  prpc<ShiftPreview>("project_program_units_shift_dates",
    { p_parent: parentId, p_unit_ids: unitIds, p_days: days, p_reason: reason, p_apply: apply });

/** أنماط تسمية معلنة (لا Black Box) — تُعرض للمستخدم كما تُنفَّذ في SQL. */
export const NAME_PATTERNS: { pattern: string; ar: string }[] = [
  { pattern: "الحلقة {unit_number}", ar: "الحلقة ١، الحلقة ٢ …" },
  { pattern: "المرحلة {unit_number}", ar: "المرحلة ١، المرحلة ٢ …" },
  { pattern: "{parent_name} — حلقة {unit_number}", ar: "اسم البرنامج — حلقة ١ …" },
  { pattern: "{prefix}-{unit_number:02}", ar: "PRE-01، PRE-02 …" },
  { pattern: "شهر {month_name}", ar: "شهر يناير، شهر فبراير …" },
];

export function planErr(e: string): string {
  if (/idempotency_key_required/.test(e)) return "مفتاح منع التكرار مفقود.";
  if (/plan_not_applicable/.test(e)) return "الخطة غير قابلة للتطبيق — راجع الأخطاء في المعاينة.";
  if (/duplicate_unit_number/.test(e)) return "تعارض في أرقام الوحدات — أعد المعاينة.";
  if (/no_modules/.test(e)) return "اختر وحدة واحدة على الأقلّ من القالب.";
  if (/nothing_to_create/.test(e)) return "لا وحدات لإنشائها.";
  if (/create_failed/.test(e)) return "تعذّر إنشاء إحدى الوحدات — أُلغيت الدفعة كاملة.";
  if (/no_units|no_matching_units/.test(e)) return "لا وحدات مختارة.";
  if (/no_shift/.test(e)) return "حدّد عدد أيام الإزاحة.";
  if (/reason_required/.test(e)) return "السبب إلزامي.";
  return programErr(e);
}

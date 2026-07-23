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

// ════════════════════════════════════════════════════════════════════════════
// lib/portal/programSla.ts — Batch 8D: التزامات البرنامج ومحرّك القياس ومصفوفة
// التسليم. كل رقم هنا مشتقّ من الخادم؛ الواجهة لا تحسب SLA ولا تشتقّ حالة.
// «غير متاح» ليست صفرًا، والتسليم الفعليّ ليس تاريخًا مخطَّطًا.
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type CommitmentType =
  | "total_unit_volume" | "periodic_unit_volume" | "monthly_output"
  | "on_time_delivery_rate" | "delivery_turnaround" | "review_turnaround"
  | "revision_turnaround" | "approval_turnaround" | "response_turnaround" | "custom";
export type TargetUnit = "count" | "percent" | "hours" | "days" | "business_days" | "minutes";
export type PeriodType = "project" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type SlaStatus = "met" | "warning" | "breached" | "unavailable" | "not_started";

export const COMMITMENT_TYPE_AR: Record<CommitmentType, string> = {
  total_unit_volume: "إجمالي عدد الوحدات",
  periodic_unit_volume: "عدد الوحدات في الفترة",
  monthly_output: "الإنتاج الشهري",
  on_time_delivery_rate: "نسبة التسليم في الموعد",
  delivery_turnaround: "زمن التسليم بعد التصوير",
  review_turnaround: "زمن مراجعة العميل",
  revision_turnaround: "زمن تنفيذ التعديل",
  approval_turnaround: "زمن الاعتماد",
  response_turnaround: "زمن الاستجابة لملاحظات العميل",
  custom: "التزام مخصّص (متابعة يدوية)",
};
export const TARGET_UNIT_AR: Record<TargetUnit, string> = {
  count: "عدد", percent: "٪", hours: "ساعة", days: "يوم", business_days: "يوم عمل", minutes: "دقيقة",
};
export const PERIOD_TYPE_AR: Record<PeriodType, string> = {
  project: "على المشروع كاملًا", daily: "يومي", weekly: "أسبوعي", monthly: "شهري",
  quarterly: "ربع سنوي", yearly: "سنوي", custom: "فترة مخصّصة",
};
export const SLA_STATUS_AR: Record<SlaStatus, string> = {
  met: "مُحقَّق", warning: "تحذير", breached: "مخروق", unavailable: "غير متاح", not_started: "لم يبدأ",
};
export const SLA_STATUS_COLOR: Record<SlaStatus, string> = {
  met: "#16a34a", warning: "#d97706", breached: "#dc2626", unavailable: "#78716c", not_started: "#57534e",
};

/** لماذا لا يوجد رقم — يُترجَم حرفيًّا، فلا يُقرأ نقص البيانات كأداء سيّئ. */
export const MISSING_REASON_AR: Record<string, string> = {
  no_units: "لا توجد وحدات تحت هذا البرنامج بعد.",
  no_unit_has_both_planned_and_actual: "لا توجد وحدة تملك موعدًا مخطَّطًا وتسليمًا موثَّقًا معًا.",
  shoot_wrap_or_delivery_not_recorded: "لم يُوثَّق انتهاء التصوير (wrap) أو التسليم الفعليّ.",
  no_send_event_paired_with_a_client_decision: "لا يوجد إرسال للعميل يقابله قرار منه.",
  no_revision_followed_by_a_new_version: "لا يوجد طلب تعديل تلاه رفع نسخة جديدة.",
  no_decided_approval_in_period: "لا يوجد اعتماد صدر فيه قرار خلال الفترة.",
  no_resolved_client_comment_in_period: "لا توجد ملاحظة عميل عولجت خلال الفترة.",
  client_comments_source_unavailable: "مصدر ملاحظات العميل غير متاح في هذه القاعدة.",
  custom_commitment_has_no_declared_formula: "التزام مخصّص: يُتابَع يدويًّا ولا يُحسب آليًّا.",
  no_target_value: "لم تُحدَّد قيمة الهدف لهذا الالتزام.",
  measurement_window_empty: "نافذة القياس فارغة (سريان الالتزام يقصّها إلى العدم).",
  no_measurement_window: "التزام دوريّ بلا فترة قياس محدَّدة.",
  partial_unit_visibility: "لا ترى كل وحدات البرنامج، فالرقم جزئيّ.",
  target_unit_incompatible_with_duration: "وحدة الهدف لا تُعبّر عن مدّة زمنية (اختر ساعة/يوم/دقيقة).",
};
export const forecastReasonAr = (k: string | null): string => {
  if (!k) return "";
  const m: Record<string, string> = {
    sample_size_below_minimum: "العيّنة أقلّ من ٣ تسليمات — لا معدّل موثوق.",
    measurement_window_too_short: "نافذة القياس أقصر من أسبوعين.",
    zero_delivery_rate: "معدّل التسليم صفر — لا يمكن التوقّع.",
    projection_beyond_reasonable_horizon: "التوقّع يتجاوز الأفق المعقول (٥ سنوات).",
    forecast_not_defined_for_this_commitment_type: "لا توقّع معرَّف لهذا النوع من الالتزامات.",
    target_reached: "بلغ الهدف بالفعل.",
  };
  return m[k] ?? k;
};

export interface Commitment {
  id: string; project_id: string; commitment_key: string; commitment_type: CommitmentType;
  name_ar: string; name_en: string | null; description: string | null;
  target_value: number | null; target_unit: TargetUnit; period_type: PeriodType;
  period_start: string | null; period_end: string | null;
  effective_from: string | null; effective_to: string | null;
  warning_threshold: number | null; critical_threshold: number | null;
  measurement_source: string | null; client_visible: boolean; is_active: boolean;
  version: number; created_at: string; updated_at: string; archived_at: string | null;
}

export interface CommitmentResult {
  commitment_id: string; commitment_key: string; commitment_type: CommitmentType;
  name_ar: string; name_en: string | null; client_visible: boolean;
  target: number | null; actual: number | null;
  numerator: number | null; denominator: number | null;
  unit: TargetUnit; status: SlaStatus; variance: number | null; higher_is_better: boolean;
  formula_key: string; formula_ar: string | null;
  sample_size: number; period_from: string | null; period_to: string | null;
  source_quality: string; missing_data_reason: string | null;
  warning_threshold: number | null; critical_threshold: number | null; generated_at: string;
}
export interface CommitmentResults {
  project_id: string; results: CommitmentResult[]; today: string;
  generated_at: string; timezone_note: string;
}

export interface SlaForecastRow {
  commitment_id: string; commitment_key: string; name_ar: string; status: SlaStatus;
  currently_breached: boolean; approaching_warning: boolean;
  forecast_status: string; forecast_reason: string | null;
  forecast_rate_per_30d: number | null; forecasted_completion: string | null;
  forecasted_breach: boolean | null; formula_ar: string;
}
export interface SlaForecast {
  project_id: string; forecasts: SlaForecastRow[];
  counters: { met: number; warning: number; breached: number; unavailable: number };
  today: string; generated_at: string;
}

export interface MatrixRow {
  project_id: string; project_name: string;
  unit_number: number | null; unit_code: string | null; unit_type: string | null;
  season_number: number | null; batch_number: number | null; workstream: string | null;
  core_stage: string | null; progress_pct: number | null; health: string | null;
  manager_id: string | null; manager_name: string | null;
  planned_start: string | null; planned_end: string | null; planned_release_date: string | null;
  /** null = لم يُوثَّق تسليم فعليّ. لا يُملأ من تاريخ مخطَّط أبدًا. */
  actual_delivery_at: string | null;
  days_early_late: number | null;
  deliverables_total: number;
  current_deliverable: { id: string; title: string; status: string } | null;
  awaiting_client: boolean; revision_requested: boolean; needs_final_master: boolean;
  pending_approvals: number; closure_status: string | null;
  missing_data: string[];
}
export interface DeliveryMatrix {
  project_id: string; rows: MatrixRow[]; total: number; limit: number; offset: number;
  has_more: boolean; today: string; generated_at: string;
}

export interface ClientActionRow {
  project_id: string; project_name: string; unit_number: number | null;
  deliverable_id: string; deliverable_title: string;
  kind: "awaiting_client_decision" | "revision_not_yet_resent";
  waiting_since: string | null; days_waiting: number | null; stale: boolean;
  open_client_comments: number;
}
export interface ClientActions {
  project_id: string; rows: ClientActionRow[]; stale_days: number;
  today: string; generated_at: string; note: string;
}

export interface ClientProgramSummary {
  project_id: string; program_name: string;
  units: {
    project_id: string; project_name: string; unit_number: number | null; unit_code: string | null;
    planned_release_date: string | null; stage_label_ar: string; progress_pct: number | null;
    delivered: boolean; delivered_at: string | null;
    awaiting_your_review: boolean; available_deliverables: number;
  }[];
  units_total: number; units_delivered: number; units_awaiting_you: number;
  next_release_date: string | null;
  commitments: { name_ar: string; target: number | null; actual: number | null; unit: TargetUnit;
    status: SlaStatus; period_from: string | null; period_to: string | null; formula_ar: string | null }[];
  today: string; generated_at: string;
}

export interface SlaAttention {
  rows: { project_id: string; project_name: string; commitment_key: string; name_ar: string;
    status: SlaStatus; target: number | null; actual: number | null; unit: TargetUnit; sample_size: number }[];
  programs_scanned: number; limit: number; generated_at: string;
}
export interface ExecutiveProgramSla {
  programs_total: number; programs_scanned: number; programs_truncated: number;
  programs_with_commitments: number;
  programs_on_target: number; programs_warning: number; programs_breached: number;
  programs_missing_sla_data: number;
  /** null = لا عيّنة، وليس ٠٪. */
  on_time_delivery_rate: number | null; on_time_sample_size: number;
  units_delivered_this_month: number; client_pending_actions: number;
  month_from: string; score_note: string; generated_at: string;
}

// ─────────────────────────────── الأغلفة ───────────────────────────────
export const programCommitmentUpsert = (projectId: string, data: Record<string, unknown>, expectedVersion?: number) =>
  prpc<{ ok: boolean; commitment_id: string; version: number }>("project_program_commitment_upsert",
    { p_project: projectId, p_data: data, p_expected_version: expectedVersion ?? null });
export const programCommitmentArchive = (commitmentId: string, reason: string) =>
  prpc<{ ok: boolean; commitment_id: string }>("project_program_commitment_archive",
    { p_commitment: commitmentId, p_reason: reason });
export const programCommitmentResults = (projectId: string, from?: string, to?: string) =>
  prpc<CommitmentResults>("project_program_commitment_results",
    { p_project: projectId, p_from: from ?? null, p_to: to ?? null });
export const programSlaForecast = (projectId: string) =>
  prpc<SlaForecast>("project_program_sla_forecast", { p_project: projectId });
export const programDeliveryMatrix = (projectId: string, filters: Record<string, unknown> = {}) =>
  prpc<DeliveryMatrix>("project_program_delivery_matrix", { p_project: projectId, p_filters: filters });
export const programClientActions = (projectId: string, filters: Record<string, unknown> = {}) =>
  prpc<ClientActions>("project_program_client_actions", { p_project: projectId, p_filters: filters });
export const programClientSummary = (projectId: string) =>
  prpc<ClientProgramSummary>("project_program_client_summary", { p_project: projectId });
export const programSlaAttention = (filters: Record<string, unknown> = {}) =>
  prpc<SlaAttention>("program_sla_attention", { p_filters: filters });
export const executiveProgramSla = (filters: Record<string, unknown> = {}) =>
  prpc<ExecutiveProgramSla>("executive_program_sla", { p_filters: filters });

/** قائمة الالتزامات للتحرير — قراءة مباشرة محكومة بـRLS (طاقم + pc_can_read_project). */
export const programCommitmentsList = (projectId: string) =>
  import("./client").then(({ pget }) =>
    pget<Commitment[]>(`project_program_commitments?project_id=eq.${encodeURIComponent(projectId)}` +
      `&archived_at=is.null&select=*&order=commitment_type.asc,commitment_key.asc`));

export function slaErr(e: string): string {
  if (/program_requires_master/.test(e)) return "الالتزامات تُدار على مستوى البرنامج (المشروع الرئيسي) فقط.";
  if (/client_program_view_disabled/.test(e)) return "عرض البرنامج للعميل غير مفعَّل في إعدادات البرنامج.";
  if (/duplicate_commitment_key/.test(e)) return "مفتاح الالتزام مستخدَم بالفعل في هذا البرنامج.";
  if (/commitment_key_required/.test(e)) return "مفتاح الالتزام إلزامي.";
  if (/commitment_archived/.test(e)) return "هذا الالتزام مؤرشف ولا يقبل التعديل.";
  if (/already_archived/.test(e)) return "الالتزام مؤرشف بالفعل.";
  if (/stale_update/.test(e)) return "عُدِّل الالتزام من مستخدم آخر — أعد التحميل ثم حاول.";
  if (/reason_required/.test(e)) return "السبب إلزامي.";
  if (/name_required/.test(e)) return "اسم الالتزام إلزامي.";
  if (/not_found/.test(e)) return "الالتزام غير موجود.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية إدارة التزامات هذا البرنامج.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "وحدة الالتزامات (8D) غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}

/** عرض قيمة قد تكون «غير متاحة» — لا نطبع ٠ مكان المجهول. */
export const slaValue = (v: number | null | undefined, unit: TargetUnit): string =>
  v == null ? "—" : `${v}${unit === "percent" ? "٪" : ` ${TARGET_UNIT_AR[unit]}`}`;

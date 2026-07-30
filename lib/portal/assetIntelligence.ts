// ════════════════════════════════════════════════════════════════════════════
// lib/portal/assetIntelligence.ts — طبقة العميل لحزمة ذكاء الأصول.
//
// توسعة لـlib/portal/custodyInventory.ts، لا بديل عنه: الأنواع الأساسية (الأصل،
// العهدة، البند) تبقى هناك، وهنا ما أضافته الحزمة فقط — الحالة المُشتقّة، الحجز
// بحارسه، دفتر الاستخدام، خطط الصيانة وإشاراتها، الاستغلال، التكلفة المالكيّة.
//
// ثلاث قواعد تحكم كلّ دالّة هنا:
//   ١) **الكود يسبق الـSQL**: غياب الدالّة يُصنَّف «بانتظار التفعيل» ويُعاد كحالة
//      معلنة — لا انهيار، ولا بيانات وهمية، ولا صفر يقف مقام «غير مفعّل».
//   ٢) **التعارض ليس ترحيلة ناقصة**: 23P01 يُصنَّف CONFLICT مستقلًّا. خلطه
//      بـ«شغّل الترحيلة» يدفع أحدهم إلى تشغيل ملفّ قديم فوق قاعدة حيّة.
//   ٣) **لا تكلفة إلّا خلف بوّابتها**: دوالّ التكلفة منفصلة عن دوالّ التشغيل هنا
//      كما هي منفصلة في القاعدة، ورفضها 42501 يُعرض «غير مصرّح» لا «خطأ».
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "@/lib/portal/client";
import { pgClassify, pgIsMigrationPending, type PgErrorKind } from "@/lib/portal/pgerror";

// ─── الأنواع ───────────────────────────────────────────────────────────────

/** الحالات العشر — مُشتقّة في القاعدة، لا مخزّنة في عمود. */
export type AssetState =
  | "available" | "reserved" | "checked_out" | "in_use" | "returned_pending_inspection"
  | "maintenance" | "damaged" | "missing" | "retired" | "disposed";

export type MeterType =
  | "usage_hours" | "sessions" | "shutter_count" | "battery_cycles"
  | "flight_hours" | "recording_hours" | "distance_km" | "custom";

export type MaintenanceSignalKey =
  | "service_due_soon" | "service_overdue" | "service_meter_reached"
  | "high_fault_frequency" | "excessive_downtime" | "repeated_damage"
  | "warranty_expiring" | "inspection_overdue" | "high_usage"
  | "low_utilization" | "replacement_review";

export const ASSET_STATE_AR: Record<AssetState, string> = {
  available: "متاح",
  reserved: "محجوز",
  checked_out: "مصروف",
  in_use: "قيد الاستخدام",
  returned_pending_inspection: "بانتظار فحص الإرجاع",
  maintenance: "في الصيانة",
  damaged: "تالف",
  missing: "مفقود",
  retired: "متقاعد",
  disposed: "مخرَّد",
};

export const METER_TYPE_AR: Record<MeterType, string> = {
  usage_hours: "ساعات تشغيل",
  sessions: "جلسات",
  shutter_count: "عدّاد الغالق",
  battery_cycles: "دورات البطارية",
  flight_hours: "ساعات طيران",
  recording_hours: "ساعات تسجيل",
  distance_km: "مسافة (كم)",
  custom: "عدّاد مخصّص",
};

export const SIGNAL_AR: Record<MaintenanceSignalKey, string> = {
  service_due_soon: "صيانة مستحقّة قريبًا",
  service_overdue: "صيانة متأخّرة",
  service_meter_reached: "عدّاد الصيانة استُنفد",
  high_fault_frequency: "تكرار أعطال",
  excessive_downtime: "تعطّل مفرط",
  repeated_damage: "تلف متكرّر",
  warranty_expiring: "الضمان يقارب الانتهاء",
  inspection_overdue: "فحص متأخّر",
  high_usage: "استخدام مرتفع",
  low_utilization: "استخدام منخفض",
  replacement_review: "مراجعة استبدال",
};

export interface AssetReservation {
  id: string;
  asset_id: string;
  asset_code: string | null;
  asset_name: string | null;
  quantity: number;
  status: "active" | "fulfilled" | "cancelled" | "expired";
  reserved_from: string | null;
  reserved_to: string | null;
  hold_expires_at: string | null;
  note: string | null;
  project_id: string | null;
  fulfilled_by_assignment_id: string | null;
  is_overdue_hold: boolean;
}

/** صدق التغطية: ما يراه محرّك التعارض وما لا يراه — يُعرض للمستخدم كما هو. */
export interface ConflictCoverage {
  reservations: boolean;
  live_custody: boolean;
  production_jobs: boolean;
  planning_bookings: boolean;
}

export interface ReservationCalendar {
  rows: AssetReservation[];
  coverage: ConflictCoverage;
  note_ar: string;
}

export interface MeterTotal {
  meter_type: MeterType;
  /**
   * القيمة التراكمية للعدّاد. تحترم النمطين: في increment حاصل جمع الزيادات،
   * وفي absolute آخر قراءة من الجهاز مضافًا إليها ما سُجِّل بعدها.
   */
  total: number;
  /** النمط الغالب لهذا العدّاد — تعرضه الشاشة كي لا يُقرأ رقم الجهاز كمجموع جلسات. */
  reading_mode: "increment" | "absolute";
  last_reading_at: string | null;
  entries: number;
}

export interface MaintenancePlanDue {
  plan_id: string;
  plan_code: string;
  plan_name: string;
  asset_id: string;
  asset_code: string;
  asset_name: string;
  maintenance_type: string;
  interval_days: number | null;
  interval_meter_type: MeterType | null;
  interval_meter_value: number | null;
  interval_usage_count: number | null;
  manual_threshold_note: string | null;
  last_done_at: string | null;
  next_due_at: string | null;
  days_remaining: number | null;
  meter_since_last: number | null;
  meter_remaining: number | null;
  issues_since_last: number;
  lead_time_days: number;
  blocks_availability: boolean;
}

export interface MaintenanceSignal {
  asset_id: string;
  asset_code: string;
  signal: MaintenanceSignalKey;
  severity: "high" | "medium" | "low";
  /** القاعدة المعلنة — الإشارة تُراجَع وتُرفَض لأنّ أساسها معروض. ليست تنبّؤًا. */
  rule: string;
  basis: Record<string, unknown>;
}

/** سطح تشغيليّ — `contains_financials` دائمًا false، والواجهة تؤكّده ولا تفترضه. */
export interface AssetUtilization {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  state: AssetState | null;
  from: string;
  to: string;
  days_in_period: number;
  days_out: number;
  days_idle: number;
  downtime_days: number;
  times_issued: number;
  utilization_pct: number | null;
  availability_pct: number | null;
  contains_financials: false;
}

/** سطح مالكيّ. `null` يعني «المصدر غير مفعّل» — لا يُعرض صفرًا أبدًا. */
export interface AssetCostSummary {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  owner_only: true;
  acquisition: {
    purchase_price: number | null; purchase_date: string | null; supplier_name: string | null;
    current_value: number | null; book_value: number | null; salvage_value: number | null;
    useful_life_months: number | null; accumulated_depreciation: number | null;
  };
  maintenance: { maintenance_total: number; repair_total: number };
  rental_replacement: { total: number | null; source_available: boolean };
  total_cost_of_ownership: number;
  usage: { usage_hours: number; sessions: number };
  cost_per_hour: number | null;
  cost_per_session: number | null;
  utilization: AssetUtilization;
  replacement_recommendation: "replace_review" | "underused" | "overused_consider_second_unit" | "keep";
  sources: Record<string, boolean>;
}

// ─── تصنيف الأخطاء ─────────────────────────────────────────────────────────

export type AssetFailure =
  | { kind: "pending_migration"; message: string }
  | { kind: "conflict"; message: string; hint: string | null }
  | { kind: "state_rejected"; message: string; hint: string | null }
  | { kind: "forbidden"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "other"; message: string; pg: PgErrorKind };

/**
 * يفصل الحالات التي لا يجوز الخلط بينها:
 *   • 23P01 تعارض حجز — **ليس** ترحيلة ناقصة.
 *   • 23514 حالة الأصل تمنع العملية — غير الازدحام.
 *   • 42501 صلاحية — غير عطل.
 *   • 42P01/42703/PGRST202/204/205 ترحيلة غير مطبَّقة.
 */
export function classifyAssetError(error: string, status?: number): AssetFailure {
  const raw = error ?? "";
  if (/23P01|civ_double_booking/i.test(raw)) {
    return { kind: "conflict", message: raw, hint: extractHint(raw) };
  }
  if (/23514|civ_reservation_rejected|state:/i.test(raw)) {
    return { kind: "state_rejected", message: raw, hint: extractHint(raw) };
  }
  if (/civ_qr_rate_limited|54000/i.test(raw)) {
    return { kind: "rate_limited", message: raw };
  }
  const d = pgClassify(raw, status);
  if (d.kind === "permission_denied" || /not authorized|42501|staff only/i.test(raw)) {
    return { kind: "forbidden", message: raw };
  }
  // pgIsMigrationPending هو الحكم الوحيد المسموح بعرضه «الترحيل معلّق»؛
  // وschema_cache_stale يُضمّ إليه لأنّ RUNME ينتهي بـnotify pgrst فالعلاج نفسه.
  if (pgIsMigrationPending(d) || d.kind === "schema_cache_stale") {
    return { kind: "pending_migration", message: raw };
  }
  return { kind: "other", message: raw, pg: d.kind };
}

function extractHint(raw: string): string | null {
  const m = /\b(equipment|custody|reservation|state):([^\s)'"]+)/i.exec(raw);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** رسالة عربية واحدة لكلّ حالة — لا رسالة عامّة تخفي الفرق. */
export function assetFailureAr(f: AssetFailure): string {
  switch (f.kind) {
    case "pending_migration":
      return "الميزة بانتظار تفعيل قاعدة البيانات.";
    case "conflict":
      return f.hint?.startsWith("custody:")
        ? `الأصل مصروف على العهدة ${f.hint.slice(8)} في فترة متقاطعة.`
        : f.hint?.startsWith("equipment:")
          ? "الأصل مرتبط بأمر تشغيل في الفترة نفسها."
          : "الأصل محجوز أو مصروف في فترة متقاطعة.";
    case "state_rejected":
      return "لا يمكن تنفيذ العملية على هذا الأصل بحالته الراهنة.";
    case "forbidden":
      return "لا تملك صلاحية هذه العملية.";
    case "rate_limited":
      return "تجاوزت حدّ المسح المسموح — انتظر دقيقة.";
    default:
      return "تعذّر إتمام العملية.";
  }
}

// ─── حالة الأصل والانتقالات ────────────────────────────────────────────────

export const assetState = (assetId: string) =>
  prpc<AssetState | null>("civ_asset_state", { p_asset: assetId });

export const allowedTransitions = (entity: "asset" | "assignment" | "reservation", from: string) =>
  prpc<string[]>("civ_allowed_transitions", { p_entity: entity, p_from: from });

// ─── الحجز ─────────────────────────────────────────────────────────────────

export interface CreateReservationInput {
  asset_id: string;
  quantity?: number;
  employee_id?: string | null;
  project_id?: string | null;      // مرجع قراءة اختياريّ — منصّة المشاريع مجمَّدة
  field_task_id?: string | null;
  reserved_from?: string | null;
  reserved_to?: string | null;
  hold_expires_at?: string | null;
  note?: string | null;
}

/**
 * ⚠️ v2 عمدًا: النسخة الأولى لا تفحص أيّ حجز آخر. الضمان الحقيقيّ يقع في حارس
 * على الجدول (فيغطّي المسارين)، وv2 تفحص قبل الإدراج لتعطي رسالة مفهومة.
 */
export const createReservationV2 = (v: CreateReservationInput) =>
  prpc<{ ok: boolean; id: string; asset_code: string }>(
    "custody_inv_admin_create_reservation_v2",
    {
      p_data: {
        asset_id: v.asset_id,
        quantity: v.quantity ?? 1,
        employee_id: v.employee_id ?? null,
        project_id: v.project_id ?? null,
        field_task_id: v.field_task_id ?? null,
        reserved_from: v.reserved_from ?? null,
        reserved_to: v.reserved_to ?? null,
        hold_expires_at: v.hold_expires_at ?? null,
        note: v.note ?? null,
      },
    },
  );

export const fulfilReservation = (id: string, assignmentId: string | null) =>
  prpc<boolean>("custody_inv_fulfil_reservation", { p_id: id, p_assignment: assignmentId });

export const expireReservations = () => prpc<number>("custody_inv_expire_reservations", {});

export const reservationCalendar = (from?: string | null, to?: string | null, assetId?: string | null) =>
  prpc<ReservationCalendar>("custody_inv_reservation_calendar", {
    p_from: from ?? null, p_to: to ?? null, p_asset: assetId ?? null,
  });

// ─── QR ────────────────────────────────────────────────────────────────────

export interface QrScanResult {
  ok: boolean;
  /** ما رآه هذا المستخدم فعلًا — تعرضه الشاشة كما هو بدل ادّعاء تفصيل أعلى. */
  level: "public" | "operations" | "manage";
  payload: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
}

export const qrScan = (token: string, context = "manual") =>
  prpc<QrScanResult>("custody_inv_qr_scan", { p_token: token, p_context: context });

export const revokeQr = (assetId: string, reason: string) =>
  prpc<boolean>("custody_inv_admin_revoke_qr", { p_asset: assetId, p_reason: reason });

/** بديل حين يتلف الرمز — الكود أو الباركود أو السيريال أو الاسم. */
export const lookupAsset = (query: string) =>
  prpc<{ ok: boolean; rows: Record<string, unknown>[] }>("custody_inv_lookup_asset", { p_query: query });

// ─── دفتر الاستخدام ────────────────────────────────────────────────────────

export interface RecordMeterInput {
  asset_id: string;
  meter_type: MeterType;
  value: number;
  custom_meter_label?: string | null;
  reading_mode?: "increment" | "absolute";
  unit?: string | null;
  source?: "manual" | "device" | "import" | "custody_return" | "maintenance" | "rental" | "other";
  recorded_at?: string | null;
  assignment_id?: string | null;
  maintenance_id?: string | null;
  job_reference?: string | null;
  project_id?: string | null;
  /** ★ فريد **عالميًّا**: إعادة الإرسال نفسها تُعيد الصفّ نفسه، والمفتاح نفسه
   *  بأصل أو قيمة مختلفة يُرفض بدل أن يُقيَّد على الأصل الخطأ. */
  idempotency_key?: string | null;
  note?: string | null;
}

export const recordMeter = (v: RecordMeterInput) =>
  prpc<{ ok: boolean; id: string; duplicate: boolean }>("custody_inv_record_meter", { p_data: v });

/** التصحيح **بعكس القيد** — الدفتر ملحق: لا UPDATE ولا DELETE. */
export const reverseMeter = (id: string, reason: string) =>
  prpc<string>("custody_inv_reverse_meter", { p_id: id, p_reason: reason });

export const meterTotals = (assetId: string) =>
  prpc<{ ok: boolean; asset_id: string; meters: MeterTotal[] }>(
    "custody_inv_asset_meter_totals", { p_asset: assetId });

// ─── الصيانة ───────────────────────────────────────────────────────────────

export interface MaintenancePlanInput {
  id?: string | null;
  plan_name: string;
  asset_id?: string | null;
  category_id?: string | null;
  maintenance_type?: "preventive" | "inspection" | "calibration" | "other";
  interval_days?: number | null;
  interval_meter_type?: MeterType | null;
  interval_meter_value?: number | null;
  interval_usage_count?: number | null;
  manual_threshold_note?: string | null;
  lead_time_days?: number;
  last_done_at?: string | null;
  blocks_availability?: boolean;
  is_active?: boolean;
  notes?: string | null;
}

export const upsertMaintenancePlan = (v: MaintenancePlanInput) =>
  prpc<{ ok: boolean; id: string }>("custody_inv_maint_plan_upsert", { p_data: v });

export const archiveMaintenancePlan = (id: string, reason: string) =>
  prpc<boolean>("custody_inv_maint_plan_archive", { p_id: id, p_reason: reason });

export const maintenanceDue = (assetId?: string | null) =>
  prpc<{ ok: boolean; rows: MaintenancePlanDue[] }>("custody_inv_maint_plan_due", { p_asset: assetId ?? null });

export const maintenanceSignals = (assetId?: string | null) =>
  prpc<{ ok: boolean; engine: "rules"; signals: MaintenanceSignal[]; note_ar: string }>(
    "custody_inv_maintenance_signals", { p_asset: assetId ?? null });

/** إغلاق بإعادة تقييم إلزاميّة — لا رجوع تلقائيّ إلى «متاح». */
export const closeMaintenanceWithInspection = (
  maintenanceId: string,
  grade: string,
  note: string,
  finalCost?: number | null,
) => prpc<{ ok: boolean; grade: string; condition_status: string }>(
  "custody_inv_maint_close_with_inspection",
  { p_maintenance: maintenanceId, p_grade: grade, p_note: note, p_final_cost: finalCost ?? null },
);

// ─── الاستغلال والتكلفة ────────────────────────────────────────────────────

export const assetUtilization = (assetId: string, from?: string | null, to?: string | null) =>
  prpc<AssetUtilization>("custody_inv_asset_utilization", {
    p_asset: assetId, p_from: from ?? null, p_to: to ?? null,
  });

/** ★ مالكيّ حصرًا. الرفض 42501 يُعرض «غير مصرّح» — لا «تعذّر التحميل». */
export const assetCostSummary = (assetId: string) =>
  prpc<AssetCostSummary>("custody_inv_asset_cost_summary", { p_asset: assetId });

// ─── تصحيح ما بعد الإغلاق ──────────────────────────────────────────────────

/** التصحيح حدثٌ مُدقَّق، لا تعديل صامت لتاريخ عهدة مغلقة. */
export const postClosureCorrection = (assignmentId: string, reason: string, detail?: Record<string, unknown>) =>
  prpc<string>("custody_inv_post_closure_correction", {
    p_assignment: assignmentId, p_reason: reason, p_detail: detail ?? {},
  });

// ─── مساعد عرض ─────────────────────────────────────────────────────────────

/**
 * يحوّل نتيجة أيّ نداء إلى ثلاثيّة صريحة تعرضها الشاشة كما هي:
 * بيانات · «بانتظار التفعيل» · سبب مصنّف. لا حالة رابعة صامتة.
 */
export function unwrap<T>(r: Result<T>): { data: T | null; pending: boolean; failure: AssetFailure | null } {
  if (r.ok) return { data: r.data, pending: false, failure: null };
  const f = classifyAssetError(r.error, r.status);
  return { data: null, pending: f.kind === "pending_migration", failure: f };
}

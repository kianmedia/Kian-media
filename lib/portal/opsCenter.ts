// ════════════════════════════════════════════════════════════════════════════
// lib/portal/opsCenter.ts — Phase 2: مركز التشغيل والإنتاج.
//
// أغلفة رقيقة فوق دوالّ prodops_* (كلّها SECURITY DEFINER على الخادم). لا منطق
// صلاحيات هنا: ما تراه الواجهة تجميل، والمنع الحقيقيّ في القاعدة.
//
// ★ الحالة الثلاثية بدل boolean ★
//   الواجهة يجب أن تفرّق بين ثلاث حالات لا اثنتين:
//     needs_migration → الدالّة غير موجودة (PGRST202/42883) ⇒ «بانتظار تفعيل
//                        قاعدة البيانات». المالك يدفع الكود قبل تشغيل الـSQL،
//                        فهذه حالة طبيعية لا عطل.
//     denied          → 42501/not authorized ⇒ «لا تملك صلاحية». لا يجوز أبدًا
//                        أن تُعرض كـ«ترحيلة ناقصة» — هذا الخلط أضاع دورة كاملة.
//     error/ok        → الباقي.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

export const OPS_MIGRATION_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/operations_center_RUNME.sql. لا يوجد خطأ في صلاحياتك.";

export type OpsState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "denied"; message: string }
  | { state: "error"; message: string };

/** Map a raw PostgREST result into the tri-state above. Never guesses. */
function toState<T>(r: Result<unknown>): OpsState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: OPS_MIGRATION_AR };
    if (d.kind === "permission_denied" || /not authorized/i.test(r.error ?? "")) {
      return { state: "denied", message: "لا تملك صلاحية هذا الإجراء في مركز التشغيل." };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status) };
  }
  const data = (r.data ?? {}) as Record<string, unknown>;
  // الخادم يعيد ok:false مع سبب مقروء لحالات العمل (لا استثناء) — تُعرض كما هي.
  if (data.ok === false) {
    return { state: "error", message: String(data.message ?? opsReasonAr(String(data.reason ?? "unknown"))) };
  }
  return { state: "ok", data: data as unknown as T };
}

/** أسباب العمل التي يعيدها الخادم بلا رسالة — تُترجم هنا ولا تُخترع. */
export function opsReasonAr(reason: string): string {
  switch (reason) {
    case "job_not_found":      return "المهمّة غير موجودة أو محذوفة.";
    case "row_not_found":      return "السجلّ غير موجود.";
    case "job_mismatch":       return "هذا السجلّ يتبع مهمّة أخرى.";
    case "not_assigned":       return "لست ضمن طاقم هذه المهمّة.";
    case "already_submitted":  return "التقرير مُرسَل ولا يُعدَّل.";
    case "already_published":  return "الورقة منشورة — أنشئ نسخة جديدة.";
    case "invalid_transition": return "انتقال حالة غير مسموح.";
    case "invalid_status":     return "حالة غير معروفة.";
    case "invalid_step":       return "خطوة نسخ احتياطي غير معروفة.";
    case "reason_required":    return "السبب مطلوب (٣ أحرف على الأقلّ).";
    case "job_id_required":    return "المهمّة مطلوبة.";
    case "unknown_kind":       return "نوع سجلّ غير معروف.";
    case "card_not_found":     return "بطاقة الذاكرة غير موجودة.";
    // ★ رفضٌ من القاعدة لا تحذيرٌ من الشاشة: الحجز لم يُسجَّل أصلًا.
    case "double_booked":      return "حجز مزدوج — الحجز لم يُسجَّل. راجع تبويب التعارضات.";
    case "not_card_holder":    return "هذه البطاقة ليست بعهدتك — لا تُوقَّع نسخها إلّا من حاملها أو المدير.";
    case "needs_two_copies":   return "لا يُعلَّم التحقّق قبل تسجيل نسختين فعليًّا (الأولى والثانية).";
    default:                   return "تعذّر تنفيذ الطلب.";
  }
}

// ─── العقد مع القاعدة (أسماء وتوقيعات) ─────────────────────────────────────

export interface OpsAccess {
  ok: boolean; authenticated: boolean;
  can_view: boolean; can_manage: boolean; is_client: boolean;
  is_crew: boolean; is_post: boolean;
  user_id: string | null; message: string | null;
}

export type OpsJobType =
  | "filming" | "photography" | "drone" | "live_stream" | "podcast"
  | "editing" | "design" | "field_execution" | "event" | "other";
export type OpsJobStatus =
  | "draft" | "scheduled" | "confirmed" | "in_progress" | "on_hold" | "completed" | "cancelled";

export const JOB_TYPE_AR: Record<OpsJobType, string> = {
  filming: "تصوير فيديو", photography: "تصوير فوتوغرافي", drone: "درون",
  live_stream: "بث مباشر", podcast: "بودكاست", editing: "مونتاج",
  design: "تصميم", field_execution: "تنفيذ ميداني", event: "فعالية", other: "أخرى",
};
export const JOB_STATUS_AR: Record<OpsJobStatus, string> = {
  draft: "مسوّدة", scheduled: "مجدولة", confirmed: "مؤكّدة", in_progress: "جارية",
  on_hold: "معلّقة", completed: "منتهية", cancelled: "ملغاة",
};
export const JOB_STATUS_COLOR: Record<OpsJobStatus, string> = {
  draft: "text-stone-400", scheduled: "text-sky-300", confirmed: "text-emerald-300",
  in_progress: "text-amber-300", on_hold: "text-orange-300",
  completed: "text-stone-300", cancelled: "text-red-300",
};
export const PRIORITY_AR: Record<string, string> = {
  low: "منخفضة", normal: "عادية", high: "عالية", urgent: "عاجلة",
};
export const CREW_ROLE_AR: Record<string, string> = {
  director: "مخرج", producer: "منتج", dop: "مدير تصوير", camera: "كاميرا",
  camera_assistant: "مساعد كاميرا", gaffer: "إضاءة", sound: "صوت",
  drone_pilot: "طيّار درون", stylist: "ستايلست", talent: "ممثل/متحدّث",
  editor: "مونتير", designer: "مصمّم", coordinator: "منسّق", driver: "سائق",
  crew: "طاقم", other: "أخرى",
};
export const CREW_STATUS_AR: Record<string, string> = {
  invited: "مدعوّ", assigned: "مُسنَد", confirmed: "مؤكّد",
  declined: "معتذر", no_show: "لم يحضر", attended: "حضر",
};
export const PERMIT_STATUS_AR: Record<string, string> = {
  not_required: "غير مطلوب", pending: "قيد الإعداد", submitted: "مُقدَّم",
  approved: "معتمد", rejected: "مرفوض", expired: "منتهٍ",
  // Wave 3 · V2-3.2-A: السجلّ العامّ يضيف "revoked" (تصريح سُحب بعد إصداره).
  // أُضيفت هنا لا في خريطة ثانية — مفردة واحدة للشيء الواحد.
  revoked: "ملغى",
};
export const EQUIP_STATUS_AR: Record<string, string> = {
  requested: "مطلوب", reserved: "محجوز", handed_over: "مُسلَّم",
  returned: "مُعاد", cancelled: "ملغى",
};
export const HSE_STATUS_AR: Record<string, string> = {
  pending: "لم يُفحص", ok: "سليم", na: "لا ينطبق", issue: "ملاحظة",
};
export const CONFLICT_AR: Record<string, string> = {
  person_double_booked: "شخص محجوز مرّتين",
  equipment_double_reserved: "جهاز محجوز مرّتين",
  location_clash: "تعارض موقع",
  studio_clash: "تعارض استوديو",
  equipment_reserved_elsewhere: "الجهاز محجوز في المخزون",
  planning_booking_overlap: "تداخل مع حجز تخطيط",
};

export interface OpsJobRow {
  id: string; job_code: string; title: string; job_type: OpsJobType;
  status: OpsJobStatus; priority: string;
  scheduled_start: string | null; scheduled_end: string | null;
  location_id: string | null; location_name: string | null; location_note: string | null;
  project_id: string | null; project_name: string | null; client_label: string | null;
  crew_count: number; equip_count: number;
}
export interface OpsReadinessCheck { key: string; ar: string; required: boolean; ok: boolean }
export interface OpsReadiness {
  ok: boolean; job_id?: string; score: number; passed?: number; required?: number;
  checks: OpsReadinessCheck[]; reason?: string;
}
export interface OpsConflict {
  kind: string; severity: string; ar: string;
  subject_id: string | null; asset_label?: string | null; location_name?: string | null;
  job_a: string | null; job_a_title?: string | null; job_a_code?: string | null;
  job_b?: string | null; job_b_title?: string | null; job_b_code?: string | null;
  overlap_from: string | null; overlap_to: string | null;
  external_source?: string; external_ref?: string;
}
export interface OpsConflictReport {
  ok: boolean; from: string; to: string;
  internal: OpsConflict[];
  external: { items: OpsConflict[]; sources?: Record<string, string> };
  total: number;
}
/** صفوف الأبناء تُمرَّر كما هي — الخادم مصدر أسماء الحقول، لا نعيد تشكيلها. */
export type OpsRow = Record<string, unknown>;

export interface OpsJobDetail {
  ok: boolean; can_manage: boolean; user_id: string | null;
  job: Record<string, unknown>;
  location: OpsRow | null;
  crew: OpsRow[]; equipment: OpsRow[]; permits: OpsRow[]; travel: OpsRow[];
  accommodation: OpsRow[]; vehicles: OpsRow[]; hse: OpsRow[]; weather: OpsRow[];
  media_cards: OpsRow[]; backups: OpsRow[]; ingest: OpsRow[];
  post_handoff: OpsRow[]; daily_reports: OpsRow[];
  incidents: OpsRow[]; delays: OpsRow[]; call_sheets: OpsRow[];
  readiness: OpsReadiness; conflicts: OpsConflict[];
}
export interface OpsDashboard {
  ok: boolean; can_manage: boolean; generated_at: string;
  today: OpsRow[]; next_7_days: OpsRow[];
  conflicts: OpsConflictReport;
  missing_crew: OpsRow[]; missing_equipment: OpsRow[];
  missing_permits: OpsRow[]; media_not_backed_up: OpsRow[];
  counters: Record<string, number>;
}
export interface OpsAssignments {
  ok: boolean; user_id: string; assignments: OpsRow[]; post_work: OpsRow[];
}
export interface OpsLookups {
  ok: boolean;
  locations: { id: string; name: string; kind: string; city: string | null;
               contact_name: string | null; contact_phone: string | null }[];
  vehicles: { id: string; label: string; plate_no: string | null; vehicle_type: string }[];
  people: { user_id: string; name: string; job_title: string | null }[];
  professions: { id: string; key: string; name_ar: string }[];
  assets: { id: string; code: string; name: string; availability: string }[];
  /** "unavailable" = موديول المخزون غير مطبَّق ⇒ اسم الجهاز نصّ حرّ، بلا ادّعاء تكامل. */
  assets_source: string;
  /** الربط بالمشروع اختياريّ وللعرض فقط — المنصّة مجمَّدة ولا يُكتب فيها شيء. */
  projects: { id: string; name: string }[];
  /** "unavailable" = جدول المشاريع غير موجود ⇒ الربط معطّل، لا «لا مشاريع». */
  projects_source: string;
}

/** ورقة النداء كما يبنيها prodops_call_sheet — الخادم هو من يُصفّي، لا الطباعة. */
export interface OpsCallSheetData {
  ok: boolean;
  sheet: OpsRow | null;
  job: { id: string; job_code: string; title: string; job_type: OpsJobType;
         scheduled_start: string | null; scheduled_end: string | null;
         client_label: string | null; project_name: string | null };
  location: OpsRow | null;
  crew: { crew_role: string; user_id: string | null; name: string | null; phone: string | null;
          call_time: string | null; wrap_time: string | null; status: string }[];
  vehicles: OpsRow[];
  hse: { item_ar: string; status: string; is_required: boolean }[];
  weather: OpsRow | null;
  weather_note: string;
}

/** أنواع الأبناء التي يقبلها المُحرِّر العامّ على الخادم (قائمة بيضاء مطابقة). */
export type OpsChildKind =
  | "crew" | "equipment" | "permit" | "travel" | "accommodation" | "vehicle_assignment"
  | "hse" | "weather" | "media_card" | "ingest" | "post_handoff" | "incident"
  | "delay" | "call_sheet";

// ─── القراءة ────────────────────────────────────────────────────────────────

export const opsAccess = () =>
  prpc<OpsAccess>("prodops_access", {}).then((r) => toState<OpsAccess>(r));

export const opsJobsList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("prodops_jobs_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: OpsJobRow[]; can_manage: boolean }>(r));

export const opsJobDetail = (jobId: string) =>
  prpc<unknown>("prodops_job_detail", { p_job: jobId }).then((r) => toState<OpsJobDetail>(r));

export const opsDashboard = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("prodops_dashboard", { p_filters: filters }).then((r) => toState<OpsDashboard>(r));

export const opsMyAssignments = (days = 14) =>
  prpc<unknown>("prodops_my_assignments", { p_filters: { days } }).then((r) => toState<OpsAssignments>(r));

export const opsCalendar = (from: string, to: string, filters: Record<string, unknown> = {}) =>
  prpc<unknown>("prodops_calendar", { p_from: from, p_to: to, p_filters: filters })
    .then((r) => toState<{ ok: boolean; from: string; to: string; days: OpsRow[] }>(r));

export const opsConflicts = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("prodops_conflicts", { p_filters: filters }).then((r) => toState<OpsConflictReport>(r));

export const opsCallSheet = (jobId: string, date: string | null = null) =>
  prpc<unknown>("prodops_call_sheet", { p_job: jobId, p_date: date })
    .then((r) => toState<OpsCallSheetData>(r));

export const opsReadiness = (jobId: string) =>
  prpc<unknown>("prodops_readiness", { p_job: jobId }).then((r) => toState<OpsReadiness>(r));

export const opsLookups = () =>
  prpc<unknown>("prodops_lookups", {}).then((r) => toState<OpsLookups>(r));

// ─── الكتابة ────────────────────────────────────────────────────────────────

export const opsJobUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("prodops_job_upsert", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; created: boolean }>(r));

export const opsJobSetStatus = (jobId: string, status: OpsJobStatus, note?: string) =>
  prpc<unknown>("prodops_job_set_status", { p_job: jobId, p_status: status, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; from: string; to: string }>(r));

export const opsJobDelete = (jobId: string, reason: string) =>
  prpc<unknown>("prodops_job_delete", { p_job: jobId, p_reason: reason })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

export const opsChildUpsert = (kind: OpsChildKind, payload: Record<string, unknown>) =>
  prpc<unknown>("prodops_child_upsert", { p_kind: kind, p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; kind: string; job_id: string }>(r));

export const opsChildDelete = (kind: OpsChildKind | "daily_report", id: string, reason: string) =>
  prpc<unknown>("prodops_child_delete", { p_kind: kind, p_id: id, p_reason: reason })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

export const opsHseSeed = (jobId: string) =>
  prpc<unknown>("prodops_hse_seed", { p_job: jobId }).then((r) => toState<{ ok: boolean; added: number }>(r));

export const opsConfirmAttendance = (jobId: string, status: "confirmed" | "declined" | "attended", note?: string) =>
  prpc<unknown>("prodops_confirm_attendance", { p_job: jobId, p_status: status, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; crew_id: string; status: string }>(r));

export const opsDailyReportUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("prodops_daily_report_upsert", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; status: string }>(r));

export const opsPostHandoffProgress = (
  id: string, status: "accepted" | "in_progress" | "returned" | "done", note?: string,
) =>
  prpc<unknown>("prodops_post_handoff_progress", { p_id: id, p_status: status, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string; status: string }>(r));

export const opsBackupStep = (
  cardId: string, step: "primary" | "second" | "nas" | "verified", done = true, path?: string,
) =>
  prpc<unknown>("prodops_backup_step", { p_card: cardId, p_step: step, p_done: done, p_path: path ?? null })
    .then((r) => toState<Record<string, unknown>>(r));

export const opsLocationUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("prodops_location_upsert", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const opsVehicleUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("prodops_vehicle_upsert", { p_payload: payload }).then((r) => toState<{ ok: boolean; id: string }>(r));

export const opsCallSheetPublish = (id: string) =>
  prpc<unknown>("prodops_call_sheet_publish", { p_id: id }).then((r) => toState<{ ok: boolean; id: string }>(r));

// ─── مساعدات عرض ───────────────────────────────────────────────────────────

/** وقت الرياض — لا UTC. المركز يُستعمل على الموقع، والوقت المعروض يجب أن يطابق الساعة. */
export function opsTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ar-SA-u-nu-latn",
      { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
  } catch { return String(iso).slice(11, 16); }
}
export function opsDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ar-SA-u-nu-latn",
      { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Riyadh" });
  } catch { return String(iso).slice(0, 10); }
}
export function opsDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${opsDate(iso)} · ${opsTime(iso)}`;
}
/** YYYY-MM-DD في توقيت الرياض — لقيم <input type="date">. */
export function opsIsoDay(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  return p;
}
export function readinessColor(score: number): string {
  if (score >= 90) return "text-emerald-300";
  if (score >= 60) return "text-amber-300";
  return "text-red-300";
}


// ─── Wave 3 · V2-3.2-A / V2-3.4-B · سجلّ التصاريح ووسائط التشغيل ────────────
//
// ⛔ نفس عائلة `prodops_` (قرار D-2) ونفس `prpc` — لا مسار وصول ثانٍ.
// العلم مطفأ ⇒ لا يُستدعى أيّ ممّا يلي، فلا طلب شبكة خلف بوّابة مغلقة.

/** هل تُعرض واجهة سجلّ التصاريح والوسائط؟ الافتراض **مطفأ**. */
export const opsPermitsEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_SHOW_OPS_PERMITS_REGISTRY === "true";

export interface OpsPermitRow {
  id: string;
  permit_type: string;
  title: string;
  authority_name: string | null;
  reference_no: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: string;
  scope: string;
  project_id: string | null;
  asset_id: string | null;
  activity_note: string | null;
  owner_user_id: string | null;
  note: string | null;
  /** مشتقّ في القاعدة — لا عمود مخزَّن يتعفّن كلّ منتصف ليل. */
  days_left: number | null;
  media_count: number;
}

export interface OpsMediaRow {
  id: string;
  media_type: string;
  bucket: string;
  /** مسار داخل الدلو — **ليس رابطًا**. الرابط يُوقَّع عند الطلب وينتهي. */
  path: string;
  caption: string | null;
  sort_order: number;
  added_by: string | null;
  created_at: string;
}

export const opsPermitsList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("prodops_permits_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: OpsPermitRow[]; can_manage: boolean }>(r));

export const opsPermitUpsert = (payload: Record<string, unknown>) =>
  prpc<string>("prodops_permit_upsert", { p_payload: payload }).then((r) => toState<string>(r));

export const opsPermitDelete = (id: string, reason: string) =>
  prpc<boolean>("prodops_permit_delete", { p_id: id, p_reason: reason }).then((r) => toState<boolean>(r));

export const opsMediaList = (ownerKind: "location" | "permit", ownerId: string) =>
  prpc<unknown>("prodops_media_list", { p_owner_kind: ownerKind, p_owner_id: ownerId })
    .then((r) => toState<{ ok: boolean; rows: OpsMediaRow[]; can_manage: boolean }>(r));

export const opsMediaDelete = (id: string, reason: string) =>
  prpc<boolean>("prodops_media_delete", { p_id: id, p_reason: reason }).then((r) => toState<boolean>(r));

/** مفردات عربية — مطابقة لقيود القاعدة حرفيًّا، ولا تُخترع.
    (حالات التصريح تُقرأ من `PERMIT_STATUS_AR` أعلاه — لا خريطة ثانية.) */
export const PERMIT_TYPE_AR: Record<string, string> = {
  municipality: "بلدية", police: "شرطة", property_owner: "مالك العقار",
  airspace_drone: "طيران/درون", client_site: "موقع العميل", venue: "قاعة", other: "أخرى",
};
export const PERMIT_SCOPE_AR: Record<string, string> = {
  company: "الشركة", project: "مشروع", asset: "أصل", activity: "نشاط",
};

/**
 * لون تحذير الانتهاء. العتبات **نفس عتبات محرّك التنبيهات** (٣٠ و٧) — واجهة
 * تُلوّن بعتبة والتنبيه يُطلق بأخرى تُنتج تناقضًا يراه المستخدم.
 */
export function permitExpiryTone(daysLeft: number | null): "neutral" | "warn" | "bad" {
  if (daysLeft === null) return "neutral";
  if (daysLeft < 0 || daysLeft <= 7) return "bad";
  if (daysLeft <= 30) return "warn";
  return "neutral";
}

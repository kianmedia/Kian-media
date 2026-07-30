// ════════════════════════════════════════════════════════════════════════════
// lib/portal/liveOps.ts — browser client for the LIVE OPERATIONS DASHBOARD.
//
// Anon key only, like every other portal module. All authority lives in the
// database: liveops_can_view() / liveops_can_operate_session() / ... are
// re-checked inside every RPC, so hiding a button here is a courtesy, never a
// control.
//
// FEATURE DETECTION. The owner pushes code BEFORE running SQL. Every call maps
// "the function is not deployed" to a DISTINCT, honest state so the UI can say
// «الميزة بانتظار تفعيل قاعدة البيانات» instead of blanking, showing a
// misleading zero, or blaming the user's permissions. Reporting a permission
// error as a missing migration already cost this project a production
// debugging cycle (see the header of lib/portal/pgerror.ts).
//
// ⛔ THREE THINGS THIS FILE NEVER DOES
//   1. It never invents a technical value. A field the operator has not filled
//      is `null` and renders as «غير معروف» — never as 0, never as "OK".
//   2. It never presents a manual entry as live telemetry. `telemetryLabelAr`
//      exists precisely so a number can't reach a screen without its basis.
//   3. It never touches the client-safe surface. That surface is server-only
//      (app/api/public/live-status) and uses the service key on the server.
//      The only client-safe thing here is `liveOpsClientPreview`, which asks
//      the database for the EXACT payload a link holder would receive.
// ════════════════════════════════════════════════════════════════════════════

import { prpc, type Result } from "@/lib/portal/client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

// ─── Vocabulary (mirrors the CHECK constraints, one to one) ─────────────────

export type LiveOpsStatus =
  | "draft" | "readiness_review" | "ready" | "rehearsal" | "live" | "paused"
  | "degraded" | "interrupted" | "completed" | "post_event_review" | "archived";

/** Deliberately coarser than the internal status. Never a translation of it. */
export type LiveOpsClientStatus =
  | "scheduled" | "preparing" | "on_air" | "paused"
  | "on_air_with_issues" | "interrupted" | "completed";

export type LiveOpsTechStatus =
  | "unknown" | "ready" | "active" | "standby" | "warning"
  | "degraded" | "offline" | "failed" | "recovered";

export type LiveOpsHealth = "unknown" | "ok" | "warning" | "critical";

export type LiveOpsCategory =
  | "camera" | "operator" | "audio_source" | "switcher" | "encoder"
  | "stream_destination" | "recorder" | "graphics" | "playback" | "intercom"
  | "internet_primary" | "internet_backup" | "power" | "ups_generator"
  | "recording_media" | "backup_recording" | "monitoring";

export type LiveOpsRundownStatus =
  | "planned" | "ready" | "on_air" | "completed" | "delayed" | "skipped" | "changed";

/**
 * ★ The four honest sources. There is no fifth, and `telemetry_verified` is
 * structurally unreachable in V1 (the DB check `liveops_health_source_honest`
 * requires an adapter id, and no code path supplies one).
 */
export type LiveOpsHealthSource =
  | "manual_status" | "adapter_unavailable" | "telemetry_not_connected" | "telemetry_verified";

export type LiveOpsSeverity = "low" | "medium" | "high" | "critical";

// ─── Row shapes ─────────────────────────────────────────────────────────────

export interface LiveOpsSessionRow {
  id: string;
  session_code: string | null;
  title: string;
  internal_ref: string | null;
  status: LiveOpsStatus;
  client_status: LiveOpsClientStatus;
  event_date: string | null;
  starts_at: string | null;
  expected_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  venue: string | null;
  control_room: string | null;
  project_id: string | null;
  prodops_job_id: string | null;
  open_incidents: number;
  active_links: number;
  can_operate: boolean;
}

export interface LiveOpsInventoryItem {
  id: string;
  category: LiveOpsCategory;
  label: string;
  item_role: string | null;
  assigned_user_id: string | null;
  assigned_name: string | null;
  tech_status: LiveOpsTechStatus;
  health: LiveOpsHealth;
  last_checked_at: string | null;
  issue: string | null;
  client_visible: boolean;
  internal_notes: string | null;
  sort_order: number;
}

export interface LiveOpsHealthReading {
  id: string;
  at: string;
  connection: "primary" | "backup";
  upload_kbps: number | null;
  latency_ms: number | null;
  packet_loss_pct: number | null;
  current_bitrate_kbps: number | null;
  target_bitrate_kbps: number | null;
  encoder_state: LiveOpsTechStatus;
  destination_state: LiveOpsTechStatus;
  recording_state: LiveOpsTechStatus;
  failover_active: boolean;
  source: LiveOpsHealthSource;
  last_verified_at: string | null;
  note: string | null;
}

export interface LiveOpsRundownItem {
  id: string;
  item_no: number;
  scheduled_at: string | null;
  actual_at: string | null;
  title: string;
  duration_seconds: number | null;
  speaker: string | null;
  media: string | null;
  camera_plan: string | null;
  graphics_cue: string | null;
  audio_cue: string | null;
  notes: string | null;
  status: LiveOpsRundownStatus;
  delay_seconds: number;
  client_visible: boolean;
}

export interface LiveOpsCue {
  id: string; at: string; cue_type: string;
  rundown_item_id: string | null; note: string | null;
}

export interface LiveOpsIncident {
  id: string;
  incident_no: number | null;
  category: string;
  severity: LiveOpsSeverity;
  opened_at: string;
  detected_by_label: string | null;
  /** INTERNAL. Never rendered on any client surface. */
  description: string;
  affected_systems: string[];
  client_summary: string | null;
  client_summary_approved: boolean;
  /** INTERNAL. Reaches a client only when root_cause_released is true. */
  root_cause: string | null;
  root_cause_released: boolean;
  mitigation: string | null;
  resolved_at: string | null;
  post_event_action: string | null;
}

export interface LiveOpsBulletin {
  id: string; level: "info" | "notice" | "warning";
  title: string; body: string; is_published: boolean; published_at: string | null;
}

export interface LiveOpsClientPerson {
  id: string; display_name: string; role_label: string; approved_at: string;
}

export interface LiveOpsReport {
  status: "draft" | "pending_approval" | "approved";
  uptime_pct: number | null;
  /** ⚠️ Never render uptime_pct without this next to it. */
  uptime_basis: "manual_estimate" | "telemetry_verified";
  interruptions_count: number;
  interruption_minutes: number;
  incident_summary_internal: string | null;
  incident_summary_client: string | null;
  recording_confirmed: boolean;
  backup_confirmed: boolean;
  destinations_client: string | null;
  delivered_files_client: string | null;
  delivered_files_internal: string | null;
  recommendations: string | null;
  client_summary: string | null;
  internal_summary: string | null;
  approved_at: string | null;
}

export interface LiveOpsPermissions {
  can_operate: boolean;
  can_manage: boolean;
  can_issue_link: boolean;
  can_reveal_root_cause: boolean;
  can_approve_report: boolean;
}

export interface LiveOpsSessionDetail {
  session: Record<string, unknown> & {
    id: string; title: string; status: LiveOpsStatus; client_status: LiveOpsClientStatus;
  };
  inventory: LiveOpsInventoryItem[];
  health: LiveOpsHealthReading[];
  rundown: LiveOpsRundownItem[];
  cues: LiveOpsCue[];
  incidents: LiveOpsIncident[];
  bulletins: LiveOpsBulletin[];
  client_people: LiveOpsClientPerson[];
  report: LiveOpsReport | null;
  permissions: LiveOpsPermissions;
  telemetry: { connected: boolean; adapter: string | null; state: string; note_ar: string };
}

export interface LiveOpsBoard {
  status: LiveOpsStatus;
  client_status: LiveOpsClientStatus;
  elapsed_seconds: number | null;
  remaining_seconds: number | null;
  schedule_delay_seconds: number;
  current: { id: string; item_no: number; title: string; scheduled_at: string | null; actual_at: string | null } | null;
  next: { id: string; item_no: number; title: string; scheduled_at: string | null } | null;
  open_incidents: number;
  inventory_alarms: number;
  telemetry_connected: boolean;
}

export interface LiveOpsLink {
  id: string;
  label: string | null;
  recipient_org: string | null;
  status: "draft" | "active" | "revoked" | "expired" | "exhausted";
  starts_at: string;
  expires_at: string;
  max_opens: number | null;
  opens_used: number;
  last_opened_at: string | null;
  /** Last 6 characters only — for visual matching. The hash never leaves the DB. */
  token_hint: string | null;
  token_issued_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

/** The exact payload a link holder receives. Built by the SAME DB function. */
export interface LiveOpsClientPayload {
  ok: true;
  event: {
    title: string; status: LiveOpsClientStatus;
    starts_at: string | null; expected_end_at: string | null;
    elapsed_seconds: number | null; remaining_seconds: number | null;
    schedule_delay_seconds: number; notes: string | null;
  };
  segments: {
    current: { title: string; scheduled_at: string | null; status: string } | null;
    next: { title: string; scheduled_at: string | null; status: string } | null;
  };
  cameras: { active: number; planned: number };
  technical: {
    stream: string; recording: string; connection: string;
    basis: LiveOpsHealthSource; telemetry_connected: false; last_verified_at: string | null;
  };
  people: { name: string; role: string }[];
  bulletins: { level: string; title: string; body: string; at: string }[];
  incidents: { at: string; summary: string; resolved: boolean; root_cause: string | null }[];
  report: {
    approved_at: string; summary: string | null; incident_summary: string | null;
    planned_start_at: string | null; planned_end_at: string | null;
    actual_start_at: string | null; actual_end_at: string | null;
    uptime_pct: number | null; uptime_basis: "manual_estimate" | "telemetry_verified";
    interruptions_count: number; interruption_minutes: number;
    recording_confirmed: boolean; backup_confirmed: boolean;
    destinations: string | null; delivered_files: string | null;
  } | null;
  note_ar: string;
  preview?: boolean;
  opens_left?: number | null;
  expires_at?: string;
}

// ─── Honest state envelope ──────────────────────────────────────────────────

export type LiveOpsState<T> =
  | { state: "ok"; data: T }
  /** The RPC is absent (PGRST202/42883). A migration really is pending. */
  | { state: "needs_migration"; message: string }
  /** 42501/403. The schema is fine; the caller is not allowed. */
  | { state: "denied"; message: string }
  /** Transport never reached Postgres. Not a permission story, not a migration story. */
  | { state: "offline"; message: string }
  | { state: "error"; message: string };

export const LIVEOPS_PENDING_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/live_operations_dashboard_RUNME.sql. لا يوجد خطأ في صلاحياتك.";

function toState<T>(r: Result<unknown>, pick: (d: Record<string, unknown>) => T): LiveOpsState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    // ★ The four causes stay four causes. Collapsing any pair of them is the
    //   exact mistake documented at the top of lib/portal/pgerror.ts.
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: LIVEOPS_PENDING_AR };
    if (d.kind === "permission_denied") {
      return { state: "denied", message: "لا تملك صلاحية هذا الإجراء في العمليات المباشرة." };
    }
    if (d.kind === "network") {
      return { state: "offline", message: "تعذّر الاتصال بالخادم. لم يصل الطلب إلى قاعدة البيانات." };
    }
    return { state: "error", message: liveOpsErrorAr(r.error) || pgMessageAr(r.error, r.status) };
  }
  const data = (r.data ?? {}) as Record<string, unknown>;
  return { state: "ok", data: pick(data) };
}

/** Server-raised messages → Arabic, each naming its ACTUAL cause. */
export function liveOpsErrorAr(raw: string | null | undefined): string {
  const s = String(raw ?? "");
  if (!s) return "";
  if (s.includes("liveops_client_text")) {
    return "النصّ المخصَّص للعميل يحتوي على تفاصيل ممنوعة (عنوان شبكة أو مفتاح بثّ أو رقم تسلسليّ أو مبلغ أو معرّف اتصال). أعد صياغته.";
  }
  if (s.includes("not authorized")) return "لا تملك صلاحية هذا الإجراء في العمليات المباشرة.";
  if (s.includes("انتقال غير مسموح")) return s.replace(/^conflict:\s*/, "");
  if (s.startsWith("conflict:")) return s.replace(/^conflict:\s*/, "");
  if (s.startsWith("validation:")) return s.replace(/^validation:\s*/, "");
  if (s.includes("not found")) return "العنصر غير موجود (أو حُذف).";
  return "";
}

// ─── Labels ─────────────────────────────────────────────────────────────────

const STATUS_AR: Record<LiveOpsStatus, string> = {
  draft: "مسوّدة",
  readiness_review: "مراجعة الجاهزية",
  ready: "جاهز",
  rehearsal: "بروفة",
  live: "على الهواء",
  paused: "موقوف مؤقّتًا",
  degraded: "يعمل بأداء منخفض",
  interrupted: "منقطع",
  completed: "منتهٍ",
  post_event_review: "مراجعة ما بعد الفعالية",
  archived: "مؤرشف",
};
export const liveOpsStatusAr = (s: string): string => STATUS_AR[s as LiveOpsStatus] ?? s;

const CLIENT_STATUS_AR: Record<LiveOpsClientStatus, string> = {
  scheduled: "مُجدوَل",
  preparing: "قيد التحضير",
  on_air: "على الهواء",
  paused: "استراحة",
  on_air_with_issues: "على الهواء مع ملاحظات فنّية",
  interrupted: "متوقّف مؤقّتًا",
  completed: "انتهى",
};
export const liveOpsClientStatusAr = (s: string): string =>
  CLIENT_STATUS_AR[s as LiveOpsClientStatus] ?? s;

const TECH_AR: Record<LiveOpsTechStatus, string> = {
  unknown: "غير معروف", ready: "جاهز", active: "يعمل", standby: "احتياطيّ",
  warning: "تحذير", degraded: "أداء منخفض", offline: "غير متّصل",
  failed: "معطّل", recovered: "تعافى",
};
export const liveOpsTechAr = (s: string): string => TECH_AR[s as LiveOpsTechStatus] ?? s;

const CATEGORY_AR: Record<LiveOpsCategory, string> = {
  camera: "كاميرا", operator: "مشغّل", audio_source: "مصدر صوت", switcher: "مُبدِّل",
  encoder: "مُرمِّز", stream_destination: "وجهة بثّ", recorder: "مُسجِّل",
  graphics: "غرافيك", playback: "تشغيل مادّة", intercom: "اتصال داخليّ",
  internet_primary: "إنترنت رئيسيّ", internet_backup: "إنترنت احتياطيّ",
  power: "كهرباء", ups_generator: "مولّد/UPS", recording_media: "وسائط تسجيل",
  backup_recording: "تسجيل احتياطيّ", monitoring: "مراقبة",
};
export const liveOpsCategoryAr = (c: string): string => CATEGORY_AR[c as LiveOpsCategory] ?? c;

const RUNDOWN_AR: Record<LiveOpsRundownStatus, string> = {
  planned: "مخطَّط", ready: "جاهز", on_air: "على الهواء", completed: "انتهى",
  delayed: "متأخّر", skipped: "أُلغي", changed: "تغيّر",
};
export const liveOpsRundownAr = (s: string): string => RUNDOWN_AR[s as LiveOpsRundownStatus] ?? s;

/**
 * ★★ THE HONESTY LABEL ★★
 * A technical value must never reach a screen without this string beside it.
 * There is no branch that returns something like "live" or "verified" while
 * the module has no adapter — because the database cannot produce that source.
 */
export function telemetryLabelAr(source: LiveOpsHealthSource | null | undefined): string {
  switch (source) {
    case "manual_status":            return "إدخال بشريّ — ليست قراءة من الجهاز";
    case "adapter_unavailable":      return "مُحوِّل الأجهزة غير متاح";
    case "telemetry_not_connected":  return "القياسات غير موصولة";
    case "telemetry_verified":       return "قراءة موثَّقة من مُحوِّل";
    default:                         return "القياسات غير موصولة";
  }
}

/** Uptime may never be shown as a bare number. */
export function uptimeLabelAr(pct: number | null | undefined, basis: string | null | undefined): string {
  if (pct === null || pct === undefined) return "غير محدَّدة";
  const b = basis === "telemetry_verified" ? "موثَّقة بالقياس" : "تقدير بشريّ";
  return `${pct}٪ (${b})`;
}

/** Never a misleading zero: an unfilled technical field says so. */
export function numOrUnknownAr(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined) return "غير معروف";
  return unit ? `${v} ${unit}` : String(v);
}

export function hhmmss(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return "—";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}`;
}

/** Mirrors liveops_status_allowed() so the UI hides impossible buttons. The DB
 *  is still the authority — this only avoids offering a move that will fail. */
const TRANSITIONS: Record<LiveOpsStatus, LiveOpsStatus[]> = {
  draft: ["readiness_review", "archived"],
  readiness_review: ["ready", "draft", "archived"],
  ready: ["rehearsal", "live", "readiness_review", "archived"],
  rehearsal: ["ready", "live", "archived"],
  live: ["paused", "degraded", "interrupted", "completed"],
  paused: ["live", "degraded", "interrupted", "completed"],
  degraded: ["live", "paused", "interrupted", "completed"],
  interrupted: ["live", "paused", "degraded", "completed"],
  completed: ["post_event_review", "archived"],
  post_event_review: ["completed", "archived"],
  archived: [],
};
export const liveOpsNextStates = (s: LiveOpsStatus): LiveOpsStatus[] => TRANSITIONS[s] ?? [];

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function liveOpsList(filters: { status?: string | null; q?: string | null } = {}) {
  const r = await prpc<Record<string, unknown>>("liveops_session_list", { p_filters: filters });
  return toState(r, (d) => ({
    rows: (d.rows ?? []) as LiveOpsSessionRow[],
    can_manage: d.can_manage === true,
  }));
}

export async function liveOpsDetail(sessionId: string) {
  const r = await prpc<Record<string, unknown>>("liveops_session_detail", { p_session: sessionId });
  return toState(r, (d) => d as unknown as LiveOpsSessionDetail);
}

export async function liveOpsBoard(sessionId: string) {
  const r = await prpc<Record<string, unknown>>("liveops_live_board", { p_session: sessionId });
  return toState(r, (d) => d as unknown as LiveOpsBoard);
}

/** The staff-side preview of the client surface — same DB builder, no token. */
export async function liveOpsClientPreview(sessionId: string) {
  const r = await prpc<Record<string, unknown>>("liveops_client_preview", { p_session: sessionId });
  return toState(r, (d) => d as unknown as LiveOpsClientPayload);
}

export async function liveOpsLinks(sessionId: string) {
  const r = await prpc<Record<string, unknown>>("liveops_link_list", { p_session: sessionId });
  return toState(r, (d) => (d.rows ?? []) as LiveOpsLink[]);
}

export async function liveOpsLinkAudit(linkId: string) {
  const r = await prpc<Record<string, unknown>>("liveops_link_audit", { p_link: linkId });
  return toState(r, (d) => (d.rows ?? []) as {
    at: string; allowed: boolean; denied_reason: string | null; fingerprint: string;
  }[]);
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function liveOpsSessionUpsert(input: Record<string, unknown>) {
  const r = await prpc<Record<string, unknown>>("liveops_session_upsert", { p_input: input });
  return toState(r, (d) => ({ id: String(d.id ?? ""), created: d.created === true }));
}

/**
 * ⛔ A client never reaches this function. The gate is in the database
 * (liveops_can_operate_session) AND in a BEFORE UPDATE trigger that recomputes
 * the answer from the database instead of trusting the caller.
 */
export async function liveOpsSetStatus(
  sessionId: string, status: LiveOpsStatus,
  clientStatus?: LiveOpsClientStatus | null, reason?: string | null,
) {
  const r = await prpc<Record<string, unknown>>("liveops_session_set_status", {
    p_session: sessionId, p_status: status,
    p_client_status: clientStatus ?? null, p_reason: reason ?? null,
  });
  return toState(r, (d) => ({
    status: String(d.status ?? "") as LiveOpsStatus,
    client_status: String(d.client_status ?? "") as LiveOpsClientStatus,
  }));
}

export async function liveOpsInventoryUpsert(input: Record<string, unknown>) {
  const r = await prpc<Record<string, unknown>>("liveops_inventory_upsert", { p_input: input });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsInventorySetState(
  itemId: string, techStatus: LiveOpsTechStatus, health?: LiveOpsHealth | null, issue?: string | null,
) {
  const r = await prpc<Record<string, unknown>>("liveops_inventory_set_state", {
    p_item: itemId, p_tech_status: techStatus, p_health: health ?? null, p_issue: issue ?? null,
  });
  // update_kind is always "manual_status": the UI must be able to say so.
  return toState(r, (d) => ({ id: String(d.id ?? ""), update_kind: String(d.update_kind ?? "manual_status") }));
}

export async function liveOpsInventoryDelete(itemId: string, reason: string) {
  const r = await prpc<Record<string, unknown>>("liveops_inventory_delete", {
    p_item: itemId, p_reason: reason,
  });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

/**
 * ⛔ There is no `source: "telemetry_verified"` overload, and the DB rejects it
 * from this path anyway. Everything recorded here is a human statement.
 */
export async function liveOpsHealthRecord(input: Record<string, unknown> & { live_session_id: string }) {
  const source = input.source;
  if (source === "telemetry_verified") {
    return {
      state: "error" as const,
      message: "لا يوجد مُحوِّل أجهزة في هذه النسخة، فلا يمكن تسجيل قراءة «موثَّقة». اختر «إدخال بشريّ».",
    };
  }
  const r = await prpc<Record<string, unknown>>("liveops_health_record", { p_input: input });
  return toState(r, (d) => ({
    id: String(d.id ?? ""),
    source: String(d.source ?? "manual_status") as LiveOpsHealthSource,
    telemetry_connected: d.telemetry_connected === true,
  }));
}

export async function liveOpsRundownUpsert(input: Record<string, unknown>) {
  const r = await prpc<Record<string, unknown>>("liveops_rundown_upsert", { p_input: input });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsRundownSetStatus(
  itemId: string, status: LiveOpsRundownStatus, actualAt?: string | null,
) {
  const r = await prpc<Record<string, unknown>>("liveops_rundown_set_status", {
    p_item: itemId, p_status: status, p_actual_at: actualAt ?? null,
  });
  return toState(r, (d) => ({
    id: String(d.id ?? ""), delay_seconds: Number(d.delay_seconds ?? 0),
  }));
}

export async function liveOpsRundownDelete(itemId: string, reason: string) {
  const r = await prpc<Record<string, unknown>>("liveops_rundown_delete", {
    p_item: itemId, p_reason: reason,
  });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsCueLog(
  sessionId: string, cueType: string, itemId?: string | null, note?: string | null,
) {
  const r = await prpc<Record<string, unknown>>("liveops_cue_log", {
    p_session: sessionId, p_cue_type: cueType, p_item: itemId ?? null, p_note: note ?? null,
  });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsIncidentOpen(input: Record<string, unknown> & { live_session_id: string }) {
  const r = await prpc<Record<string, unknown>>("liveops_incident_open", { p_input: input });
  return toState(r, (d) => ({
    id: String(d.id ?? ""), incident_no: Number(d.incident_no ?? 0),
    client_visible: d.client_visible === true,
  }));
}

export async function liveOpsIncidentUpdate(input: Record<string, unknown> & { id: string }) {
  const r = await prpc<Record<string, unknown>>("liveops_incident_update", { p_input: input });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsIncidentResolve(
  incidentId: string, mitigation?: string | null, postEventAction?: string | null,
) {
  const r = await prpc<Record<string, unknown>>("liveops_incident_resolve", {
    p_incident: incidentId, p_mitigation: mitigation ?? null, p_post_event_action: postEventAction ?? null,
  });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

/** Manager-only, reason-logged, and secret-scanned before it can ever be seen. */
export async function liveOpsReleaseRootCause(incidentId: string, release: boolean, reason: string) {
  const r = await prpc<Record<string, unknown>>("liveops_incident_release_root_cause", {
    p_incident: incidentId, p_release: release, p_reason: reason,
  });
  return toState(r, (d) => ({ released: d.released === true }));
}

export async function liveOpsBulletinUpsert(input: Record<string, unknown>) {
  const r = await prpc<Record<string, unknown>>("liveops_bulletin_upsert", { p_input: input });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsPersonUpsert(input: Record<string, unknown> & { live_session_id: string }) {
  const r = await prpc<Record<string, unknown>>("liveops_client_person_upsert", { p_input: input });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsPersonDelete(id: string) {
  const r = await prpc<Record<string, unknown>>("liveops_client_person_delete", { p_id: id });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

export async function liveOpsReportUpsert(input: Record<string, unknown> & { live_session_id: string }) {
  const r = await prpc<Record<string, unknown>>("liveops_report_upsert", { p_input: input });
  return toState(r, (d) => ({ uptime_basis: String(d.uptime_basis ?? "manual_estimate") }));
}

export async function liveOpsReportApprove(sessionId: string, note?: string | null) {
  const r = await prpc<Record<string, unknown>>("liveops_report_approve", {
    p_session: sessionId, p_note: note ?? null,
  });
  return toState(r, (d) => ({ status: String(d.status ?? "") }));
}

export async function liveOpsLinkCreate(input: Record<string, unknown> & { live_session_id: string }) {
  const r = await prpc<Record<string, unknown>>("liveops_link_create", { p_input: input });
  return toState(r, (d) => ({ id: String(d.id ?? "") }));
}

/**
 * ★ The token comes back ONCE and is never stored. The caller must show it to
 * the operator immediately and must not persist it anywhere.
 * ⛔ Nothing in this system sends the link. It is handed over by a human.
 */
export async function liveOpsLinkIssue(linkId: string) {
  const r = await prpc<Record<string, unknown>>("liveops_link_issue", { p_link: linkId });
  return toState(r, (d) => ({
    token: String(d.token ?? ""),
    token_hint: String(d.token_hint ?? ""),
    expires_at: (d.expires_at ?? null) as string | null,
    delivery_enabled: d.delivery_enabled === true,
  }));
}

export async function liveOpsLinkRevoke(linkId: string, reason: string) {
  const r = await prpc<Record<string, unknown>>("liveops_link_revoke", {
    p_link: linkId, p_reason: reason,
  });
  return toState(r, (d) => ({ status: String(d.status ?? "revoked") }));
}

/** Build the shareable URL. The token lives in the FRAGMENT so it is never sent
 *  to a server, never logged, and never forwarded in a Referer header. */
export function liveOpsShareUrl(token: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/live-status#${token}`;
}

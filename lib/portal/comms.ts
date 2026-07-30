// ════════════════════════════════════════════════════════════════════════════
// lib/portal/comms.ts — browser client for the Communications Hub.
//
// Anon key only, exactly like every other portal module. All authority lives in
// the database: comms_can_view() / comms_can_admin() are re-checked inside each
// RPC, so hiding a button here is a courtesy, never a control.
//
// FEATURE DETECTION. The owner pushes code BEFORE running SQL. Every call maps
// "the function is not deployed" to a distinct, honest state so the UI can say
// «الميزة بانتظار تفعيل قاعدة البيانات» instead of blanking or claiming a
// permission problem. That distinction is not cosmetic — reporting a permission
// error as a missing migration already cost this project a debugging cycle
// (see the header of lib/portal/pgerror.ts).
// ════════════════════════════════════════════════════════════════════════════

import { prpc, type Result } from "@/lib/portal/client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CommsStatus =
  | "queued" | "processing" | "sent" | "delivered"
  | "failed" | "retrying" | "dead_letter" | "cancelled";

export type CommsChannel = "portal" | "email" | "whatsapp";

export interface CommsOutboxRow {
  id: string;
  created_at: string;
  event_key: string;
  category: string;
  channel: CommsChannel;
  status: CommsStatus;
  dry_run: boolean;
  audience_scope: "internal" | "client";
  recipient_is_external: boolean;
  locale: "ar" | "en";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  sent_at: string | null;
  subject: string;
  last_error: string | null;
  error_class: string | null;
  provider: string | null;
  provider_message_id: string | null;
  correlation_id: string;
  template_version: number | null;
  recipient_address: string | null;   // masked for the view-only tier
  recipient_role: string | null;
  cancel_reason: string | null;
}

export interface CommsDashboard { total: number; rows: CommsOutboxRow[]; is_admin: boolean }

export interface CommsHealth {
  counts: {
    queued: number; processing: number; retrying: number;
    /** Simulated. Never summed with anything live. */
    sent_dry_run: number;
    /** Provider ACCEPTED it (status 'sent'). Real evidence, disjoint from
     *  `delivered` by status, so the two may be added — that sum is
     *  `live_total`, and it is the only number that means "really sent". */
    sent_live: number;
    /** Provider produced DELIVERY evidence. Acceptance is not delivery. */
    delivered: number;
    /** sent_live + delivered. The ONLY honest "really sent" figure. */
    live_total: number;
    /** Read-only copies of terminal email_deliveries rows. NEVER live: the
     *  legacy queue's own 'sent' is not evidence of delivery. */
    mirrored_legacy: number;
    /** Rows brought in from elsewhere. Never live. */
    imported: number;
    /** The provider was not reachable / not deployed. Never live. */
    provider_unavailable: number;
    /** The Apps Script portal_notify branch is absent. Never live. */
    relay_handler_missing: number;
    /** Claims a terminal success while carrying no provider evidence at all.
     *  Must always read 0; any other number is a bug in a settle path, and it
     *  is surfaced rather than folded into a green number. */
    claimed_sent_without_evidence: number;
    failed: number; dead_letter: number; cancelled: number;
    blocked_external_total: number; total: number;
  };
  channels: Record<string, { enabled: boolean; dry_run: boolean }>;
  oldest_runnable_at: string | null;
  legacy_email_deliveries: { pending: number; sent: number; failed: number; total: number } | null;
  note_ar: string;
  note_en: string;
}

export interface CommsPrefCategory {
  category: string; portal: boolean; email: boolean; whatsapp: boolean;
  locale: "ar" | "en"; has_mandatory: boolean;
}

export interface CommsPreview {
  event: string; locale: string; audience_scope: string; version: number;
  subject: string; body: string; would_violate_r2: boolean;
}

/** Three honest outcomes, never collapsed into one another. */
export type CommsState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "error"; message: string; denied: boolean };

// ─── Arabic labels (RTL UI) ─────────────────────────────────────────────────

export const COMMS_STATUS_AR: Record<CommsStatus, string> = {
  queued: "في الطابور",
  processing: "قيد المعالجة",
  sent: "أُرسل",
  delivered: "وصل",
  failed: "فشل",
  retrying: "إعادة محاولة",
  dead_letter: "فشل نهائي",
  cancelled: "أُلغي",
};

export const COMMS_CHANNEL_AR: Record<CommsChannel, string> = {
  portal: "البوابة",
  email: "بريد إلكتروني",
  whatsapp: "واتساب",
};

export const COMMS_CATEGORY_AR: Record<string, string> = {
  projects: "المشاريع",
  delivery: "التسليم",
  tasks: "المهام",
  governance: "الحوكمة",
  custody: "العهد",
  rental: "التأجير",
  finance: "المالية",
  hr: "الموارد البشرية",
  system: "النظام",
  legacy: "قديم (مرآة)",
};

export const commsCategoryAr = (c: string): string => COMMS_CATEGORY_AR[c] ?? c;

/**
 * A row that says "sent" while dry_run is on did NOT reach anybody. The label
 * has to say so — this is the exact class of forged success the owner has been
 * burned by twice.
 */
export function commsStatusLabel(row: Pick<CommsOutboxRow, "status" | "dry_run">): string {
  if (row.dry_run && (row.status === "sent" || row.status === "delivered")) {
    return "محاكاة — لم يُرسل فعليًا";
  }
  return COMMS_STATUS_AR[row.status] ?? row.status;
}

// ─── Call wrapper ───────────────────────────────────────────────────────────

function toState<T>(r: Result<unknown>, pick: (d: Record<string, unknown>) => T): CommsState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) {
      return { state: "needs_migration", message: "الميزة بانتظار تفعيل قاعدة البيانات." };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status), denied: d.kind === "permission_denied" };
  }
  const data = (r.data ?? {}) as Record<string, unknown>;
  if (data.ok === false) {
    const err = String(data.error ?? "unknown");
    if (err === "not_authorized") {
      return { state: "error", message: "لا تملك صلاحية الوصول إلى مركز الاتصالات.", denied: true };
    }
    return { state: "error", message: commsErrorAr(err), denied: false };
  }
  return { state: "ok", data: pick(data) };
}

/** Server error codes → Arabic. Each one names its ACTUAL cause. */
export function commsErrorAr(code: string): string {
  switch (code) {
    case "not_authorized":            return "لا تملك صلاحية تنفيذ هذا الإجراء.";
    case "not_authenticated":         return "انتهت الجلسة. سجّل الدخول من جديد.";
    case "not_found":                 return "الرسالة غير موجودة.";
    case "not_retryable":             return "لا يمكن إعادة المحاولة في هذه الحالة.";
    case "legacy_mirror_not_retryable":
      return "هذه نسخة عرض من الطابور القديم — أعد المحاولة من مراقب البريد القديم، لا من هنا، تفاديًا لإرسال مزدوج.";
    case "too_late":                  return "فات وقت الإلغاء: الرسالة قيد الإرسال أو أُرسلت.";
    case "rate_limited":              return "تجاوزت حدّ المعدّل لهذا الحدث. حاول لاحقًا.";
    case "event_not_in_catalog":      return "هذا الحدث غير مُعرَّف في كتالوج الأحداث.";
    case "unknown_channel":           return "قناة غير معروفة.";
    case "unknown_category":          return "تصنيف غير معروف.";
    case "template_not_found":        return "لا يوجد قالب مُفعَّل بهذه اللغة/النطاق.";
    case "subject_and_body_required": return "العنوان والنص مطلوبان.";
    default:                          return "تعذّر تنفيذ الطلب: " + code;
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export interface CommsDashboardFilter {
  status?: CommsStatus | null;
  channel?: CommsChannel | null;
  event?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export async function commsDashboard(f: CommsDashboardFilter = {}): Promise<CommsState<CommsDashboard>> {
  const r = await prpc<Record<string, unknown>>("comms_dashboard", {
    p_status: f.status ?? null,
    p_channel: f.channel ?? null,
    p_event: f.event ?? null,
    p_search: f.search && f.search.trim() ? f.search.trim() : null,
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_limit: f.limit ?? 100,
    p_offset: f.offset ?? 0,
  });
  return toState(r, (d) => ({
    total: Number(d.total ?? 0),
    rows: Array.isArray(d.rows) ? (d.rows as CommsOutboxRow[]) : [],
    is_admin: d.is_admin === true,
  }));
}

export async function commsHealth(): Promise<CommsState<CommsHealth>> {
  const r = await prpc<Record<string, unknown>>("comms_health", {});
  return toState(r, (d) => d as unknown as CommsHealth);
}

export async function commsPreview(
  event: string, locale: "ar" | "en", scope: "internal" | "client", vars: Record<string, string>,
): Promise<CommsState<CommsPreview>> {
  const r = await prpc<Record<string, unknown>>("comms_preview", {
    p_event: event, p_locale: locale, p_scope: scope, p_vars: vars,
  });
  return toState(r, (d) => d as unknown as CommsPreview);
}

export async function commsCatalog(): Promise<CommsState<{ event_key: string; category: string; audience: string; label_ar: string }[]>> {
  // Plain table read (RLS: staff only). PostgREST answers 404/PGRST205 when the
  // table is absent, which pgClassify maps to migration-pending.
  const { pget } = await import("@/lib/portal/client");
  const r = await pget<{ event_key: string; category: string; audience: string; label_ar: string }[]>(
    "comms_event_catalog?select=event_key,category,audience,label_ar&active=is.true&order=category,event_key");
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: "الميزة بانتظار تفعيل قاعدة البيانات." };
    return { state: "error", message: pgMessageAr(r.error, r.status), denied: d.kind === "permission_denied" };
  }
  return { state: "ok", data: r.data };
}

// ─── Writes (each re-authorized in the database) ────────────────────────────

export async function commsRetry(id: string): Promise<CommsState<{ id: string }>> {
  const r = await prpc<Record<string, unknown>>("comms_retry", { p_id: id });
  return toState(r, (d) => ({ id: String(d.id ?? id) }));
}

export async function commsCancel(id: string, reason: string): Promise<CommsState<{ id: string }>> {
  const r = await prpc<Record<string, unknown>>("comms_cancel", { p_id: id, p_reason: reason });
  return toState(r, (d) => ({ id: String(d.id ?? id) }));
}

export async function commsChannelSet(
  channel: CommsChannel, enabled: boolean, dryRun: boolean | null = null, note: string | null = null,
): Promise<CommsState<{ channel: string }>> {
  const r = await prpc<Record<string, unknown>>("comms_channel_set", {
    p_channel: channel, p_enabled: enabled, p_dry_run: dryRun, p_note: note,
  });
  return toState(r, (d) => ({ channel: String(d.channel ?? channel) }));
}

export async function commsTemplatePublish(
  event: string, locale: "ar" | "en", scope: "internal" | "client", subject: string, body: string,
): Promise<CommsState<{ id: string; version: number }>> {
  const r = await prpc<Record<string, unknown>>("comms_template_publish", {
    p_event: event, p_locale: locale, p_scope: scope, p_subject: subject, p_body: body,
  });
  return toState(r, (d) => ({ id: String(d.id ?? ""), version: Number(d.version ?? 0) }));
}

export async function commsImportLegacy(limit = 200): Promise<CommsState<{ imported: number; blocked_by_safety_rules: number; left_with_legacy_queue: number }>> {
  const r = await prpc<Record<string, unknown>>("comms_adapter_import_legacy", { p_limit: limit });
  return toState(r, (d) => ({
    imported: Number(d.imported ?? 0),
    blocked_by_safety_rules: Number(d.blocked_by_safety_rules ?? 0),
    left_with_legacy_queue: Number(d.left_with_legacy_queue ?? 0),
  }));
}

// ─── Preference centre ──────────────────────────────────────────────────────

export async function commsPrefsGet(): Promise<CommsState<CommsPrefCategory[]>> {
  const r = await prpc<Record<string, unknown>>("comms_prefs_get", {});
  return toState(r, (d) => (Array.isArray(d.categories) ? (d.categories as CommsPrefCategory[]) : []));
}

export async function commsPrefsSet(
  category: string, portal: boolean, email: boolean, whatsapp: boolean, locale: "ar" | "en",
): Promise<CommsState<{ category: string }>> {
  const r = await prpc<Record<string, unknown>>("comms_prefs_set", {
    p_category: category, p_portal: portal, p_email: email, p_whatsapp: whatsapp, p_locale: locale,
  });
  return toState(r, (d) => ({ category: String(d.category ?? category) }));
}

// ─── Export ─────────────────────────────────────────────────────────────────

/** CSV of what is on screen. Recipient stays masked for the view-only tier
 *  because the server masked it — this never un-masks anything. */
export function commsRowsToCsv(rows: CommsOutboxRow[]): string {
  const head = [
    "created_at", "event_key", "category", "channel", "status", "dry_run",
    "audience_scope", "recipient_external", "recipient", "role", "locale",
    "attempts", "max_attempts", "subject", "provider", "provider_message_id",
    "error_class", "last_error", "correlation_id",
  ];
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      r.created_at, r.event_key, r.category, r.channel,
      // The CSV must not launder a simulation into a delivery either.
      r.dry_run && (r.status === "sent" || r.status === "delivered") ? r.status + " (dry_run)" : r.status,
      r.dry_run, r.audience_scope, r.recipient_is_external, r.recipient_address, r.recipient_role,
      r.locale, r.attempts, r.max_attempts, r.subject, r.provider, r.provider_message_id,
      r.error_class, r.last_error, r.correlation_id,
    ].map(esc).join(","));
  }
  // BOM so Excel opens Arabic correctly instead of showing mojibake.
  return "﻿" + lines.join("\r\n");
}

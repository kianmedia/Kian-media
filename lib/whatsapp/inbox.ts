// ════════════════════════════════════════════════════════════════════════
// Kian — WhatsApp inbox data layer for the admin UI.
//
// Reads go through the anon-key REST client (RLS decides which rows are
// visible). Writes go through the SECURITY DEFINER RPCs from
// docs/whatsapp_inbox_RUNME.sql (wa_set_conversation / wa_assign_conversation /
// wa_add_note) — there is NO table write-grant and NO service-role key here.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, currentUserId, type Result } from "@/lib/portal/client";
import { getValidSession } from "@/lib/portalAuth";
import type {
  WaConversation, WaContact, WaMessage, WaAssignment, WaInternalNote,
  WaStatus, WaSalesStage, WaDepartment, WaQuoteRequest,
} from "@/lib/whatsapp/types";
import type { WaCategory, WaPriority } from "@/lib/whatsapp/classify";
import type { Profile } from "@/lib/portal/types";

export interface WaListFilters {
  status?: WaStatus | "";
  category?: WaCategory | "";
  department?: WaDepartment | "";
  salesStage?: WaSalesStage | "";
  priority?: WaPriority | "";
  assignedTo?: string | "";      // user id, or "__me__" handled by the caller
  unreadOnly?: boolean;
  search?: string;
}

/** Conversations visible to the viewer (RLS-filtered), newest activity first. */
export function listConversations(filters: WaListFilters = {}, limit = 200): Promise<Result<WaConversation[]>> {
  const parts = ["select=*", "order=last_message_at.desc.nullslast", `limit=${limit}`];
  if (filters.status) parts.push(`status=eq.${enc(filters.status)}`);
  if (filters.category) parts.push(`category=eq.${enc(filters.category)}`);
  // Department filter matches the primary OR any routed department, so a sales
  // conversation that later got a finance message shows under the Finance filter.
  if (filters.department) parts.push(`or=(assigned_department.eq.${enc(filters.department)},routed_departments.cs.{${enc(filters.department)}})`);
  if (filters.salesStage) parts.push(`sales_stage=eq.${enc(filters.salesStage)}`);
  if (filters.priority) parts.push(`priority=eq.${enc(filters.priority)}`);
  if (filters.assignedTo) parts.push(`assigned_to=eq.${enc(filters.assignedTo)}`);
  if (filters.unreadOnly) parts.push(`unread_count=gt.0`);
  return pget<WaConversation[]>(`whatsapp_conversations?${parts.join("&")}`);
}

/** One conversation by id (RLS-filtered) — used to resolve a deep-linked
 *  ?conversation=<id> that isn't in the current filtered list. */
export async function getConversation(id: string): Promise<Result<WaConversation | null>> {
  const r = await pget<WaConversation[]>(`whatsapp_conversations?id=eq.${enc(id)}&select=*&limit=1`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}

/** Resolve contacts for a set of conversation.contact_id values. */
export async function listContactsByIds(ids: string[]): Promise<Result<WaContact[]>> {
  if (ids.length === 0) return { ok: true, data: [] };
  const inList = Array.from(new Set(ids)).map((id) => enc(id)).join(",");
  return pget<WaContact[]>(`whatsapp_contacts?id=in.(${inList})&select=*`);
}

export function listMessages(conversationId: string, limit = 500): Promise<Result<WaMessage[]>> {
  return pget<WaMessage[]>(
    `whatsapp_messages?conversation_id=eq.${enc(conversationId)}&select=*&order=created_at.asc&limit=${limit}`,
  );
}

export function listNotes(conversationId: string): Promise<Result<WaInternalNote[]>> {
  return pget<WaInternalNote[]>(
    `whatsapp_internal_notes?conversation_id=eq.${enc(conversationId)}&select=*&order=created_at.asc`,
  );
}

export function listAssignments(conversationId: string): Promise<Result<WaAssignment[]>> {
  return pget<WaAssignment[]>(
    `whatsapp_assignments?conversation_id=eq.${enc(conversationId)}&select=*&order=created_at.desc`,
  );
}

/** Active staff (assignable). RLS: profiles are admin/owner-readable. */
export function listAssignableStaff(): Promise<Result<Pick<Profile, "id" | "full_name" | "email" | "staff_role" | "account_type">[]>> {
  return pget<Pick<Profile, "id" | "full_name" | "email" | "staff_role" | "account_type">[]>(
    `profiles?select=id,full_name,email,staff_role,account_type&account_status=eq.active&or=(account_type.eq.admin,staff_role.not.is.null)&order=full_name.asc`,
  );
}

// ─── Mutations (guarded RPCs) ──────────────────────────────────────────────
export function setConversation(input: {
  conversationId: string;
  status?: WaStatus;
  category?: WaCategory;
  priority?: WaPriority;
}): Promise<Result<boolean>> {
  return prpc<boolean>("wa_set_conversation", {
    p_conversation: input.conversationId,
    p_status: input.status ?? null,
    p_category: input.category ?? null,
    p_priority: input.priority ?? null,
    p_assigned: null,
    p_clear_assignment: false,
    p_reason: null,
  });
}

export function assignConversation(input: {
  conversationId: string;
  assignedTo: string | null;   // null → clear assignment
  reason?: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("wa_set_conversation", {
    p_conversation: input.conversationId,
    p_status: null,
    p_category: null,
    p_priority: null,
    p_assigned: input.assignedTo,
    p_clear_assignment: input.assignedTo === null,
    p_reason: input.reason ?? null,
  });
}

export function addNote(conversationId: string, note: string): Promise<Result<string>> {
  return prpc<string>("wa_add_note", { p_conversation: conversationId, p_note: note });
}

export interface SendDiagnostic {
  sendEnabled: boolean;
  flagEnabled: boolean;
  tokenPresent: boolean;
  phoneIdPresent: boolean;
  apiVersion: string;
  allowlistCount: number;
  startConversationEnabled: boolean;
  templateSendEnabled: boolean;
  internalAlertsEnabled: boolean;
}

/** Server diagnostic (no secrets): whether real WhatsApp sending is active +
 *  presence booleans. Drives the dry-run banner and the ops diagnostic line. */
export async function getSendStatus(): Promise<SendDiagnostic> {
  try {
    const res = await fetch("/api/integrations/whatsapp/send", { method: "GET" });
    const d = (await res.json()) as {
      send_enabled?: boolean; flag_enabled?: boolean; token_present?: boolean;
      phone_id_present?: boolean; api_version?: string; allowlist_count?: number;
      start_conversation_enabled?: boolean; template_send_enabled?: boolean; internal_alerts_enabled?: boolean;
    };
    return {
      sendEnabled: !!d.send_enabled, flagEnabled: !!d.flag_enabled,
      tokenPresent: !!d.token_present, phoneIdPresent: !!d.phone_id_present,
      apiVersion: d.api_version || "", allowlistCount: d.allowlist_count || 0,
      startConversationEnabled: !!d.start_conversation_enabled,
      templateSendEnabled: !!d.template_send_enabled,
      internalAlertsEnabled: !!d.internal_alerts_enabled,
    };
  } catch {
    return { sendEnabled: false, flagEnabled: false, tokenPresent: false, phoneIdPresent: false, apiVersion: "", allowlistCount: 0, startConversationEnabled: false, templateSendEnabled: false, internalAlertsEnabled: false };
  }
}

// ─── Quote requests (Part 2) ───────────────────────────────────────────────
export function listQuoteRequests(conversationId: string): Promise<Result<WaQuoteRequest[]>> {
  return pget<WaQuoteRequest[]>(`whatsapp_quote_requests?whatsapp_conversation_id=eq.${enc(conversationId)}&select=*&order=created_at.desc`);
}

export function createQuoteRequest(input: {
  conversationId: string; fullName?: string; company?: string; services?: string[];
  city?: string; preferredDate?: string | null; message?: string; category?: string;
}): Promise<Result<string>> {
  return prpc<string>("wa_create_quote_request", {
    p_conversation: input.conversationId, p_full_name: input.fullName ?? null, p_company: input.company ?? null,
    p_services: input.services ?? [], p_city: input.city ?? null, p_preferred_date: input.preferredDate ?? null,
    p_message: input.message ?? null, p_category: input.category ?? null,
  });
}

// ─── Staff WhatsApp alert settings (Part 1) ────────────────────────────────
export interface StaffAlertSettings { whatsapp_alert_phone: string | null; whatsapp_alert_enabled: boolean }

export async function getMyAlert(): Promise<StaffAlertSettings> {
  const uid = currentUserId();
  if (!uid) return { whatsapp_alert_phone: null, whatsapp_alert_enabled: false };
  const r = await pget<Array<{ whatsapp_alert_phone: string | null; whatsapp_alert_enabled: boolean }>>(
    `whatsapp_staff_alert_settings?user_id=eq.${enc(uid)}&select=whatsapp_alert_phone,whatsapp_alert_enabled&limit=1`);
  return r.ok && r.data[0] ? r.data[0] : { whatsapp_alert_phone: null, whatsapp_alert_enabled: false };
}

export function setMyAlert(phone: string, enabled: boolean): Promise<Result<boolean>> {
  return prpc<boolean>("wa_set_staff_alert", { p_user: null, p_phone: phone, p_enabled: enabled, p_departments: [] });
}

// ─── Start a new conversation (Part 3) ─────────────────────────────────────
export type StartConvResult = { ok: true; status: string; conversationId: string } | { ok: false; error: string };

export async function startConversation(input: {
  phone: string; name?: string; company?: string; department?: string; reason?: string;
  template: string; variables: string[]; preview?: string;
}): Promise<StartConvResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated" };
  try {
    const res = await fetch("/api/integrations/whatsapp/start-conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({
        phone: input.phone, name: input.name, company: input.company, department: input.department,
        reason: input.reason, template: input.template, variables: input.variables, preview: input.preview,
      }),
    });
    const d = (await res.json()) as { ok?: boolean; status?: string; conversation_id?: string; error?: string };
    if (!res.ok || !d.ok) return { ok: false, error: d.error || `HTTP ${res.status}` };
    return { ok: true, status: d.status || "dry_run", conversationId: d.conversation_id || "" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function setSalesStage(conversationId: string, stage: WaSalesStage): Promise<Result<boolean>> {
  return prpc<boolean>("wa_set_sales_stage", { p_conversation: conversationId, p_stage: stage });
}

export function setDepartment(conversationId: string, department: WaDepartment): Promise<Result<boolean>> {
  return prpc<boolean>("wa_set_department", { p_conversation: conversationId, p_department: department });
}

export function markRead(conversationId: string): Promise<Result<boolean>> {
  return prpc<boolean>("wa_mark_read", { p_conversation: conversationId });
}

export type ZohoSyncResult =
  | { ok: true; crmLeadId: string; action: string }
  | { ok: false; error: string };

/** Push this conversation's contact to Zoho CRM (upsert by phone), reflecting the
 *  current sales_stage. Server route enforces auth (RLS) + holds all secrets. */
export async function syncZoho(conversationId: string): Promise<ZohoSyncResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated" };
  try {
    const res = await fetch("/api/integrations/whatsapp/zoho-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ conversation_id: conversationId }),
    });
    const data = (await res.json()) as { ok?: boolean; crm_lead_id?: string; action?: string; error?: string };
    if (!data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, crmLeadId: data.crm_lead_id || "", action: data.action || "" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export type SendReplyStatus = "dry_run" | "sent" | "blocked" | "failed";
export type SendReplyResult =
  | { ok: true; status: SendReplyStatus; dryRun: boolean; messageId: string }
  | { ok: false; error: string };

/**
 * Reply from the portal. Posts to the server-only send route with the logged-in
 * user's access token; the route records the message (DB-authorized) and only
 * actually contacts WhatsApp when WHATSAPP_SEND_ENABLED=true (else dry-run).
 */
export async function sendReply(conversationId: string, body: string): Promise<SendReplyResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated" };
  try {
    const res = await fetch("/api/integrations/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ conversation_id: conversationId, body }),
    });
    const data = (await res.json()) as { ok?: boolean; dry_run?: boolean; status?: string; message_id?: string; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, status: (data.status as SendReplyStatus) || (data.dry_run ? "dry_run" : "sent"), dryRun: !!data.dry_run, messageId: data.message_id || "" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

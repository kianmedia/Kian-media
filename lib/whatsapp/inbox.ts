// ════════════════════════════════════════════════════════════════════════
// Kian — WhatsApp inbox data layer for the admin UI.
//
// Reads go through the anon-key REST client (RLS decides which rows are
// visible). Writes go through the SECURITY DEFINER RPCs from
// docs/whatsapp_inbox_RUNME.sql (wa_set_conversation / wa_assign_conversation /
// wa_add_note) — there is NO table write-grant and NO service-role key here.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";
import type {
  WaConversation, WaContact, WaMessage, WaAssignment, WaInternalNote,
  WaStatus,
} from "@/lib/whatsapp/types";
import type { WaCategory, WaPriority } from "@/lib/whatsapp/classify";
import type { Profile } from "@/lib/portal/types";

export interface WaListFilters {
  status?: WaStatus | "";
  category?: WaCategory | "";
  search?: string;
}

/** Conversations visible to the viewer (RLS-filtered), newest activity first. */
export function listConversations(filters: WaListFilters = {}, limit = 200): Promise<Result<WaConversation[]>> {
  const parts = ["select=*", "order=last_message_at.desc.nullslast", `limit=${limit}`];
  if (filters.status) parts.push(`status=eq.${enc(filters.status)}`);
  if (filters.category) parts.push(`category=eq.${enc(filters.category)}`);
  return pget<WaConversation[]>(`whatsapp_conversations?${parts.join("&")}`);
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

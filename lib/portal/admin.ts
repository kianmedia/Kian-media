// ════════════════════════════════════════════════════════════════════════
// Kian Portal — ADMIN-ONLY operations.
//
// Every mutation goes through an is_admin()-guarded SECURITY DEFINER RPC
// (phase1_addendum_s1.sql) — there is no service-role key in the frontend,
// and the database rejects these calls for any non-admin account.
//
// ⚠️ Import this module ONLY from admin-panel components. Internal comments
// in particular must never be rendered in client-facing components.
// ════════════════════════════════════════════════════════════════════════

import { pget, ppost, prpc, enc, currentUserId, type Result } from "@/lib/portal/client";
import type {
  AccountStatus, AccountType, ClientLevel, ClientRow, DeliverableStatus, DeliverableType,
  FileLink, InternalComment, InternalCommentCategory, MessageRow, NotificationType,
  Profile, Project, ProjectMember, ProjectMemberRole, ProjectMessage, ProjectStatus, QuoteRequest,
  StaffRole,
} from "@/lib/portal/types";

/** Sender info shown in the admin inbox (subset of profiles). */
export type SenderProfile = Pick<Profile, "id" | "email" | "full_name" | "company" | "account_type">;

// ─── Inboxes (reads pass through the admin-all RLS policies) ───
export function adminListQuotes(status?: string): Promise<Result<QuoteRequest[]>> {
  const filter = status ? `&status=eq.${enc(status)}` : "";
  return pget<QuoteRequest[]>(`quote_requests?select=*${filter}&order=created_at.desc`);
}

/** All client-submitted file links (admin reads all via the files RLS policy). */
export function adminListAllFiles(limit = 300): Promise<Result<FileLink[]>> {
  return pget<FileLink[]>(`file_links?select=*&order=created_at.desc&limit=${limit}`);
}

/** All projects (admin-all RLS). */
export function adminListProjects(limit = 300): Promise<Result<Project[]>> {
  return pget<Project[]>(`projects?select=*&is_deleted=eq.false&order=created_at.desc&limit=${limit}`);
}

/** Resolve client rows (name/company) for a set of clients.id values. */
export async function adminListClientsByIds(ids: string[]): Promise<Result<ClientRow[]>> {
  if (ids.length === 0) return { ok: true, data: [] };
  const inList = ids.map((id) => enc(id)).join(",");
  return pget<ClientRow[]>(`clients?id=in.(${inList})&select=id,user_id,full_name,company,email`);
}

/** All portal profiles for account management (admin reads all via profiles RLS). */
export function adminListProfiles(limit = 500): Promise<Result<Profile[]>> {
  return pget<Profile[]>(`profiles?select=*&order=created_at.desc&limit=${limit}`);
}

/** Exact row count for a dashboard tile (head request). 0 on any error. */
export async function adminCount(table: string, filter = ""): Promise<number> {
  const r = await pget<unknown[]>(`${table}?select=id${filter ? `&${filter}` : ""}`, { count: true });
  return r.ok ? (r.count ?? 0) : 0;
}

export function adminListMessages(userId: string): Promise<Result<MessageRow[]>> {
  return pget<MessageRow[]>(`messages?user_id=eq.${enc(userId)}&select=*&order=created_at.asc`);
}

/** All recent support messages across every user (admin-all RLS policy). */
export function adminListAllMessages(limit = 300): Promise<Result<MessageRow[]>> {
  return pget<MessageRow[]>(`messages?select=*&order=created_at.desc&limit=${limit}`);
}

/** Sender profiles for the inbox. user_id→auth.users has no PostgREST embed to
 *  profiles, so we resolve them in a second query (admin reads all profiles). */
export async function adminListSenders(userIds: string[]): Promise<Result<SenderProfile[]>> {
  if (userIds.length === 0) return { ok: true, data: [] };
  const inList = userIds.map((id) => enc(id)).join(",");
  return pget<SenderProfile[]>(`profiles?id=in.(${inList})&select=id,email,full_name,company,account_type`);
}

/** Reply in a user's support thread (admin-all policy + insert grant). */
export async function adminReplySupport(userId: string, body: string): Promise<Result<MessageRow>> {
  const r = await ppost<MessageRow[]>(`messages`, { user_id: userId, sender: "admin", body });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

/** Project chat as the Kian side (policy requires kian membership or admin). */
export async function adminSendChat(projectId: string, body: string): Promise<Result<ProjectMessage>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<ProjectMessage[]>(`project_messages`, {
    project_id: projectId, sender_id: uid, sender_role: "admin", body,
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── Internal comments (Kian-only; invisible to clients by RLS) ───
export function adminListInternalComments(opts: { projectId?: string; deliverableId?: string }): Promise<Result<InternalComment[]>> {
  const f = opts.deliverableId
    ? `deliverable_id=eq.${enc(opts.deliverableId)}`
    : `project_id=eq.${enc(opts.projectId ?? "")}`;
  return pget<InternalComment[]>(`internal_comments?${f}&select=*&order=created_at.asc`);
}

export async function adminAddInternalComment(input: {
  projectId?: string; deliverableId?: string;
  category?: InternalCommentCategory; body: string; timecodeSeconds?: number;
}): Promise<Result<InternalComment>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<InternalComment[]>(`internal_comments`, {
    project_id: input.projectId ?? null,
    deliverable_id: input.deliverableId ?? null,
    author_id: uid,
    category: input.category ?? "general",
    body: input.body,
    timecode_seconds: input.timecodeSeconds ?? null,
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── Guarded admin RPCs (phase1_addendum_s1.sql) ───
export function adminSetProjectStatus(projectId: string, status: ProjectStatus): Promise<Result<boolean>> {
  return prpc<boolean>("admin_set_project_status", { p_project: projectId, p_status: status });
}

export function adminAddDeliverable(input: {
  projectId: string; title: string; type?: DeliverableType;
  previewUrl?: string; vimeoUrl?: string;
  status?: Extract<DeliverableStatus, "draft" | "internal_review" | "client_review">;
}): Promise<Result<string>> {
  return prpc<string>("admin_add_deliverable", {
    p_project: input.projectId,
    p_title: input.title,
    p_type: input.type ?? "video",
    p_preview_url: input.previewUrl ?? null,
    p_vimeo_url: input.vimeoUrl ?? null,
    p_status: input.status ?? "draft",
  });
}

export function adminSetDeliverable(input: {
  deliverableId: string; status?: DeliverableStatus;
  allowDownload?: boolean; previewUrl?: string; vimeoUrl?: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("admin_set_deliverable", {
    p_dlv: input.deliverableId,
    p_status: input.status ?? null,
    p_allow_download: input.allowDownload ?? null,
    p_preview_url: input.previewUrl ?? null,
    p_vimeo_url: input.vimeoUrl ?? null,
  });
}

export function adminAddFinalAsset(deliverableId: string, url: string): Promise<Result<string>> {
  return prpc<string>("admin_add_final_asset", { p_dlv: deliverableId, p_url: url });
}

export function adminNotify(input: {
  userId: string; type: NotificationType;
  entityType?: string; entityId?: string;
  titleAr: string; titleEn: string;
}): Promise<Result<null>> {
  return prpc<null>("admin_notify", {
    p_user: input.userId,
    p_type: input.type,
    p_etype: input.entityType ?? null,
    p_eid: input.entityId ?? null,
    p_ar: input.titleAr,
    p_en: input.titleEn,
  });
}

export function adminSetAccount(input: {
  userId: string; type?: AccountType; status?: AccountStatus;
  level?: ClientLevel; companyId?: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("admin_set_account", {
    p_user: input.userId,
    p_type: input.type ?? null,
    p_status: input.status ?? null,
    p_level: input.level ?? null,
    p_company: input.companyId ?? null,
  });
}

/** Restore a soft-deleted record (admin-only; DB-enforced). */
export function adminRestoreRecord(table: string, id: string): Promise<Result<boolean>> {
  return prpc<boolean>("restore_record", { p_table: table, p_id: id });
}

// ─── Client → project linking (client_project_linking_PROPOSAL.sql RPCs) ─────
// All three are is_admin()-guarded SECURITY DEFINER RPCs — no table grants, no
// service-role key. admin_create_project returns the new project id;
// admin_add_project_member is idempotent (revives/updates an existing membership).

export function adminCreateProject(input: {
  title: string; clientId?: string | null; companyId?: string | null;
  status?: ProjectStatus; notes?: string | null; shootingDate?: string | null;
}): Promise<Result<string>> {
  return prpc<string>("admin_create_project", {
    p_title: input.title,
    p_client: input.clientId ?? null,
    p_company: input.companyId ?? null,
    p_status: input.status ?? "request_received",
    p_notes: input.notes ?? null,
    p_shooting: input.shootingDate ?? null,
  });
}

export function adminAddProjectMember(input: {
  projectId: string; userId: string; role?: ProjectMemberRole;
}): Promise<Result<string>> {
  return prpc<string>("admin_add_project_member", {
    p_project: input.projectId,
    p_user: input.userId,
    p_role: input.role ?? "client_owner",
  });
}

export function adminRemoveProjectMember(input: {
  projectId: string; userId: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("admin_remove_project_member", {
    p_project: input.projectId,
    p_user: input.userId,
  });
}

/** Active project memberships for one user (admin reads all via the members RLS). */
export function adminListMembershipsForUser(userId: string): Promise<Result<ProjectMember[]>> {
  return pget<ProjectMember[]>(
    `project_members?user_id=eq.${enc(userId)}&is_deleted=eq.false&select=*&order=created_at.desc`
  );
}

/** Active members of a project (assigned staff = the kian_* roles; filter in UI). */
export function adminListProjectMembers(projectId: string): Promise<Result<ProjectMember[]>> {
  return pget<ProjectMember[]>(
    `project_members?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=created_at.asc`
  );
}

// ─── Staff roles & task assignment (staff_roles_task_assignment RUNME RPCs) ──
// admin_set_staff_role = owner-only (is_owner); staff_*_deliverable = assigned
// editors (can_edit_project) and never set final_delivered (DB-enforced).

export function adminSetStaffRole(input: { userId: string; role: StaffRole | null }): Promise<Result<boolean>> {
  return prpc<boolean>("admin_set_staff_role", { p_user: input.userId, p_role: input.role });
}

export function staffAddDeliverable(input: {
  projectId: string; title: string; type?: DeliverableType;
  previewUrl?: string; vimeoUrl?: string;
  status?: Extract<DeliverableStatus, "draft" | "internal_review" | "client_review">;
}): Promise<Result<string>> {
  return prpc<string>("staff_add_deliverable", {
    p_project: input.projectId,
    p_title: input.title,
    p_type: input.type ?? "video",
    p_preview_url: input.previewUrl ?? null,
    p_vimeo_url: input.vimeoUrl ?? null,
    p_status: input.status ?? "client_review",
  });
}

export function staffSetDeliverable(input: {
  deliverableId: string;
  status?: Extract<DeliverableStatus, "draft" | "internal_review" | "client_review" | "revision_requested" | "approved">;
  previewUrl?: string; vimeoUrl?: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("staff_set_deliverable", {
    p_dlv: input.deliverableId,
    p_status: input.status ?? null,
    p_preview_url: input.previewUrl ?? null,
    p_vimeo_url: input.vimeoUrl ?? null,
  });
}

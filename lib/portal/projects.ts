// ════════════════════════════════════════════════════════════════════════
// Kian Portal — client workspace domain: projects, team, chat, notes, files.
// Visibility is membership-based via RLS (can_access_project); these helpers
// never need to re-check it.
// ════════════════════════════════════════════════════════════════════════

import { pget, ppost, prpc, enc, currentUserId, type Result } from "@/lib/portal/client";
import type {
  FileLink, Project, ProjectMember, ProjectMemberRole, ProjectMessage, ProjectNote,
} from "@/lib/portal/types";

export function listMyProjects(): Promise<Result<Project[]>> {
  return pget<Project[]>(`projects?select=*&order=created_at.desc`);
}

/** On login: attach any pending (admin-created, no-account) projects whose client
 *  record email matches the caller's VERIFIED profile email, and repair memberships.
 *  Best-effort — called from the portal bootstrap; never blocks the session. */
export function syncProjectsForCurrentUser(): Promise<Result<{ linked_clients: number; linked_members: number }>> {
  return prpc<{ linked_clients: number; linked_members: number }>("sync_projects_for_current_user", {});
}

export interface ProjectProgressPhase { key: string; ar: string; en: string; weight: number; pct: number; earned: number }
export interface ProjectProgress { pct: number; overridden?: boolean; auto_pct?: number; delivered: boolean; phases: ProjectProgressPhase[] }
/** Authoritative weighted progress — identical for admin and client (P0-9). */
export function projectProgress(projectId: string): Promise<Result<ProjectProgress>> {
  return prpc<ProjectProgress>("project_progress", { p_project: projectId });
}

export async function getProject(id: string): Promise<Result<Project | null>> {
  const r = await pget<Project[]>(`projects?id=eq.${enc(id)}&select=*`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}

export function listMembers(projectId: string): Promise<Result<ProjectMember[]>> {
  return pget<ProjectMember[]>(
    `project_members?project_id=eq.${enc(projectId)}&select=*&order=created_at.asc`
  );
}

/**
 * My role on this project, via the same security-definer function RLS uses.
 * Returns null for legacy single-contact clients (no membership row) — the
 * caller should treat legacy contacts as owner (matches is_client_owner()).
 */
export async function myRoleInProject(projectId: string): Promise<Result<ProjectMemberRole | null>> {
  return prpc<ProjectMemberRole | null>("project_role", { p_project: projectId });
}

/** Owner check mirroring public.is_client_owner(): explicit role OR legacy contact. */
export async function canApprove(projectId: string): Promise<boolean> {
  const role = await myRoleInProject(projectId);
  if (role.ok && role.data === "client_owner") return true;
  if (role.ok && role.data !== null) return false; // member/kian roles can't approve
  // No membership row → legacy contact iff the project is visible at all.
  const p = await getProject(projectId);
  return p.ok && p.data !== null;
}

// ─── Project chat ───
export function listChat(projectId: string): Promise<Result<ProjectMessage[]>> {
  return pget<ProjectMessage[]>(
    `project_messages?project_id=eq.${enc(projectId)}&select=*&order=created_at.asc`
  );
}

export async function sendChat(projectId: string, body: string): Promise<Result<ProjectMessage>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<ProjectMessage[]>(`project_messages`, {
    project_id: projectId, sender_id: uid, sender_role: "client", body,
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── Notes & references ───
export function listNotes(projectId: string): Promise<Result<ProjectNote[]>> {
  return pget<ProjectNote[]>(
    `project_notes?project_id=eq.${enc(projectId)}&select=*&order=created_at.desc`
  );
}

export async function addNote(projectId: string, body: string, referenceUrl?: string): Promise<Result<ProjectNote>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<ProjectNote[]>(`project_notes`, {
    project_id: projectId, author_id: uid, author_role: "client",
    body, reference_url: referenceUrl ?? null,
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── Project-scoped file links ───
export function listProjectFiles(projectId: string): Promise<Result<FileLink[]>> {
  return pget<FileLink[]>(
    `file_links?project_id=eq.${enc(projectId)}&select=*&order=created_at.desc`
  );
}

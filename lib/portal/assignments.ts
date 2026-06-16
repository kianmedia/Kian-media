// ════════════════════════════════════════════════════════════════════════
// Kian Portal — staff assignment notes. Notes are admin/manager-written and
// readable by managers/owner + the assigned staff member only (RLS), NEVER by
// clients. Writes go through is_admin()/can_manage_projects()-guarded RPCs.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";
import type { AssignmentNote } from "@/lib/portal/types";

/** Notes for one (project, staff) pair, newest first. RLS scopes who can read. */
export function listAssignmentNotes(projectId: string, staffUserId: string): Promise<Result<AssignmentNote[]>> {
  return pget<AssignmentNote[]>(
    `assignment_notes?project_id=eq.${enc(projectId)}&staff_user_id=eq.${enc(staffUserId)}&is_deleted=eq.false&select=*&order=created_at.desc`
  );
}

/** All assignment notes addressed to the current staff user (their own). */
export function listMyAssignmentNotes(staffUserId: string): Promise<Result<AssignmentNote[]>> {
  return pget<AssignmentNote[]>(
    `assignment_notes?staff_user_id=eq.${enc(staffUserId)}&is_deleted=eq.false&select=*&order=created_at.desc`
  );
}

export function addAssignmentNote(input: { projectId: string; staffUserId: string; body: string }): Promise<Result<string>> {
  return prpc<string>("add_assignment_note", { p_project: input.projectId, p_staff: input.staffUserId, p_body: input.body });
}

export function removeAssignmentNote(noteId: string): Promise<Result<boolean>> {
  return prpc<boolean>("remove_assignment_note", { p_note: noteId });
}

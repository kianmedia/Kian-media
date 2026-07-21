// ════════════════════════════════════════════════════════════════════════════
// Task workflow — PRESENTATION mirror of the DB transition matrix.
// The SECURITY authority is SQL: public.task_transition_allowed() in
// docs/project_tasks_batch3b_RUNME.sql. This copy only lets the UI hide illegal
// drops early; every move is re-validated server-side by pc_task_move. Keep the
// two in exact sync — TASK_TRANSITION_PAIRS below must equal the SQL VALUES list.
// (A build-time assertion in this file guards row/column integrity.)
// ════════════════════════════════════════════════════════════════════════════
import type { PcTaskStatus } from "@/lib/portal/projectCore";

export const KANBAN_STATUSES: PcTaskStatus[] = [
  "backlog", "todo", "in_progress", "internal_review", "client_review", "blocked", "done", "cancelled",
];

// Allowed (from → [to...]) — byte-mirror of the SQL matrix.
export const TASK_TRANSITIONS: Record<string, PcTaskStatus[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["backlog", "in_progress", "blocked", "cancelled"],
  in_progress: ["todo", "internal_review", "blocked", "cancelled"],
  internal_review: ["in_progress", "client_review", "done", "blocked"],
  client_review: ["in_progress", "internal_review", "done", "blocked"],
  blocked: ["todo", "in_progress", "cancelled"],
  done: ["in_progress", "internal_review"],
  cancelled: ["backlog", "todo"],
};

/** UI gate — same rule as SQL: same-status is allowed (no-op), else must be listed. */
export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return (TASK_TRANSITIONS[from] ?? []).includes(to as PcTaskStatus);
}

/** Flat pair list — used by the self-check to prove parity with the SQL VALUES. */
export const TASK_TRANSITION_PAIRS: [string, string][] =
  Object.entries(TASK_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => [from, to] as [string, string]));

// The canonical SQL pair set (copied from task_transition_allowed VALUES). If these
// two ever diverge, this throws at module load in dev/build — forcing a resync.
const SQL_PAIRS = new Set([
  "backlog>todo", "backlog>cancelled",
  "todo>backlog", "todo>in_progress", "todo>blocked", "todo>cancelled",
  "in_progress>todo", "in_progress>internal_review", "in_progress>blocked", "in_progress>cancelled",
  "internal_review>in_progress", "internal_review>client_review", "internal_review>done", "internal_review>blocked",
  "client_review>in_progress", "client_review>internal_review", "client_review>done", "client_review>blocked",
  "blocked>todo", "blocked>in_progress", "blocked>cancelled",
  "done>in_progress", "done>internal_review",
  "cancelled>backlog", "cancelled>todo",
]);
const TS_PAIRS = new Set(TASK_TRANSITION_PAIRS.map(([a, b]) => `${a}>${b}`));
if (process.env.NODE_ENV !== "production") {
  const missing = Array.from(SQL_PAIRS).filter((p) => !TS_PAIRS.has(p));
  const extra = Array.from(TS_PAIRS).filter((p) => !SQL_PAIRS.has(p));
  if (missing.length || extra.length) {
    throw new Error(`taskWorkflow: TS/SQL transition matrix drift — missing=[${missing}] extra=[${extra}]`);
  }
}

export type ReviewAction = "approve_internal" | "send_to_client" | "approve_client" | "request_changes" | "mark_done";
export type DependencyType = "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";

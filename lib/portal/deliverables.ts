// ════════════════════════════════════════════════════════════════════════
// Kian Portal — deliverable review domain: items, timestamp comments,
// approve / request-revision decisions, gated downloads, soft delete.
// ════════════════════════════════════════════════════════════════════════

import { pget, ppost, prpc, enc, currentUserId, type Result } from "@/lib/portal/client";
import type {
  ClientComment, Deliverable, DeliverableReview, ReviewDecision, SoftDeletableTable,
} from "@/lib/portal/types";

// ─── Timecode helpers (92 ⇄ "00:01:32") ───
export function secondsToTimecode(s: number): string {
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(r)}`;
}

/** Accepts "ss", "mm:ss" or "hh:mm:ss"; returns null when unparseable. */
export function timecodeToSeconds(tc: string): number | null {
  const parts = tc.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// ─── Deliverables ───
// Filter is_deleted=false explicitly: the "admin all dlv" RLS policy lets admins
// read EVERY row (including soft-deleted ones), so without this filter a
// soft-deleted preview stays visible in the admin list. Clients are already
// filtered by RLS; the explicit filter keeps both views consistent.
export function listDeliverables(projectId: string): Promise<Result<Deliverable[]>> {
  return pget<Deliverable[]>(
    `deliverables?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=created_at.desc`
  );
}

// ─── Timestamp comments ───
export function listComments(deliverableId: string): Promise<Result<ClientComment[]>> {
  return pget<ClientComment[]>(
    `client_comments?deliverable_id=eq.${enc(deliverableId)}&select=*&order=created_at.asc`
  );
}

export async function addComment(
  deliverableId: string, body: string, timecodeSeconds?: number
): Promise<Result<ClientComment>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<ClientComment[]>(`client_comments`, {
    deliverable_id: deliverableId,
    author_id: uid,
    author_role: "client",
    body,
    timecode_seconds: timecodeSeconds ?? null,
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── Formal decisions (client_owner only, during client_review — RLS-enforced) ───
export function listReviews(deliverableId: string): Promise<Result<DeliverableReview[]>> {
  return pget<DeliverableReview[]>(
    `deliverable_reviews?deliverable_id=eq.${enc(deliverableId)}&select=*&order=created_at.desc`
  );
}

/**
 * All reviews across a set of deliverables (newest first). RLS scopes the rows:
 * admin reads every review (is_admin path), a client reads only reviews on their
 * own project's deliverables. Used for the project-detail summary cards and the
 * admin "client notes & revision requests" section.
 */
export function listReviewsForDeliverables(ids: string[]): Promise<Result<DeliverableReview[]>> {
  if (ids.length === 0) return Promise.resolve({ ok: true, data: [] });
  const inList = ids.map((id) => enc(id)).join(",");
  return pget<DeliverableReview[]>(
    `deliverable_reviews?deliverable_id=in.(${inList})&select=*&order=created_at.desc`
  );
}

export async function submitReview(
  deliverableId: string, decision: ReviewDecision, comments?: string
): Promise<Result<DeliverableReview>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<DeliverableReview[]>(`deliverable_reviews`, {
    deliverable_id: deliverableId,
    reviewer_id: uid,
    decision,
    comments: comments ?? null,
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

// ─── Gated final download (null until admin allows + status approved/final) ───
export function getDownloadUrl(deliverableId: string): Promise<Result<string | null>> {
  return prpc<string | null>("get_deliverable_download", { p_deliverable: deliverableId });
}

// ─── Soft delete (the ONLY deletion path in the portal) ───
export function softDelete(table: SoftDeletableTable, id: string): Promise<Result<boolean>> {
  return prpc<boolean>("soft_delete", { p_table: table, p_id: id });
}

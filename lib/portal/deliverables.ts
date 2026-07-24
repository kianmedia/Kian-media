// ════════════════════════════════════════════════════════════════════════
// Kian Portal — deliverable review domain: items, timestamp comments,
// approve / request-revision decisions, gated downloads, soft delete.
// ════════════════════════════════════════════════════════════════════════

import { pget, ppost, prpc, enc, currentUserId, type Result } from "@/lib/portal/client";
import { getValidSession, SUPABASE_URL, SUPABASE_KEY } from "@/lib/portalAuth";
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
  deliverableId: string, body: string,
  opts?: { versionId?: string; timecodeSeconds?: number; pageNumber?: number; posX?: number; posY?: number; kind?: "comment" | "annotation" }
): Promise<Result<ClientComment>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await ppost<ClientComment[]>(`client_comments`, {
    deliverable_id: deliverableId,
    version_id: opts?.versionId ?? null,
    author_id: uid,
    author_role: "client",
    body,
    timecode_seconds: opts?.timecodeSeconds ?? null,
    page_number: opts?.pageNumber ?? null,
    pos_x: opts?.posX ?? null,
    pos_y: opts?.posY ?? null,
    kind: opts?.kind ?? (opts?.timecodeSeconds != null || opts?.pageNumber != null || opts?.posX != null ? "annotation" : "comment"),
  });
  if (!r.ok) return r;
  return r.data[0]
    ? { ok: true, data: r.data[0] }
    : { ok: false, error: "insert returned no row" };
}

/** Batch: all client_comments across a set of deliverables (admin/staff view via
 *  the "client_comments staff read" RLS). Newest-first per deliverable. */
export function listCommentsForDeliverables(ids: string[]): Promise<Result<ClientComment[]>> {
  if (ids.length === 0) return Promise.resolve({ ok: true, data: [] });
  const inList = ids.map((id) => enc(id)).join(",");
  return pget<ClientComment[]>(
    `client_comments?deliverable_id=in.(${inList})&is_deleted=eq.false&select=*&order=created_at.asc`
  );
}

/** Staff/admin: resolve a comment or a revision-request note + optional Kian response. */
export function resolveNote(
  kind: "comment" | "review", id: string, status: "open" | "in_progress" | "resolved", response?: string
): Promise<Result<boolean>> {
  return prpc<boolean>("admin_resolve_note", { p_kind: kind, p_id: id, p_status: status, p_response: response ?? null });
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

// ─── Gated final download ───
// The gate now requires status='final_delivered' AND the project's dues are
// confirmed cleared by an admin (project_delivery_release). getDownloadUrl is a
// read-only check (does the button show?); downloadDeliverable LOGS the fetch and
// is what the actual Download click calls. Both return null while the gate is shut.
export function getDownloadUrl(deliverableId: string): Promise<Result<string | null>> {
  return prpc<string | null>("get_deliverable_download", { p_deliverable: deliverableId });
}
export function downloadDeliverable(deliverableId: string): Promise<Result<string | null>> {
  return prpc<string | null>("client_download_deliverable", { p_deliverable: deliverableId });
}
/** True once an admin confirmed all client dues for the project were received. */
export function paymentCleared(projectId: string): Promise<Result<boolean>> {
  return prpc<boolean>("project_payment_cleared", { p_project: projectId });
}

// ─── §7 release policy (window/limit) + honest download state ───
export interface DownloadState {
  allowed: boolean;
  reason: "ok" | "not_final" | "payment_pending" | "window_expired" | "limit_reached";
  used: number; limit: number | null; remaining: number | null;
  window: "none" | "24h" | "3d" | "7d" | "30d"; expires_at: string | null;
}
export function downloadState(deliverableId: string): Promise<Result<DownloadState>> {
  return prpc<DownloadState>("deliverable_download_state", { p_deliverable: deliverableId });
}

// ─── P0-1 client final-receipt confirmation ("تأكيد استلام الملفات النهائية") ───
export interface ReceiptState { confirmed: boolean; received_at: string | null; received_by_name: string | null }
export function confirmFinalReceipt(deliverableId: string, name?: string, note?: string): Promise<Result<{ ok: boolean; received_at: string }>> {
  return prpc<{ ok: boolean; received_at: string }>("client_confirm_final_receipt", { p_deliverable: deliverableId, p_name: name ?? null, p_note: note ?? null });
}
export function deliverableReceipt(deliverableId: string): Promise<Result<ReceiptState>> {
  return prpc<ReceiptState>("deliverable_receipt", { p_deliverable: deliverableId });
}

// ─── §2 true versioning ───
export interface VersionSummary {
  id: string; version_no: number; label: string;
  preview_url: string | null; vimeo_review_url: string | null; preview_type: "video" | "image" | "pdf" | "office" | "other";
  note: string | null; decision: "pending" | "approved" | "revision_requested"; revision_reason: string | null;
  uploaded_by: string | null; uploaded_by_name: string | null; uploaded_at: string;
  is_current: boolean; is_final: boolean; addressed_comment_ids: string[];
  open_comments: number; resolved_comments: number;
}
export function listVersionSummary(deliverableId: string): Promise<Result<VersionSummary[]>> {
  return prpc<VersionSummary[]>("deliverable_version_summary", { p_deliverable: deliverableId });
}
export function addDeliverableVersion(deliverableId: string, data: Record<string, unknown>): Promise<Result<string>> {
  return prpc<string>("admin_add_deliverable_version", { p_deliverable: deliverableId, p_data: data });
}
export async function reviewVersion(
  versionId: string, decision: "approved" | "revision_requested", comments?: string,
): Promise<Result<{ processed?: { claimed: number; sent: number }; email_channel_enabled?: boolean }>> {
  // Batch 9F HOTFIX — SERVER-AUTHORITATIVE. One server call performs the mutation
  // (client_review_version, RLS-enforced) AND drains the just-enqueued email in the
  // same request. Replaces the old browser RPC + fire-and-forget drain kick (proven
  // unreliable: the approval email stayed pending, attempts=0, until the daily cron).
  try {
    const s = await getValidSession();
    if (!s?.access_token) return { ok: false, error: "not_authenticated" };
    const res = await fetch("/api/integrations/project/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ version_id: versionId, decision, comments: comments ?? null }),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && j.ok === true) return { ok: true, data: j as { processed?: { claimed: number; sent: number }; email_channel_enabled?: boolean } };
    return { ok: false, error: String(j.error ?? `http_${res.status}`) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}
export function setFinalVersion(deliverableId: string, versionId: string, finalUrl?: string): Promise<Result<boolean>> {
  return prpc<boolean>("admin_set_final_version", { p_deliverable: deliverableId, p_version: versionId, p_final_url: finalUrl ?? null });
}

// ─── P0-1 clean-final master (private project-deliverables bucket) ───
export interface FinalMasterState {
  has_final: boolean; version_id?: string; version_no?: number;
  status: "none" | "present" | "missing_or_unsafe"; safe: boolean;
  name?: string | null; mime?: string | null; size?: number | null; uploaded_at?: string | null; uploaded_by?: string | null;
}
export function finalMasterState(deliverableId: string): Promise<Result<FinalMasterState>> {
  return prpc<FinalMasterState>("deliverable_final_master_state", { p_deliverable: deliverableId });
}
export function setVersionFinalMaster(versionId: string, path: string, name?: string, mime?: string, size?: number): Promise<Result<boolean>> {
  return prpc<boolean>("admin_set_version_final_master", { p_version: versionId, p_path: path, p_name: name ?? null, p_mime: mime ?? null, p_size: size ?? null });
}
// Upload a clean unwatermarked master to the PRIVATE project-deliverables bucket, then
// record it on the version. The object path (never a public URL) is what the gated
// server-side signer resolves at download time.
export async function uploadFinalMaster(deliverableId: string, versionId: string, file: File): Promise<Result<boolean>> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated" };
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const path = `${deliverableId}/master/${versionId}/${Date.now()}_${safe}`;
  try {
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/project-deliverables/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}`, "x-upsert": "true", "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!up.ok) return { ok: false, error: `upload_failed_${up.status}` };
  } catch (e) { return { ok: false, error: String(e) }; }
  return setVersionFinalMaster(versionId, path, file.name, file.type || undefined, file.size);
}
/** Comments for a specific version (annotation-aware). Client & staff RLS-scoped. */
export function listCommentsForVersion(versionId: string): Promise<Result<ClientComment[]>> {
  return pget<ClientComment[]>(
    `client_comments?version_id=eq.${enc(versionId)}&is_deleted=eq.false&select=*&order=created_at.asc`
  );
}

// ─── Soft delete (the ONLY deletion path in the portal) ───
export function softDelete(table: SoftDeletableTable, id: string): Promise<Result<boolean>> {
  return prpc<boolean>("soft_delete", { p_table: table, p_id: id });
}

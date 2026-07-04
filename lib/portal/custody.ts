// ════════════════════════════════════════════════════════════════════════
// Kian Portal — Equipment Custody & Rental (عهدة وتأجير المعدات).
// Reads are RLS-scoped (party sees own records; custody managers see all).
// EVERY write goes through a SECURITY DEFINER RPC — no table write grants.
// Evidence photos live in the PRIVATE bucket custody-evidence with owner-first
// paths {user_id}/{record_id}/before|after/... and are displayed via signed
// URLs only. Mirrors docs/portal_equipment_custody_rental_RUNME.sql.
//
// NOTE: the generic request() in lib/portal/client.ts is JSON-only, so the two
// storage helpers below do their own fetch (same headers + one 401-refresh retry).
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";
import { getValidSession, SUPABASE_URL, SUPABASE_KEY } from "@/lib/portalAuth";

// ─── Types (self-contained — no changes to lib/portal/types.ts) ───
export type RecordKind = "custody" | "rental";
export type RecordStatus =
  | "out" | "review_handover" | "rented" | "review_return" | "closed" | "rejected" | "flagged";

export interface CustodyRecord {
  id: string;
  record_no: string;
  kind: RecordKind;
  party_user_id: string;
  party_name: string;
  party_phone: string | null;
  party_role: "employee" | "renter";
  status: RecordStatus;
  shortage: boolean;
  shortage_note: string | null;
  admin_note: string | null;
  overall_before_path: string | null;
  overall_after_path: string | null;
  ack_signed: boolean;
  ack_signature: string | null;
  ack_signed_at: string | null;
  ack_type: "custody" | "rental_contract" | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustodyItem {
  id: string;
  record_id: string;
  name: string;
  qty: number;
  photo_before_path: string | null;
  photo_after_path: string | null;
  position: number;
}

export interface CustodyEvent {
  id: string;
  record_id: string;
  actor_user_id: string | null;
  body: string;
  created_at: string;
}

export interface RenterProfile {
  user_id: string;
  full_name: string;
  id_number: string;
  phone: string;
  email: string;
  address: string;
  created_at: string;
  updated_at: string;
}

export const CUSTODY_STATUS_LABELS: Record<RecordStatus, { ar: string; en: string }> = {
  out:             { ar: "في العهدة",                 en: "In custody" },
  review_handover: { ar: "بانتظار اعتماد التسليم",     en: "Awaiting handover approval" },
  rented:          { ar: "مُسلّمة للمستأجر",           en: "Handed to renter" },
  review_return:   { ar: "بانتظار مراجعة الإرجاع",     en: "Awaiting return review" },
  closed:          { ar: "مقفلة",                     en: "Closed" },
  rejected:        { ar: "مرفوضة",                    en: "Rejected" },
  flagged:         { ar: "مقفلة مع مطالبة",            en: "Closed with claim" },
};

// ─── Reads (RLS-scoped) ───
export function listMyCustodyRecords(kind: RecordKind, userId: string): Promise<Result<CustodyRecord[]>> {
  return pget<CustodyRecord[]>(
    `custody_records?kind=eq.${kind}&party_user_id=eq.${enc(userId)}&is_deleted=eq.false&select=*&order=created_at.desc`
  );
}
export function listAllCustodyRecords(): Promise<Result<CustodyRecord[]>> {
  return pget<CustodyRecord[]>(`custody_records?is_deleted=eq.false&select=*&order=created_at.desc&limit=300`);
}
export function listCustodyItems(recordId: string): Promise<Result<CustodyItem[]>> {
  return pget<CustodyItem[]>(`custody_items?record_id=eq.${enc(recordId)}&select=*&order=position.asc`);
}
export function listCustodyEvents(recordId: string): Promise<Result<CustodyEvent[]>> {
  return pget<CustodyEvent[]>(`custody_events?record_id=eq.${enc(recordId)}&select=*&order=created_at.asc`);
}
export async function getMyRenterProfile(userId: string): Promise<Result<RenterProfile | null>> {
  const r = await pget<RenterProfile[]>(`renter_profiles?user_id=eq.${enc(userId)}&select=*&limit=1`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}
/** Admin console: KYC rows for the rental parties on screen (RLS: managers read all). */
export function listRenterProfilesFor(userIds: string[]): Promise<Result<RenterProfile[]>> {
  if (userIds.length === 0) return Promise.resolve({ ok: true, data: [] });
  const inList = userIds.map((id) => enc(id)).join(",");
  return pget<RenterProfile[]>(`renter_profiles?user_id=in.(${inList})&select=*`);
}

// ─── Writes (guarded RPCs only) ───
export function upsertRenterProfile(p: {
  fullName: string; idNumber: string; phone: string; email: string; address: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("upsert_renter_profile", {
    p_full_name: p.fullName, p_id_number: p.idNumber, p_phone: p.phone,
    p_email: p.email, p_address: p.address,
  });
}

export interface CheckoutItemInput { name: string; qty: number; photo_before_path: string; }

export function submitCheckout(recordId: string, items: CheckoutItemInput[], overallBeforePath: string):
  Promise<Result<{ ok: boolean; record_no: string }>> {
  return prpc<{ ok: boolean; record_no: string }>("submit_checkout", {
    p_record: recordId, p_items: items, p_overall_before: overallBeforePath,
  });
}
export function submitRentalRequest(recordId: string, items: CheckoutItemInput[], overallBeforePath: string):
  Promise<Result<{ ok: boolean; record_no: string }>> {
  return prpc<{ ok: boolean; record_no: string }>("submit_rental_request", {
    p_record: recordId, p_items: items, p_overall_before: overallBeforePath,
  });
}
export function submitReturn(recordId: string, after: { item_id: string; path: string }[],
  overallAfterPath: string, shortage: boolean, note: string): Promise<Result<boolean>> {
  return prpc<boolean>("submit_return", {
    p_record: recordId, p_after: after, p_overall_after: overallAfterPath,
    p_shortage: shortage, p_note: note || null,
  });
}
export function adminApproveHandover(recordId: string): Promise<Result<boolean>> {
  return prpc<boolean>("admin_approve_handover", { p_record: recordId });
}
export function adminCloseCustody(recordId: string): Promise<Result<boolean>> {
  return prpc<boolean>("admin_close_custody", { p_record: recordId });
}
export function adminRejectCustody(recordId: string, note: string): Promise<Result<boolean>> {
  return prpc<boolean>("admin_reject_custody", { p_record: recordId, p_note: note || null });
}
export function adminAddCustodyNote(recordId: string, note: string): Promise<Result<boolean>> {
  return prpc<boolean>("admin_add_custody_note", { p_record: recordId, p_note: note });
}

// ─── Evidence storage (private bucket, user JWT, RLS-enforced) ───
const BUCKET = "custody-evidence";
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // mirrors the bucket's server-side limit

export function newRecordId(): string {
  // Client-generated so upload paths can exist before the DB row (owner-first
  // storage RLS keys on auth.uid(), so this is safe).
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Path builders — MUST stay in sync with custody_path_ok() + storage policies. */
export function evidencePath(userId: string, recordId: string, phase: "before" | "after", key: string): string {
  return `${userId}/${recordId}/${phase}/${key}.jpg`;
}

async function storageFetch(path: string, init: RequestInit): Promise<Response> {
  const s = await getValidSession();
  if (!s) throw new Error("not_authenticated");
  const doFetch = (token: string) =>
    fetch(`${SUPABASE_URL}/storage/v1${path}`, {
      ...init,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  let res = await doFetch(s.access_token);
  if (res.status === 401) {
    const s2 = await getValidSession(); // refresh-if-expired
    if (s2) res = await doFetch(s2.access_token);
  }
  return res;
}

/** Upload one evidence photo. Client-side type/size guard mirrors the bucket limits. */
export async function uploadEvidence(path: string, file: File | Blob): Promise<Result<boolean>> {
  try {
    if (file.size > MAX_EVIDENCE_BYTES) return { ok: false, error: "file_too_large" };
    const type = (file as File).type || "image/jpeg";
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return { ok: false, error: "invalid_file_type" };
    const res = await storageFetch(`/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { "Content-Type": type, "x-upsert": "true" },
      body: file,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = (await res.json()) as { message?: string; error?: string }; msg = j.message || j.error || msg; } catch { /* non-JSON */ }
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/** Batch-sign evidence paths → map path → full signed URL (1h). Skips nulls. */
export async function signEvidence(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return {};
  try {
    const res = await storageFetch(`/object/sign/${BUCKET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600, paths: list }),
    });
    if (!res.ok) return {};
    const rows = (await res.json()) as { path?: string; signedURL?: string; error?: string | null }[];
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (r.path && r.signedURL) out[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`;
    }
    return out;
  } catch { return {}; }
}

// ─── Staged notification webhook (channel-ready; WhatsApp disabled in n8n) ───
// Fire-and-forget: never blocks or fails the business action.
export function emitCustodyEvent(event: {
  event: string; record_id: string; record_no?: string; kind?: RecordKind;
  party_name?: string; urgent?: boolean;
}): void {
  void (async () => {
    try {
      const s = await getValidSession();
      if (!s) return;
      await fetch("/api/integrations/custody/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ ...event, channels: ["portal", "email", "whatsapp"] }),
      });
    } catch { /* staged channel — portal notifications already written by the RPC */ }
  })();
}

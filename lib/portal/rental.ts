// ════════════════════════════════════════════════════════════════════════════
// Kian — Rental & Insurance Portal V1 — طبقة البيانات (أنواع + RPCs + قراءات)
// تعيد استخدام prpc/pget/enc من client.ts. الكتابة عبر RPCs محمية بالقاعدة فقط.
// جداول custody_rental_* (توسعة enterprise_05) + إعدادات/أحداث/رسوم/أدلة التأجير.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, pget, enc, type Result } from "@/lib/portal/client";
import { getValidSession, SUPABASE_URL, SUPABASE_KEY } from "@/lib/portalAuth";

// ─── الأنواع ───
export type RentalStatus =
  | "draft" | "pending_approval" | "rejected" | "approved" | "awaiting_customer_confirmation"
  | "contract_pending_signature" | "scheduled" | "preparing" | "ready_for_handover" | "active"
  | "return_requested" | "inspection_pending" | "charges_pending" | "closed" | "cancelled" | "overdue"
  // legacy (patch 05) — مقروءة للتوافق
  | "requested" | "reviewing" | "quoted" | "contracted" | "under_inspection";
export type DepositStatus =
  | "not_required" | "pending" | "received" | "held" | "partially_applied" | "fully_applied"
  | "release_pending" | "released" | "refunded" | "forfeited";
export type RentalItemStatus = "reserved" | "issued" | "return_requested" | "inspected" | "returned" | "damaged" | "missing";
export type RentalChargeType = "damage" | "missing_item" | "missing_accessory" | "late_return" | "misuse" | "cleaning" | "other";

export interface RentalCustomer {
  id: string; user_id: string | null; party_type: "individual" | "company"; full_name: string;
  company_name: string | null; phone: string | null; email: string | null; id_type: string | null;
  id_number_ref: string | null; tax_number: string | null; address: string | null; authorized_person: string | null; notes: string | null;
}
export interface RentalRequest {
  id: string; request_number: string; customer_id: string | null; status: RentalStatus;
  rental_from: string | null; rental_to: string | null; rate_type: string | null;
  subtotal: number; discount_total: number; additional_total: number; vat_rate: number; vat_amount: number; grand_total: number; currency: string;
  deposit_amount: number; deposit_status: DepositStatus; deposit_received: number; deposit_applied: number; deposit_released: number;
  actual_handover_at: string | null; actual_return_at: string | null;
  purpose: string | null; customer_note: string | null; internal_note: string | null; ready_for_zoho: boolean;
  created_at: string; updated_at: string;
}
export interface RentalItem {
  id: string; request_id: string; contract_id: string | null; asset_id: string; quantity: number; units_count: number;
  status: RentalItemStatus; condition_out: string | null; condition_in: string | null; rate: number; rate_unit: string | null;
  line_discount: number; line_total: number; serial_number: string | null; returned_qty: number;
}
export interface RentalEvent { id: string; request_id: string; from_status: string | null; to_status: string; actor_id: string | null; reason: string | null; created_at: string }
export interface RentalCharge {
  id: string; request_id: string; item_id: string | null; charge_type: RentalChargeType; description: string | null;
  estimate: number; approved_amount: number | null; status: "reported" | "approved" | "rejected" | "settled";
  from_deposit: number; additional_due: number; created_at: string;
}
export interface RentalAvailability {
  available: boolean; available_quantity: number; requested_quantity: number; total_quantity: number;
  free?: number; requested?: number; total?: number; committed?: number;
  rented_overlap?: number; reserved_overlap?: number; in_maintenance?: number;
  asset_type: string; availability_status?: string; reason: string;
  conflict_reason: string | null; conflicting_source: string | null; next_available_at: string | null;
}
export interface RentalPortalClient { profile_id: string; full_name: string | null; company: string | null; email: string | null; mobile: string | null; account_type: string; rental_customer_id: string | null }
export interface RentalClientSearch { total_count: number; limit?: number; offset?: number; rows: RentalPortalClient[] }
export interface RentalRentableAsset {
  asset_id: string; asset_code: string; asset_name: string; asset_type: string; serial_number: string | null;
  catalog_photo_path: string | null; photo_path: string | null; total_quantity: number;
  available_quantity: number; is_available: boolean; available: boolean; availability_reason: string | null; next_available_at: string | null;
}
// تطبيع دفاعي: يدعم أي اسم حقل قديم أثناء الانتقال (بما فيه `free` من النسخة الأساسية). لا undefined/NaN.
function normAvailQty(row: Record<string, unknown>): number {
  const v = row.available_quantity ?? row.available_qty ?? row.free_quantity ?? row.qty_available ?? row.free ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// ─── القراءات (RLS تحكم الصفوف) ───
const REQ_SEL = "id,request_number,customer_id,status,rental_from,rental_to,rate_type,subtotal,discount_total,additional_total,vat_rate,vat_amount,grand_total,currency,deposit_amount,deposit_status,deposit_received,deposit_applied,deposit_released,actual_handover_at,actual_return_at,purpose,customer_note,internal_note,ready_for_zoho,created_at,updated_at";

export function rentalListRequests(filter?: { status?: string; customer_id?: string }): Promise<Result<RentalRequest[]>> {
  let q = `custody_rental_requests?select=${REQ_SEL}&order=created_at.desc&limit=500`;
  if (filter?.status) q += `&status=eq.${enc(filter.status)}`;
  if (filter?.customer_id) q += `&customer_id=eq.${enc(filter.customer_id)}`;
  return pget<RentalRequest[]>(q);
}
export function rentalGetRequest(id: string): Promise<Result<RentalRequest[]>> {
  return pget<RentalRequest[]>(`custody_rental_requests?id=eq.${enc(id)}&select=${REQ_SEL}&limit=1`);
}
export function rentalListItems(requestId: string): Promise<Result<RentalItem[]>> {
  return pget<RentalItem[]>(`custody_rental_items?request_id=eq.${enc(requestId)}&select=id,request_id,contract_id,asset_id,quantity,units_count,status,condition_out,condition_in,rate,rate_unit,line_discount,line_total,serial_number,returned_qty&order=created_at.asc`);
}
export function rentalListEvents(requestId: string): Promise<Result<RentalEvent[]>> {
  return pget<RentalEvent[]>(`custody_rental_events?request_id=eq.${enc(requestId)}&select=id,request_id,from_status,to_status,actor_id,reason,created_at&order=created_at.desc`);
}
export function rentalListCharges(requestId: string): Promise<Result<RentalCharge[]>> {
  return pget<RentalCharge[]>(`custody_rental_charges?request_id=eq.${enc(requestId)}&select=id,request_id,item_id,charge_type,description,estimate,approved_amount,status,from_deposit,additional_due,created_at&order=created_at.desc`);
}
export function rentalListCustomers(q?: string): Promise<Result<RentalCustomer[]>> {
  let url = `custody_rental_customers?is_deleted=eq.false&select=id,user_id,party_type,full_name,company_name,phone,email,id_type,id_number_ref,tax_number,address,authorized_person,notes&order=full_name.asc&limit=500`;
  if (q) url += `&or=(full_name.ilike.*${enc(q)}*,company_name.ilike.*${enc(q)}*,phone.ilike.*${enc(q)}*)`;
  return pget<RentalCustomer[]>(url);
}

// ─── RPCs (كتابة محمية بالقاعدة) ───
export async function rentalAvailability(assetId: string, from: string, to: string, qty = 1): Promise<Result<RentalAvailability>> {
  const r = await prpc<Record<string, unknown>>("custody_rental_availability", { p_asset: assetId, p_from: from, p_to: to, p_qty: qty });
  if (!r.ok) return r;
  const d = r.data ?? {};
  const aq = normAvailQty(d);
  return { ok: true, data: {
    available: Boolean(d.available ?? aq >= qty), available_quantity: aq,
    requested_quantity: Number(d.requested_quantity ?? d.requested ?? qty) || qty,
    total_quantity: Number(d.total_quantity ?? d.total ?? 0) || 0,
    committed: Number(d.committed ?? 0) || 0, in_maintenance: Number(d.in_maintenance ?? 0) || 0,
    asset_type: String(d.asset_type ?? ""), availability_status: (d.availability_status as string) ?? undefined,
    reason: String(d.reason ?? ""), conflict_reason: (d.conflict_reason as string) ?? null,
    conflicting_source: (d.conflicting_source as string) ?? null, next_available_at: (d.next_available_at as string) ?? null,
  } };
}
export const rentalTransition = (requestId: string, to: RentalStatus, reason?: string) =>
  prpc<{ ok: boolean; from: string; to: string }>("custody_rental_transition", { p_request: requestId, p_to: to, p_reason: reason ?? null });
export const rentalUpsertRequest = (data: Record<string, unknown>) =>
  prpc<{ ok: boolean; id: string }>("custody_rental_admin_upsert_request", { p_data: data });
export const rentalAddItem = (requestId: string, assetId: string, qty = 1) =>
  prpc<{ ok: boolean }>("custody_rental_admin_add_item", { p_request: requestId, p_asset: assetId, p_qty: qty });
export const rentalRemoveItem = (itemId: string) => prpc<boolean>("custody_rental_admin_remove_item", { p_item: itemId });
export const rentalPrice = (requestId: string, data: Record<string, unknown>) =>
  prpc<{ ok: boolean }>("custody_rental_finance_price", { p_request: requestId, p_data: data });
export const rentalDeposit = (requestId: string, action: "receive" | "release" | "forfeit", amount: number, data?: Record<string, unknown>) =>
  prpc<{ ok: boolean }>("custody_rental_finance_deposit", { p_request: requestId, p_action: action, p_amount: amount, p_data: data ?? {} });

// قراءة المستأجر الآمنة (أعمدة العميل فقط — بلا ملاحظات/مراجع داخلية).
export interface RentalCustomerView {
  id: string; request_number: string; status: RentalStatus; rental_from: string | null; rental_to: string | null;
  subtotal: number; discount_total: number; additional_total: number; vat_rate: number; vat_amount: number; grand_total: number; currency: string;
  deposit_amount: number; deposit_status: DepositStatus; customer_note: string | null; created_at: string;
}
export const rentalCustomerList = () => prpc<RentalCustomerView[]>("custody_rental_customer_list", {});

// ─── Storage buckets (خاصة — signed URL فقط؛ منفصلة عن كتالوج الأصول) ───
export const RENTAL_EVIDENCE_BUCKET = "rental-evidence";
export const RENTAL_CONTRACTS_BUCKET = "rental-contracts";
export const RENTAL_PRIVATE_BUCKET = "rental-private-documents";
/** مسار دليل التأجير: rental/{rental_id}/{stage}/{item_id}/{uuid}.{ext} */
export function rentalEvidencePath(rentalId: string, stage: string, itemId: string, fileName: string): string {
  const ext = (fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
  const rid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  return `rental/${rentalId}/${stage}/${itemId}/${rid}.${ext}`;
}

// ─── دورة الحياة التشغيلية (RPCs) ───
export interface RentalContractInfo { contract_number: string; status: string; signed_at: string | null; contract_pdf_path: string | null; version?: number; snapshot?: unknown; contract_hash?: string | null }
export const rentalGenerateContract = (requestId: string) => prpc<{ ok: boolean; contract_id: string; contract_number: string; version: number }>("custody_rental_generate_contract", { p_request: requestId });
export const rentalSignContract = (contractId: string, signerName: string, signaturePath: string, ua?: string, consent?: string) =>
  prpc<{ ok: boolean; hash: string }>("custody_rental_sign_contract", { p_contract: contractId, p_signer_name: signerName, p_signature_path: signaturePath, p_ua: ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : null), p_consent: consent ?? null });
export const rentalStartHandover = (requestId: string) => prpc<{ ok: boolean }>("custody_rental_start_handover", { p_request: requestId });
export const rentalAddHandoverEvidence = (requestId: string, itemId: string, path: string, condition: string, note?: string) =>
  prpc<{ ok: boolean }>("custody_rental_add_handover_evidence", { p_request: requestId, p_item: itemId, p_path: path, p_condition: condition, p_note: note ?? null });
export const rentalCompleteHandover = (requestId: string, customerSig: string, staffSig: string) =>
  prpc<{ ok: boolean }>("custody_rental_complete_handover", { p_request: requestId, p_customer_sig: customerSig, p_staff_sig: staffSig });
export const rentalRequestReturn = (requestId: string, note?: string) => prpc<{ ok: boolean }>("custody_rental_request_return", { p_request: requestId, p_note: note ?? null });
export const rentalStartInspection = (requestId: string) => prpc<{ ok: boolean }>("custody_rental_start_inspection", { p_request: requestId });
export const rentalInspectItem = (itemId: string, result: string, conditionIn: string, returnedQty: number, note?: string) =>
  prpc<{ ok: boolean }>("custody_rental_inspect_item", { p_item: itemId, p_result: result, p_condition_in: conditionIn, p_returned_qty: returnedQty, p_note: note ?? null });
export const rentalCompleteReturn = (requestId: string) => prpc<{ ok: boolean }>("custody_rental_complete_return", { p_request: requestId });
export const rentalAddCharge = (requestId: string, itemId: string | null, type: RentalChargeType, desc: string, estimate: number) =>
  prpc<{ ok: boolean; id: string }>("custody_rental_add_charge", { p_request: requestId, p_item: itemId, p_type: type, p_desc: desc, p_estimate: estimate });
export const rentalApproveCharge = (chargeId: string, approved: number, fromDeposit = 0, additional = 0, reject = false) =>
  prpc<{ ok: boolean; status: string; from_deposit?: number; additional_due?: number; invoice_id?: string | null }>("custody_rental_approve_charge", { p_charge: chargeId, p_approved: approved, p_from_deposit: fromDeposit, p_additional: additional, p_reject: reject });
export const rentalChargeObjection = (chargeId: string, objection: string) => prpc<{ ok: boolean }>("custody_rental_charge_objection", { p_charge: chargeId, p_objection: objection });
export interface RentalDamageInvoice { invoice_number: string; status: string; currency: string; subtotal: number; vat: number; total: number; pdf_url: string | null; description: string | null; created_at: string }
export const rentalCustomerInvoices = (requestId: string) => prpc<RentalDamageInvoice[]>("custody_rental_customer_invoices", { p_request: requestId });
export const rentalClose = (requestId: string) => prpc<{ ok: boolean }>("custody_rental_close", { p_request: requestId });
export const rentalCancel = (requestId: string, reason: string) => prpc<{ ok: boolean }>("custody_rental_cancel", { p_request: requestId, p_reason: reason });
export const rentalMarkOverdue = () => prpc<{ ok: boolean; marked: number }>("custody_rental_mark_overdue", {});
export const rentalCustomerGet = (requestId: string) => prpc<Record<string, unknown>>("custody_rental_customer_get", { p_request: requestId });

// ─── HOTFIX: إرسال/اعتماد/رفض/تعديل + ربط عميل البوابة + طلب ذاتي + دليل عام ───
export const rentalSubmit = (requestId: string) => prpc<{ ok: boolean; status: string }>("custody_rental_submit", { p_request: requestId });
export const rentalApprove = (requestId: string, message?: string) => prpc<{ ok: boolean; status: string }>("custody_rental_approve", { p_request: requestId, p_message: message ?? null });
export const rentalReject = (requestId: string, reason: string) => prpc<{ ok: boolean; status: string }>("custody_rental_reject", { p_request: requestId, p_reason: reason });
export const rentalRequestRevision = (requestId: string, note: string) => prpc<{ ok: boolean; status: string }>("custody_rental_request_revision", { p_request: requestId, p_note: note });
export async function rentalSearchClients(q?: string, limit = 20, offset = 0): Promise<Result<RentalClientSearch>> {
  const r = await prpc<unknown>("custody_rental_admin_search_clients", { p_q: q ?? "", p_limit: limit, p_offset: offset });
  if (!r.ok) return r;
  const d = r.data;
  if (Array.isArray(d)) return { ok: true, data: { total_count: d.length, rows: d as RentalPortalClient[] } };
  const o = (d ?? {}) as { total_count?: number; limit?: number; offset?: number; rows?: RentalPortalClient[] };
  return { ok: true, data: { total_count: Number(o.total_count ?? (o.rows?.length ?? 0)) || 0, limit: o.limit, offset: o.offset, rows: o.rows ?? [] } };
}
export interface RentalLinkedClient { rental_customer_id: string; profile_id: string; full_name: string | null; company: string | null; email: string | null; mobile: string | null; account_type: string }
// التوقيع القانوني: p_profile_id uuid. يطبّع الرد (Object/Array/row/data) ويشترط rental_customer_id.
export async function rentalLinkPortalClient(profileId: string): Promise<Result<RentalLinkedClient>> {
  const r = await prpc<unknown>("custody_rental_admin_link_portal_client", { p_profile_id: profileId });
  if (!r.ok) return r;
  const d = r.data as Record<string, unknown> | unknown[] | null;
  const rowU = Array.isArray(d) ? d[0] : ((d as Record<string, unknown>)?.row ?? (d as Record<string, unknown>)?.data ?? d);
  const row = (rowU ?? {}) as Record<string, unknown>;
  const rcid = row.rental_customer_id ?? row.customer_id; // دعم اسم قديم أثناء الانتقال
  if (!rcid) return { ok: false, error: "link_no_id" };
  return { ok: true, data: {
    rental_customer_id: String(rcid), profile_id: String(row.profile_id ?? profileId),
    full_name: (row.full_name as string) ?? null, company: (row.company as string) ?? null,
    email: (row.email as string) ?? null, mobile: ((row.mobile as string) ?? (row.phone as string)) ?? null,
    account_type: String(row.account_type ?? ""),
  } };
}
export interface RentalCreatedItem { item_id: string; asset_id: string; quantity: number }
export const rentalCustomerCreateRequest = (data: Record<string, unknown>) => prpc<{ ok: boolean; id: string; request_number: string; status: string; items: RentalCreatedItem[] }>("custody_rental_customer_create_request", { p_data: data });
export const rentalCustomerAddItem = (requestId: string, assetId: string, qty = 1) => prpc<{ ok: boolean }>("custody_rental_customer_add_item", { p_request: requestId, p_asset: assetId, p_qty: qty });
export const rentalCustomerSubmit = (requestId: string, consentPath?: string, consentText?: string) =>
  prpc<{ ok: boolean; status: string }>("custody_rental_customer_submit", { p_request: requestId, p_consent_signature_path: consentPath ?? null, p_consent_text: consentText ?? null });
// إقرار/عقد + دليل الإنشاء + بحث بالباركود (بوابة المستأجر)
export const rentalConsentText = () => prpc<{ consent_text: string; version: number; currency: string }>("custody_rental_consent_text", {});
export const rentalCustomerAddRequestEvidence = (requestId: string, itemId: string | null, path: string) =>
  prpc<{ ok: boolean }>("custody_rental_customer_add_request_evidence", { p_request: requestId, p_item: itemId, p_path: path });
export const rentalCustomerLookupAsset = (code: string, from: string, to: string) =>
  prpc<{ found: boolean; asset_id?: string; asset_code?: string; asset_name?: string; asset_type?: string; serial_number?: string | null; total_quantity?: number; available_quantity?: number; is_available?: boolean; catalog_photo_path?: string | null }>("custody_rental_customer_lookup_asset", { p_code: code, p_from: from, p_to: to });
export async function rentalCustomerAvailableAssets(from: string, to: string, q?: string): Promise<Result<RentalRentableAsset[]>> {
  const r = await prpc<Record<string, unknown>[]>("custody_rental_customer_available_assets", { p_from: from, p_to: to, p_q: q ?? "" });
  if (!r.ok) return r;
  const rows = (Array.isArray(r.data) ? r.data : []).map((row) => {
    const aq = normAvailQty(row);
    const isAvail = Boolean(row.is_available ?? row.available ?? aq > 0);
    const photo = (row.catalog_photo_path ?? row.photo_path ?? null) as string | null;
    return {
      asset_id: String(row.asset_id ?? ""), asset_code: String(row.asset_code ?? ""), asset_name: String(row.asset_name ?? ""),
      asset_type: String(row.asset_type ?? ""), serial_number: (row.serial_number as string) ?? null,
      catalog_photo_path: photo, photo_path: photo, total_quantity: Number(row.total_quantity ?? 0) || 0,
      available_quantity: aq, is_available: isAvail, available: isAvail,
      availability_reason: (row.availability_reason as string) ?? null, next_available_at: (row.next_available_at as string) ?? null,
    } as RentalRentableAsset;
  });
  return { ok: true, data: rows };
}
export const rentalAddEvidence = (requestId: string, itemId: string | null, stage: "handover" | "return_inspection" | "return_request", path: string, condition?: string, note?: string) =>
  prpc<{ ok: boolean }>("custody_rental_add_evidence", { p_request: requestId, p_item: itemId, p_stage: stage, p_path: path, p_condition: condition ?? null, p_note: note ?? null });

// مسارات أدلة منظّمة (bucket rental-evidence حصرًا — لا كتالوج الأصول ولا hr-files).
function evUuidExt(fileName: string): { rid: string; ext: string } {
  const ext = (fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
  const rid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  return { rid, ext };
}
/** rental/{rid}/{phase}/items/{itemId}/{uuid}.{ext} */
export function rentalItemEvidencePath(rentalId: string, phase: "handover" | "return" | "request", itemId: string, fileName: string): string {
  const { rid, ext } = evUuidExt(fileName);
  return `rental/${rentalId}/${phase}/items/${itemId}/${rid}.${ext}`;
}
/** rental/{rid}/{phase}/overall/{uuid}.{ext} */
export function rentalOverallEvidencePath(rentalId: string, phase: "handover" | "return" | "request", fileName: string): string {
  const { rid, ext } = evUuidExt(fileName);
  return `rental/${rentalId}/${phase}/overall/${rid}.${ext}`;
}

// إطلاق إشعار بريد التأجير بعد إجراء ناجح (best-effort — لا يكسر الإجراء). القناة نفسها للعهدة.
export function emitRentalEvent(event: string, requestId: string): void {
  void (async () => {
    try {
      const s = await getValidSession();
      if (!s) return;
      await fetch("/api/integrations/rental/notify", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ event, request_id: requestId }),
      });
    } catch { /* فشل البريد لا يكسر الإجراء — Vercel logs تحمل السبب */ }
  })();
}

export interface RentalDashboard { new: number; pending_approval: number; pending_signature: number; handover_today: number; return_today: number; active: number; overdue: number; open_charges: number; deposits_held: number; deposits_release_pending: number }
export const rentalDashboard = () => prpc<RentalDashboard>("custody_rental_dashboard", {});
export const rentalGet = (requestId: string) => prpc<Record<string, unknown>>("custody_rental_get", { p_request: requestId });
export const rentalCalendar = (from: string, to: string) => prpc<Array<{ id: string; request_number: string; status: RentalStatus; from: string; to: string; customer: string | null }>>("custody_rental_calendar", { p_from: from, p_to: to });

// ─── التخزين: رفع/توقيع أدلة التأجير (bucket خاص — signed URL فقط) ───
const MAX_RENTAL_BYTES = 10 * 1024 * 1024;
async function rentalStorageFetch(path: string, init: RequestInit): Promise<Response> {
  const s = await getValidSession();
  if (!s) throw new Error("not_authenticated");
  const doFetch = (tok: string) => fetch(`${SUPABASE_URL}/storage/v1${path}`, { ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}`, ...(init.headers || {}) } });
  let res = await doFetch(s.access_token);
  if (res.status === 401) { const s2 = await getValidSession(); if (s2) res = await doFetch(s2.access_token); }
  return res;
}
/** رفع دليل تأجير إلى bucket خاص. يعيد المسار عند النجاح. */
export async function rentalUpload(bucket: string, path: string, file: File): Promise<Result<string>> {
  if (file.size > MAX_RENTAL_BYTES) return { ok: false, error: "الملف أكبر من 10MB" };
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") return { ok: false, error: "نوع ملف غير مسموح" };
  try {
    const res = await rentalStorageFetch(`/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "POST", headers: { "x-upsert": "true", "Content-Type": file.type }, body: file });
    if (!res.ok) return { ok: false, error: `upload_failed_${res.status}`, status: res.status };
    return { ok: true, data: path };
  } catch (e) { return { ok: false, error: String(e) }; }
}
export async function rentalSignFiles(bucket: string, paths: string[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(paths.filter(Boolean)));
  if (uniq.length === 0) return {};
  try {
    const res = await rentalStorageFetch(`/object/sign/${bucket}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600, paths: uniq }) });
    if (!res.ok) return {};
    const arr = (await res.json()) as { path?: string; signedURL?: string }[];
    const out: Record<string, string> = {};
    for (const r of arr) if (r.path && r.signedURL) out[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`;
    return out;
  } catch { return {}; }
}
/** رفع توقيع الإقرار (dataURL → PNG) إلى bucket الأدلة (المستأجر يكتبه — write-only). */
export async function rentalUploadConsentSignature(rentalId: string, dataUrl: string): Promise<Result<string>> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], "consent.png", { type: "image/png" });
    const rid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    return rentalUpload(RENTAL_EVIDENCE_BUCKET, `rental/${rentalId}/consent/${rid}.png`, file);
  } catch (e) { return { ok: false, error: String(e) }; }
}
/** رفع صورة توقيع (dataURL → PNG) إلى bucket العقود، وإرجاع المسار. */
export async function rentalUploadSignature(rentalId: string, who: "customer" | "staff", dataUrl: string): Promise<Result<string>> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `${who}.png`, { type: "image/png" });
    const path = `rental/${rentalId}/signatures/${who}_${(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now())}.png`;
    return rentalUpload(RENTAL_CONTRACTS_BUCKET, path, file);
  } catch (e) { return { ok: false, error: String(e) }; }
}

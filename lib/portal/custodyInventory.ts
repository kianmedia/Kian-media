// ════════════════════════════════════════════════════════════════════════
// Kian — Custody Inventory System v1 (نظام مخزون الأصول والعهد المسجلة)
// طبقة البيانات: أنواع + قراءات (RLS عبر PostgREST) + استدعاءات RPC + رفع/توقيع
// الملفات في bucketين خاصّين. منفصلة تمامًا عن lib/portal/custody.ts القديم.
// كل الكتابة عبر RPCs محمية بالقاعدة؛ الواجهة تنسّق فقط.
// ════════════════════════════════════════════════════════════════════════
import { prpc, pget, enc, type Result } from "@/lib/portal/client";
import { getValidSession, SUPABASE_URL, SUPABASE_KEY } from "@/lib/portalAuth";

// ─── الأنواع ───
export type CivAssetType = "serialized" | "quantity_based";
export type CivCondition = "new" | "excellent" | "good" | "fair" | "damaged" | "under_maintenance" | "lost" | "retired";
export type CivAvailability = "available" | "partially_assigned" | "assigned" | "reserved" | "maintenance" | "lost" | "retired";
export type CivAssignmentStatus = "draft" | "pending_employee_confirmation" | "active" | "return_requested" | "under_inspection" | "partially_returned" | "returned" | "rejected" | "disputed" | "cancelled";
export type CivItemStatus = "pending" | "active" | "return_requested" | "inspected" | "returned" | "damaged" | "missing" | "disputed";
export type CivEvidenceStage = "issue_admin" | "issue_employee" | "return_employee" | "return_inspection" | "damage" | "maintenance";
export type CivInspectResult = "accepted_good" | "accepted_damaged" | "maintenance_required" | "missing" | "rejected_return" | "partial_return";

export interface CivSettings { legacy_custody_employee_visible: boolean; show_purchase_value_to_employee: boolean }
export const DEFAULT_CIV_SETTINGS: CivSettings = { legacy_custody_employee_visible: true, show_purchase_value_to_employee: false };

export interface CivCategory { id: string; name: string; sort_order: number }
export interface CivLocation { id: string; name: string; location_type: string; city: string | null; address: string | null; is_active: boolean }
export interface CivAsset {
  id: string; asset_code: string; barcode: string | null; qr_code_value: string | null; asset_name: string;
  category_id: string | null; brand: string | null; model: string | null; serial_number: string | null; description: string | null;
  ownership_type: string; asset_type: CivAssetType; quantity_total: number; quantity_available: number; unit: string;
  purchase_date: string | null; purchase_price: number | null; current_value: number | null; supplier_name: string | null;
  invoice_number: string | null; warranty_expiry_date: string | null; condition_status: CivCondition; availability_status: CivAvailability;
  warehouse_location_id: string | null; storage_location_text: string | null; notes: string | null; minimum_stock_level: number | null;
  created_at: string; updated_at: string;
}
export interface CivAssetFile { id: string; asset_id: string; file_type: string; file_path: string; file_name: string | null; mime_type: string | null; description: string | null; created_at: string }
export interface CivAssignment {
  id: string; assignment_number: string; employee_user_id: string; employee_id: string | null; assignment_type: string;
  purpose: string | null; expected_return_at: string | null; issued_at: string; employee_confirmed_at: string | null;
  status: CivAssignmentStatus; employee_note: string | null; custodian_note: string | null; ack_snapshot: string | null; ack_name: string | null;
}
export interface CivAssignmentItem {
  id: string; assignment_id: string; asset_id: string; quantity: number; quantity_returned: number;
  condition_at_issue: string | null; issue_notes: string | null; condition_at_return: string | null; return_notes: string | null; status: CivItemStatus;
  asset_name?: string; asset_code?: string;
}
export interface CivEvidence { id: string; assignment_id: string | null; assignment_item_id: string | null; asset_id: string | null; evidence_stage: CivEvidenceStage; file_path: string; file_name: string | null; note: string | null; created_at: string }
export interface CivMovement { id: string; asset_id: string; movement_type: string; quantity_before: number | null; quantity_change: number | null; quantity_after: number | null; reason: string | null; created_at: string }
export interface CivMaintenance { id: string; maintenance_number: string; asset_id: string; maintenance_type: string; status: string; issue_description: string | null; provider_name: string | null; sent_at: string | null; expected_return_at: string | null; returned_at: string | null; cost: number | null }
export interface CivReservation { id: string; asset_id: string; quantity: number; status: string; reserved_from: string | null; reserved_to: string | null; note: string | null }
export interface CivAudit { id: string; audit_number: string; location_id: string | null; status: string; started_at: string | null; approved_at: string | null; notes: string | null }
export interface CivAuditItem { id: string; audit_id: string; asset_id: string; expected_quantity: number | null; counted_quantity: number | null; variance: number | null; condition_found: string | null }
export interface CivDashboard {
  total_assets: number; total_value: number; available: number; assigned: number; reserved: number; maintenance: number;
  damaged: number; lost: number; active_assignments: number; overdue: number; pending_returns: number; pending_confirm: number;
  warranty_soon: number; audit_variances: number;
}

// ─── القراءات (RLS تحكم الصفوف) ───
const SEL_ASSET = "id,asset_code,barcode,qr_code_value,asset_name,category_id,brand,model,serial_number,description,ownership_type,asset_type,quantity_total,quantity_available,unit,purchase_date,purchase_price,current_value,supplier_name,invoice_number,warranty_expiry_date,condition_status,availability_status,warehouse_location_id,storage_location_text,notes,minimum_stock_level,created_at,updated_at";

export function civListAssets(filter?: { category_id?: string; location_id?: string; availability_status?: string; q?: string }): Promise<Result<CivAsset[]>> {
  let q = `custody_inventory_assets?is_deleted=eq.false&select=${SEL_ASSET}&order=asset_name.asc&limit=1000`;
  if (filter?.category_id) q += `&category_id=eq.${enc(filter.category_id)}`;
  if (filter?.location_id) q += `&warehouse_location_id=eq.${enc(filter.location_id)}`;
  if (filter?.availability_status) q += `&availability_status=eq.${enc(filter.availability_status)}`;
  if (filter?.q) q += `&or=(asset_name.ilike.*${enc(filter.q)}*,asset_code.ilike.*${enc(filter.q)}*,barcode.ilike.*${enc(filter.q)}*,serial_number.ilike.*${enc(filter.q)}*)`;
  return pget<CivAsset[]>(q);
}
export function civGetAsset(id: string): Promise<Result<CivAsset[]>> {
  return pget<CivAsset[]>(`custody_inventory_assets?id=eq.${enc(id)}&select=${SEL_ASSET}&limit=1`);
}
export function civListCategories(): Promise<Result<CivCategory[]>> {
  return pget<CivCategory[]>(`custody_inventory_categories?is_deleted=eq.false&select=id,name,sort_order&order=sort_order.asc,name.asc`);
}
export function civListLocations(): Promise<Result<CivLocation[]>> {
  return pget<CivLocation[]>(`custody_inventory_locations?is_deleted=eq.false&select=id,name,location_type,city,address,is_active&order=name.asc`);
}
export function civListAssetFiles(assetId: string): Promise<Result<CivAssetFile[]>> {
  return pget<CivAssetFile[]>(`custody_inventory_asset_files?asset_id=eq.${enc(assetId)}&is_deleted=eq.false&select=id,asset_id,file_type,file_path,file_name,mime_type,description,created_at&order=created_at.desc`);
}
export function civListAssignments(filter?: { status?: string; employee_user_id?: string }): Promise<Result<CivAssignment[]>> {
  let q = `custody_inventory_assignments?is_deleted=eq.false&select=id,assignment_number,employee_user_id,employee_id,assignment_type,purpose,expected_return_at,issued_at,employee_confirmed_at,status,employee_note,custodian_note,ack_snapshot,ack_name&order=issued_at.desc&limit=500`;
  if (filter?.status) q += `&status=eq.${enc(filter.status)}`;
  if (filter?.employee_user_id) q += `&employee_user_id=eq.${enc(filter.employee_user_id)}`;
  return pget<CivAssignment[]>(q);
}
export async function civListAssignmentItems(assignmentId: string): Promise<Result<CivAssignmentItem[]>> {
  // نضمّن اسم/كود الأصل عبر resource embedding (FK asset_id) ثم نُسطّحه.
  const r = await pget<(CivAssignmentItem & { asset?: { asset_name: string; asset_code: string } | null })[]>(
    `custody_inventory_assignment_items?assignment_id=eq.${enc(assignmentId)}&select=id,assignment_id,asset_id,quantity,quantity_returned,condition_at_issue,issue_notes,condition_at_return,return_notes,status,asset:custody_inventory_assets(asset_name,asset_code)&order=created_at.asc`);
  if (!r.ok) return r;
  return { ok: true, data: r.data.map((i) => ({ ...i, asset_name: i.asset?.asset_name, asset_code: i.asset?.asset_code })) };
}
export function civListEvidence(assignmentId: string): Promise<Result<CivEvidence[]>> {
  return pget<CivEvidence[]>(`custody_inventory_evidence?assignment_id=eq.${enc(assignmentId)}&is_deleted=eq.false&select=id,assignment_id,assignment_item_id,asset_id,evidence_stage,file_path,file_name,note,created_at&order=created_at.asc`);
}
export function civListMaintenance(status?: string): Promise<Result<CivMaintenance[]>> {
  let q = `custody_inventory_maintenance?select=id,maintenance_number,asset_id,maintenance_type,status,issue_description,provider_name,sent_at,expected_return_at,returned_at,cost&order=created_at.desc&limit=500`;
  if (status) q += `&status=eq.${enc(status)}`;
  return pget<CivMaintenance[]>(q);
}
export function civListReservations(): Promise<Result<CivReservation[]>> {
  return pget<CivReservation[]>(`custody_inventory_reservations?status=eq.active&select=id,asset_id,quantity,status,reserved_from,reserved_to,note&order=reserved_from.asc.nullslast`);
}
export function civListAudits(): Promise<Result<CivAudit[]>> {
  return pget<CivAudit[]>(`custody_inventory_audits?select=id,audit_number,location_id,status,started_at,approved_at,notes&order=created_at.desc&limit=200`);
}
export function civListAuditItems(auditId: string): Promise<Result<CivAuditItem[]>> {
  return pget<CivAuditItem[]>(`custody_inventory_audit_items?audit_id=eq.${enc(auditId)}&select=id,audit_id,asset_id,expected_quantity,counted_quantity,variance,condition_found&order=created_at.asc`);
}

// ─── RPCs ───
export const civGetSettings = () => prpc<CivSettings>("custody_inv_get_settings", {});
export const civUpdateSettings = (patch: Partial<CivSettings>) => prpc<CivSettings>("custody_inv_admin_update_settings", { p_patch: patch });

export const civUpsertCategory = (id: string | null, name: string, sort: number) => prpc<string>("custody_inv_admin_upsert_category", { p_id: id, p_name: name, p_sort: sort });
export const civArchiveCategory = (id: string, reason: string) => prpc<boolean>("custody_inv_admin_archive_category", { p_id: id, p_reason: reason });
export const civUpsertLocation = (v: { id?: string | null; name: string; type: string; city?: string; address?: string; responsible?: string | null; notes?: string; active?: boolean }) =>
  prpc<string>("custody_inv_admin_upsert_location", { p_id: v.id ?? null, p_name: v.name, p_type: v.type, p_city: v.city ?? null, p_address: v.address ?? null, p_responsible: v.responsible ?? null, p_notes: v.notes ?? null, p_active: v.active ?? true });
export const civArchiveLocation = (id: string, reason: string) => prpc<boolean>("custody_inv_admin_archive_location", { p_id: id, p_reason: reason });

export interface CivAssetInput {
  asset_name: string; asset_code?: string; barcode?: string; qr_code_value?: string; category_id?: string | null;
  brand?: string; model?: string; serial_number?: string; description?: string; ownership_type?: string;
  asset_type?: CivAssetType; quantity_total?: number; unit?: string; purchase_date?: string; purchase_price?: number;
  current_value?: number; supplier_name?: string; invoice_number?: string; warranty_expiry_date?: string;
  condition_status?: CivCondition; warehouse_location_id?: string | null; storage_location_text?: string; notes?: string; minimum_stock_level?: number;
}
export const civCreateAsset = (data: CivAssetInput) => prpc<{ ok: boolean; id: string; asset_code: string }>("custody_inv_admin_create_asset", { p_data: data });
export const civUpdateAsset = (id: string, data: Partial<CivAssetInput>) => prpc<boolean>("custody_inv_admin_update_asset", { p_id: id, p_data: data });
export const civArchiveAsset = (id: string, reason: string) => prpc<boolean>("custody_inv_admin_archive_asset", { p_id: id, p_reason: reason });

export const civAttachAssetFile = (assetId: string, type: string, path: string, name: string, mime: string, size: number, desc?: string) =>
  prpc<string>("custody_inv_attach_asset_file", { p_asset: assetId, p_type: type, p_path: path, p_name: name, p_mime: mime, p_size: size, p_desc: desc ?? null });
export const civAttachEvidence = (v: { assignment_id: string; assignment_item_id?: string | null; stage: CivEvidenceStage; path: string; name: string; mime: string; size: number; note?: string }) =>
  prpc<string>("custody_inv_attach_evidence", { p_assignment: v.assignment_id, p_item: v.assignment_item_id ?? null, p_stage: v.stage, p_path: v.path, p_name: v.name, p_mime: v.mime, p_size: v.size, p_note: v.note ?? null });

export interface CivIssueItem { asset_id: string; quantity?: number; condition_at_issue?: string; issue_notes?: string }
export const civCreateAssignment = (v: { employee_user_id: string; assignment_type?: string; purpose?: string; expected_return_at?: string | null; project_id?: string; field_task_id?: string; items: CivIssueItem[] }) =>
  prpc<{ ok: boolean; id: string; assignment_number: string; items: number }>("custody_inv_admin_create_assignment", { p_data: v });
export const civEmployeeConfirm = (assignmentId: string, ack: string, ackName: string, note?: string) =>
  prpc<boolean>("custody_inv_employee_confirm_assignment", { p_assignment: assignmentId, p_ack: ack, p_ack_name: ackName, p_note: note ?? null });
export interface CivReturnItem { assignment_item_id: string; quantity?: number; condition?: string; note?: string }
export const civRequestReturn = (assignmentId: string, items: CivReturnItem[], note?: string) =>
  prpc<boolean>("custody_inv_employee_request_return", { p_assignment: assignmentId, p_items: items, p_note: note ?? null });
export interface CivInspectItem { assignment_item_id: string; result: CivInspectResult; quantity?: number; note?: string; to_location_id?: string; damage_value?: number }
export const civInspectReturn = (assignmentId: string, items: CivInspectItem[]) =>
  prpc<{ ok: boolean; accepted: number; other: number; assignment_closed: boolean }>("custody_inv_admin_inspect_return", { p_assignment: assignmentId, p_items: items });

export const civAdjustStock = (assetId: string, newTotal: number | null, newAvailable: number | null, reason: string) =>
  prpc<boolean>("custody_inv_admin_adjust_stock", { p_asset: assetId, p_new_total: newTotal, p_new_available: newAvailable, p_reason: reason });
export const civTransferAsset = (assetId: string, toLocation: string | null, reason: string) =>
  prpc<boolean>("custody_inv_admin_transfer_asset", { p_asset: assetId, p_to_location: toLocation, p_reason: reason });

export const civOpenMaintenance = (v: { asset_id: string; quantity?: number; type?: string; desc?: string; provider?: string; expected?: string | null }) =>
  prpc<{ ok: boolean; id: string; maintenance_number: string }>("custody_inv_admin_open_maintenance", { p_asset: v.asset_id, p_qty: v.quantity ?? 1, p_type: v.type ?? "repair", p_desc: v.desc ?? null, p_provider: v.provider ?? null, p_expected: v.expected ?? null });
export const civCloseMaintenance = (id: string, result: string, returnCondition: string, cost: number | null, note?: string) =>
  prpc<boolean>("custody_inv_admin_close_maintenance", { p_id: id, p_result: result, p_return_condition: returnCondition, p_cost: cost, p_note: note ?? null });

export const civCreateReservation = (v: { asset_id: string; quantity?: number; employee_id?: string; project_id?: string; field_task_id?: string; from?: string; to?: string; note?: string }) =>
  prpc<string>("custody_inv_admin_create_reservation", { p_asset: v.asset_id, p_qty: v.quantity ?? 1, p_employee: v.employee_id ?? null, p_project: v.project_id ?? null, p_task: v.field_task_id ?? null, p_from: v.from ?? null, p_to: v.to ?? null, p_note: v.note ?? null });
export const civCancelReservation = (id: string, reason: string) => prpc<boolean>("custody_inv_admin_cancel_reservation", { p_id: id, p_reason: reason });

export const civStartAudit = (locationId: string | null, notes?: string) => prpc<{ ok: boolean; id: string; audit_number: string }>("custody_inv_admin_start_audit", { p_location: locationId, p_notes: notes ?? null });
export const civCountAuditItem = (v: { audit_id: string; asset_id: string; counted: number; actual_location?: string | null; condition?: string; note?: string }) =>
  prpc<boolean>("custody_inv_admin_count_audit_item", { p_audit: v.audit_id, p_asset: v.asset_id, p_counted: v.counted, p_actual_location: v.actual_location ?? null, p_condition: v.condition ?? null, p_note: v.note ?? null });
export const civApproveAudit = (id: string) => prpc<{ ok: boolean; variances_applied: number }>("custody_inv_admin_approve_audit", { p_audit: id });

export type CivMyAssignment = CivAssignment & { items?: CivAssignmentItem[] };
export const civGetMyAssignments = () => prpc<CivMyAssignment[]>("custody_inv_get_my_assignments", {});
export const civGetAssetTimeline = (assetId: string) => prpc<{ movements: CivMovement[]; maintenance: CivMaintenance[]; stats: { times_issued: number } }>("custody_inv_get_asset_timeline", { p_asset: assetId });
export const civGetDashboard = () => prpc<CivDashboard>("custody_inv_admin_get_dashboard", {});
export const civGetReport = <T = unknown>(kind: string, filters?: Record<string, unknown>) => prpc<T>("custody_inv_admin_get_report", { p_kind: kind, p_filters: filters ?? {} });

// ─── بريد الأطراف (best-effort — يُستدعى بعد نجاح الـ RPC؛ فشله لا يفشّل الحركة) ───
export async function civEmitEvent(event: string, opts?: { assignment_id?: string; title?: string }): Promise<void> {
  try {
    const s = await getValidSession();
    if (!s) return;
    await fetch("/api/integrations/custody-inventory/notify", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ event, assignment_id: opts?.assignment_id, title: opts?.title }),
    });
  } catch { /* البريد best-effort — لا يكسر تدفق الواجهة */ }
}

// ─── Storage (bucketان خاصّان — signed URL فقط) ───
export const CIV_ASSETS_BUCKET = "custody-inventory-assets";
export const CIV_EVIDENCE_BUCKET = "custody-inventory-evidence";
export const MAX_CIV_FILE_BYTES = 10 * 1024 * 1024;
const IMG = ["image/jpeg", "image/png", "image/webp"];
const IMG_PDF = [...IMG, "application/pdf"];
const safeName = (n: string) => n.replace(/[^\w.\-]+/g, "_").slice(-80);

async function storageFetch(path: string, init: RequestInit): Promise<Response> {
  const s = await getValidSession();
  if (!s) throw new Error("not_authenticated");
  const doFetch = (token: string) => fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  let res = await doFetch(s.access_token);
  if (res.status === 401) { const s2 = await getValidSession(); if (s2) res = await doFetch(s2.access_token); }
  return res;
}

/** مسار دليل العهدة: يبدأ بـ user_id صاحب العهدة (سياسة foldername) — لذا يقرؤه الموظف. */
export function civEvidencePath(employeeUserId: string, assignmentId: string, stage: string, fileName: string): string {
  return `${employeeUserId}/${assignmentId}/${stage}/${Date.now()}_${safeName(fileName)}`;
}
export function civAssetFilePath(assetId: string, fileType: string, fileName: string): string {
  return `${assetId}/${fileType}/${Date.now()}_${safeName(fileName)}`;
}

async function uploadTo(bucket: string, path: string, file: File, allowed: string[]): Promise<Result<boolean>> {
  if (file.size > MAX_CIV_FILE_BYTES) return { ok: false, error: "الملف أكبر من 10MB" };
  if (!allowed.includes(file.type)) return { ok: false, error: "نوع ملف غير مسموح" };
  try {
    const res = await storageFetch(`/object/${bucket}/${path}`, { method: "POST", headers: { "x-upsert": "true", "Content-Type": file.type }, body: file });
    if (!res.ok) return { ok: false, error: `upload_failed_${res.status}`, status: res.status };
    return { ok: true, data: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}
export const civUploadEvidence = (path: string, file: File) => uploadTo(CIV_EVIDENCE_BUCKET, path, file, IMG);
export const civUploadAssetFile = (path: string, file: File) => uploadTo(CIV_ASSETS_BUCKET, path, file, IMG_PDF);

/** توقيع مسارات لعرضها (روابط مؤقتة). bucket = CIV_ASSETS_BUCKET أو CIV_EVIDENCE_BUCKET. */
export async function civSignFiles(bucket: string, paths: string[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(paths.filter(Boolean)));
  if (uniq.length === 0) return {};
  try {
    const res = await storageFetch(`/object/sign/${bucket}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600, paths: uniq }) });
    if (!res.ok) return {};
    const arr = (await res.json()) as { path?: string; signedURL?: string }[];
    const out: Record<string, string> = {};
    for (const r of arr) if (r.path && r.signedURL) out[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`;
    return out;
  } catch { return {}; }
}

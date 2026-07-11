// ════════════════════════════════════════════════════════════════════════
// Kian — Custody Enterprise Suite: طبقة بيانات موحّدة لمزايا المنصّة المؤسسية.
// أغلفة RPC (أسماء الوسائط مطابقة لتواقيع SQL) + قراءات RLS. كل الكتابة عبر RPCs.
// يُبنى فوق lib/portal/custodyInventory.ts (يعيد استخدام civSignFiles/الرفع/المسارات).
// ════════════════════════════════════════════════════════════════════════
import { prpc, pget, enc, type Result } from "@/lib/portal/client";

// ─── Feature flags ───
export interface CustodyFlags {
  qr_scanning_enabled: boolean; barcode_enabled: boolean; custody_kits_enabled: boolean; asset_components_enabled: boolean;
  project_linking_enabled: boolean; employee_signature_enabled: boolean; detailed_conditions_enabled: boolean;
  overdue_alerts_enabled: boolean; incident_reporting_enabled: boolean; purchase_requests_enabled: boolean;
  maintenance_vendor_billing_enabled: boolean; gps_sessions_enabled: boolean; external_trackers_enabled: boolean;
  client_rental_portal_enabled: boolean; depreciation_enabled: boolean; zoho_asset_sync_enabled: boolean;
  insurance_claims_enabled: boolean; custody_offline_enabled: boolean; custody_mobile_app_enabled: boolean;
  overdue_escalation_hours: number; gps_retention_days: number; ack_version: number;
}
export const DEFAULT_CUSTODY_FLAGS: CustodyFlags = {
  qr_scanning_enabled: true, barcode_enabled: true, custody_kits_enabled: true, asset_components_enabled: true,
  project_linking_enabled: true, employee_signature_enabled: true, detailed_conditions_enabled: true,
  overdue_alerts_enabled: true, incident_reporting_enabled: true, purchase_requests_enabled: true,
  maintenance_vendor_billing_enabled: true, gps_sessions_enabled: false, external_trackers_enabled: false,
  client_rental_portal_enabled: false, depreciation_enabled: false, zoho_asset_sync_enabled: false,
  insurance_claims_enabled: false, custody_offline_enabled: false, custody_mobile_app_enabled: false,
  overdue_escalation_hours: 24, gps_retention_days: 30, ack_version: 1,
};
export const custodyGetFlags = () => prpc<CustodyFlags>("custody_enterprise_get_flags", {});
export const custodyUpdateFlags = (patch: Partial<CustodyFlags>) => prpc<CustodyFlags>("custody_enterprise_admin_update_flags", { p_patch: patch });

// ─── QR / Barcode ───
export interface QrResolved {
  id: string; asset_code: string; asset_name: string; serial_number: string | null; brand: string | null; model: string | null;
  asset_type: string; quantity_available: number; availability_status: string; condition_status: string; location: string | null;
}
export const custodyResolveQr = (token: string) => prpc<QrResolved>("custody_inv_resolve_qr", { p_token: token });
export const custodyReissueQr = (assetId: string, reason: string) => prpc<string>("custody_inv_admin_reissue_qr", { p_asset: assetId, p_reason: reason });
export const custodyLogLabelPrint = (assetIds: string[], format: string) => prpc<number>("custody_inv_log_label_print", { p_asset_ids: assetIds, p_format: format });
export const custodyListAssetsForLabels = (q?: string) =>
  pget<{ id: string; asset_code: string; asset_name: string; qr_token: string; barcode_value: string | null; label_version: number }[]>(
    `custody_inventory_assets?is_deleted=eq.false&select=id,asset_code,asset_name,qr_token,barcode_value,label_version&order=asset_name.asc&limit=500${q ? `&or=(asset_name.ilike.*${enc(q)}*,asset_code.ilike.*${enc(q)}*)` : ""}`);

// ─── Components (Parent/Child) ───
export const custodyUpsertComponent = (id: string | null, data: Record<string, unknown>) => prpc<string>("custody_inv_admin_upsert_component", { p_id: id, p_data: data });
export const custodyRemoveComponent = (id: string) => prpc<boolean>("custody_inv_admin_remove_component", { p_id: id });
export const custodyListComponents = (parentAssetId: string) =>
  pget<{ id: string; child_asset_id: string | null; accessory_name: string | null; relation_type: string; required_on_issue: boolean; required_on_return: boolean; default_quantity: number }[]>(
    `custody_inventory_asset_components?parent_asset_id=eq.${enc(parentAssetId)}&is_deleted=eq.false&select=id,child_asset_id,accessory_name,relation_type,required_on_issue,required_on_return,default_quantity&order=sort_order.asc`);

// ─── Kits ───
export interface CustodyKit { id: string; kit_code: string; name_ar: string; name_en: string | null; description: string | null; usage_type: string | null; version: number; status: string }
export const custodyListKits = () => pget<CustodyKit[]>(`custody_inventory_kits?is_deleted=eq.false&select=id,kit_code,name_ar,name_en,description,usage_type,version,status&order=name_ar.asc`);
export const custodyUpsertKit = (id: string | null, data: Record<string, unknown>) => prpc<string>("custody_inv_admin_upsert_kit", { p_id: id, p_data: data });
export const custodyUpsertKitItem = (v: { id?: string | null; kit_id: string; asset_id?: string | null; accessory?: string; quantity?: number; required?: boolean; sort?: number }) =>
  prpc<string>("custody_inv_admin_upsert_kit_item", { p_id: v.id ?? null, p_kit: v.kit_id, p_asset: v.asset_id ?? null, p_accessory: v.accessory ?? null, p_qty: v.quantity ?? 1, p_required: v.required ?? true, p_sort: v.sort ?? 0 });
export const custodyRemoveKitItem = (id: string) => prpc<boolean>("custody_inv_admin_remove_kit_item", { p_id: id });
export const custodySnapshotKit = (kitId: string) => prpc<number>("custody_inv_admin_snapshot_kit", { p_kit: kitId });
export const custodyGetKitResolved = (kitId: string) => prpc<{ kit: { id: string; kit_code: string; name_ar: string; version: number }; items: { kit_item_id: string; asset_id: string | null; accessory_name: string | null; quantity: number; is_required: boolean; asset_name: string | null; asset_code: string | null; asset_type: string | null; availability_status: string | null; quantity_available: number | null }[] }>("custody_inv_get_kit_resolved", { p_kit: kitId });
export const custodyIssueKit = (data: { kit_id: string; items: { asset_id: string; quantity?: number; item_photos: string[] }[]; group_photos: string[]; note?: string; override_required?: boolean; override_reason?: string }) =>
  prpc<{ ok: boolean; id: string; assignment_number: string; items: number }>("custody_inv_employee_issue_kit", { p_data: data });

// ─── Project / Signature / Conditions ───
export const custodySetProject = (assignmentId: string, data: Record<string, unknown>) => prpc<boolean>("custody_inv_set_project", { p_assignment: assignmentId, p_data: data });
export const custodyProjectDashboard = (project: string) => prpc<{ assignments: number; active: number; overdue: number; items: number }>("custody_inv_admin_project_dashboard", { p_project: project });
export const custodyRecordSignature = (v: { assignment_id: string; stage?: string; ack_text: string; ack_hash?: string; signature_path?: string; signer_name?: string; user_agent?: string }) =>
  prpc<string>("custody_inv_record_signature", { p_assignment: v.assignment_id, p_stage: v.stage ?? "issue", p_ack_text: v.ack_text, p_ack_hash: v.ack_hash ?? null, p_signature_path: v.signature_path ?? null, p_signer_name: v.signer_name ?? null, p_user_agent: v.user_agent ?? null });
export const custodyRecordCondition = (v: { assignment_id: string; item_id?: string; stage: string; grade: string; notes?: string; photos?: string[]; video?: string }) =>
  prpc<string>("custody_inv_record_condition", { p_assignment: v.assignment_id, p_item: v.item_id ?? null, p_stage: v.stage, p_grade: v.grade, p_notes: v.notes ?? null, p_photos: v.photos ?? [], p_video: v.video ?? null });
export const custodyConditionHistory = (itemId: string) => prpc<{ stage: string; grade: string; notes: string | null; photos: string[]; recorded_at: string }[]>("custody_inv_get_condition_history", { p_item: itemId });

// ─── Incidents ───
export const custodyReportIncident = (data: Record<string, unknown>) => prpc<{ ok: boolean; id: string; incident_number: string }>("custody_inv_employee_report_incident", { p_data: data });
export const custodyIncidentAction = (id: string, status: string, note: string, releaseHold: boolean) => prpc<boolean>("custody_inv_admin_incident_action", { p_incident: id, p_status: status, p_note: note, p_release_hold: releaseHold });
export const custodyListIncidents = (status?: string) =>
  pget<{ id: string; incident_number: string; incident_type: string; status: string; asset_id: string | null; description: string | null; created_at: string }[]>(
    `custody_incidents?is_deleted=eq.false&select=id,incident_number,incident_type,status,asset_id,description,created_at&order=created_at.desc&limit=300${status ? `&status=eq.${enc(status)}` : ""}`);

// ─── GPS ───
export const custodyGpsStart = (assignmentId: string | null, project: string | null, interval?: number) => prpc<string>("custody_gps_start", { p_assignment: assignmentId, p_project: project, p_interval: interval ?? 120 });
export const custodyGpsAppend = (sessionId: string, points: { lat: number; lng: number; accuracy?: number; recorded_at?: string }[]) => prpc<number>("custody_gps_append", { p_session: sessionId, p_points: points });
export const custodyGpsStop = (sessionId: string) => prpc<boolean>("custody_gps_stop", { p_session: sessionId });
export const custodyMyGpsSessions = () => pget<{ id: string; status: string; started_at: string; ended_at: string | null; point_count: number; project_number: string | null }[]>(
  `custody_gps_sessions?select=id,status,started_at,ended_at,point_count,project_number&order=started_at.desc&limit=100`);

// ─── Offline idempotency ───
export const custodyOfflineClaim = (v: { client_operation_id: string; type: string; hash?: string; device?: string }) =>
  prpc<{ new: boolean; status?: string; result_ref?: string }>("custody_offline_claim", { p_client_op: v.client_operation_id, p_type: v.type, p_hash: v.hash ?? null, p_device: v.device ?? null });
export const custodyOfflineFinalize = (v: { client_operation_id: string; status: string; result?: string; error?: string }) =>
  prpc<boolean>("custody_offline_finalize", { p_client_op: v.client_operation_id, p_status: v.status, p_result: v.result ?? null, p_error: v.error ?? null });

// ─── Finance / Procurement / Rental / Insurance / Zoho ───
export const custodyComputeDepreciation = (assetId: string) => prpc<{ ok: boolean; computable: boolean; monthly?: number; accumulated_depreciation?: number; book_value?: number; currency?: string; reason?: string }>("custody_finance_compute_depreciation", { p_asset: assetId });
export const custodyAssetUsage = (assetId: string) => prpc<Record<string, unknown>>("custody_finance_asset_usage", { p_asset: assetId });
export const custodyZohoEnqueue = (entityType: string, entityId: string, operation: string, payload: Record<string, unknown>) => prpc<string>("custody_zoho_enqueue", { p_entity_type: entityType, p_entity_id: entityId, p_operation: operation, p_payload: payload });
export const custodyPrCreate = (data: Record<string, unknown>, items: Record<string, unknown>[]) => prpc<{ ok: boolean; id: string; request_number: string }>("custody_pr_create", { p_data: data, p_items: items });
export const custodyPrDecide = (id: string, decision: string, note: string) => prpc<boolean>("custody_pr_decide", { p_request: id, p_decision: decision, p_note: note });
export const custodyRentalCreateRequest = (data: Record<string, unknown>) => prpc<{ ok: boolean; id: string; request_number: string }>("custody_rental_create_request", { p_data: data });
export const custodyInsuranceCreateClaim = (data: Record<string, unknown>) => prpc<{ ok: boolean; id: string; claim_number: string }>("custody_insurance_create_claim", { p_data: data });
export const custodyMaintenanceApproveCost = (id: string, approvedCost: number, note: string) => prpc<boolean>("custody_maintenance_approve_cost", { p_id: id, p_approved_cost: approvedCost, p_note: note });

export type { Result };

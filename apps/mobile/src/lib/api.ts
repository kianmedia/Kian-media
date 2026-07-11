// أغلفة RPC للجوال — تعيد استخدام نفس دوال القاعدة الآمنة (SECURITY DEFINER) عبر Supabase.
// لا صلاحيات خاصة بالجوال؛ الإنفاذ في القاعدة (RLS + RPC guards)، تمامًا كالويب.
import { supabase } from "./supabase";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as T };
}

export const resolveQr = (token: string) => rpc("custody_inv_resolve_qr", { p_token: token });
export const getMyAssignments = () => rpc("custody_inv_get_my_assignments", {});
export const listAvailable = (q?: string) => rpc("custody_inv_employee_list_available", { p_q: q ?? null });
export const selfIssue = (payload: unknown) => rpc("custody_inv_employee_self_issue", { p_data: payload });
export const submitReturn = (assignmentId: string, items: unknown, group: unknown) =>
  rpc("custody_inv_employee_submit_return", { p_assignment: assignmentId, p_items: items, p_group: group });
export const reportIncident = (payload: unknown) => rpc("custody_inv_employee_report_incident", { p_data: payload });
export const gpsStart = (assignmentId: string | null, project: string | null) => rpc("custody_gps_start", { p_assignment: assignmentId, p_project: project, p_interval: 120 });
export const gpsAppend = (sessionId: string, points: unknown) => rpc("custody_gps_append", { p_session: sessionId, p_points: points });
export const gpsStop = (sessionId: string) => rpc("custody_gps_stop", { p_session: sessionId });
export const offlineClaim = (clientOpId: string, type: string, hash?: string) => rpc("custody_offline_claim", { p_client_op: clientOpId, p_type: type, p_hash: hash ?? null, p_device: "mobile" });

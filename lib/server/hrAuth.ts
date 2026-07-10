// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY: التحقق الموحّد من صلاحية إدارة الموارد البشرية.
//
// مصدر القرار الوحيد = دالة القاعدة can_manage_hr() المُستدعاة بجلسة المستخدم
// (rpcAsUser بالـ JWT). هذه هي بالضبط نفس البوابة التي تفرضها كل RPCs الخاصة بالـ
// HR داخليًا (hr_admin_create_field_task ...). لذا:
//   • لا ازدواج في منطق الأدوار، ولا انحراف بين طبقة التطبيق وطبقة القاعدة.
//   • محصّنة ضد فشل قراءة profiles بالخدمة (service-role) — السبب الجذري للعطل:
//     قراءة `select=staff_role,...` كانت تفشل (غالبًا بسبب schema cache قديم لا
//     يعرف عمود staff_role المُضاف لاحقًا) فيتحوّل ok:false إلى «لا صلاحية» خطأً.
//
// قراءة profiles هنا للتشخيص فقط (سجلات) ولا تؤثر إطلاقًا على القرار. عند فشل
// استدعاء can_manage_hr نفسه (شبكة/انقطاع) نرفض fail-closed لكن بحالة 503 مميّزة
// (auth_check_failed) لا 403 — حتى لا تظهر رسالة «لا تملك الصلاحية» لعطل بنية تحتية.
// لا يُسجَّل بريد/JWT/مفاتيح — فقط user_id والدور والحالة والقرار.
// ════════════════════════════════════════════════════════════════════════
import { authGetUserId, selectAsService, rpcAsUser } from "@/lib/server/supabaseAdmin";

if (typeof window !== "undefined") {
  throw new Error("lib/server/hrAuth must never be imported in the browser");
}
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const enc = (v: string) => encodeURIComponent(v);
const HR_STAFF_ROLES = ["super_admin", "manager", "hr"];

export interface HrAuthDiag {
  staff_role: string | null;
  account_type: string | null;
  account_status: string | null;
}
export type HrAuthFailReason = "no_bearer" | "jwt" | "not_configured" | "not_authorized" | "auth_check_error";
export type HrAuthResult =
  | { ok: true; uid: string | null; diag: HrAuthDiag; profileReadOk: boolean }
  | { ok: false; status: number; error: string; failedOn: HrAuthFailReason; uid: string | null; diag: HrAuthDiag; profileReadOk: boolean };

const EMPTY_DIAG: HrAuthDiag = { staff_role: null, account_type: null, account_status: null };

/** القرار الموثوق الوحيد لصلاحية إدارة HR: دالة القاعدة can_manage_hr() بجلسة
 *  المستخدم — نفس ما تفرضه كل RPCs الخاصة بالـ HR. مصدر واحد لا يُكرَّر منطق الأدوار.
 *  ok=هل نجح الاستدعاء (transport)، can=نتيجة الدالة، status=رمز PostgREST. */
export async function canManageHr(bearer: string): Promise<{ ok: boolean; can: boolean; status: number; error: string }> {
  if (!bearer) return { ok: false, can: false, status: 401, error: "unauthorized" };
  const g = await rpcAsUser<boolean>("can_manage_hr", {}, bearer);
  return { ok: g.ok, can: g.ok && g.data === true, status: g.ok ? 200 : g.status, error: g.ok ? "" : g.error };
}

/** قراءة صف profiles للتشخيص فقط. تُرجع أيضًا ok=هل نجحت القراءة الكاملة.
 *  تتحمّل schema cache القديم: إن فشلت القراءة الكاملة (عمود staff_role) تُعيد
 *  المحاولة بالأعمدة الأساسية (account_type,account_status) — فيظهر account_status
 *  الفعلي حتى أثناء عطل الكاش، وهذا بالضبط ما يميّز false-deny عن رفض حقيقي. */
async function readDiag(uid: string | null): Promise<{ diag: HrAuthDiag; ok: boolean }> {
  if (!uid) return { diag: EMPTY_DIAG, ok: false };
  const full = await selectAsService<HrAuthDiag[]>(
    `profiles?id=eq.${enc(uid)}&select=staff_role,account_type,account_status&limit=1`);
  if (full.ok && full.data[0]) {
    const r = full.data[0];
    return { diag: { staff_role: r.staff_role ?? null, account_type: r.account_type ?? null, account_status: r.account_status ?? null }, ok: true };
  }
  // fallback: أعمدة أساسية فقط (لا staff_role) — تكشف account_status رغم عطل الكاش.
  const base = await selectAsService<{ account_type: string | null; account_status: string | null }[]>(
    `profiles?id=eq.${enc(uid)}&select=account_type,account_status&limit=1`);
  if (base.ok && base.data[0]) {
    return { diag: { staff_role: null, account_type: base.data[0].account_type ?? null, account_status: base.data[0].account_status ?? null }, ok: false };
  }
  return { diag: EMPTY_DIAG, ok: false };
}

/**
 * البوابة الموحّدة: هل يملك صاحب الـ bearer صلاحية إدارة HR؟
 * القرار حصريًا من can_manage_hr() في القاعدة (نفس ما تفرضه الـ RPCs).
 * @param bearer الـ JWT بدون بادئة "Bearer ".
 * @param routeTag وسم قصير للسجلات، مثل "hr_tasks_assign".
 */
export async function assertHrAdmin(bearer: string, routeTag: string): Promise<HrAuthResult> {
  if (!bearer) {
    log("HR_AUTH_CHECK", { route: routeTag, actor_present: false, decision: "deny", failed_on: "no_bearer" });
    return { ok: false, status: 401, error: "unauthorized", failedOn: "no_bearer", uid: null, diag: EMPTY_DIAG, profileReadOk: false };
  }

  // ─── القرار الموثوق: can_manage_hr() بجلسة المستخدم (anon apikey + bearer) ───
  const g = await canManageHr(bearer);
  // ─── التشخيص فقط (لا يؤثر على القرار) ───
  const uid = await authGetUserId(bearer);
  const { diag, ok: profileReadOk } = await readDiag(uid);

  const canManage = g.can;
  let failedOn: HrAuthFailReason | null = null;
  let status = 200;
  let error = "";
  if (!g.ok) {
    if (g.status === 401) { failedOn = "jwt"; status = 401; error = "unauthorized"; }           // توكن غير صالح/منتهٍ
    else if (g.status === 500 && /not_configured/.test(g.error)) { failedOn = "not_configured"; status = 500; error = "server_not_configured"; }
    else { failedOn = "auth_check_error"; status = 503; error = "auth_check_failed"; }           // انقطاع/غياب الدالة — ليس رفض صلاحية
  } else if (!canManage) {
    failedOn = "not_authorized"; status = 403; error = "not_authorized";                          // رفض حقيقي: القاعدة قالت لا
  }

  // سبب الرفض المُشتق من التشخيص (best-effort — قد يكون null إن فشلت القراءة).
  const heuristicRole = diag.account_type === "admin" || HR_STAFF_ROLES.includes(diag.staff_role ?? "");
  const denyReason = canManage ? null
    : failedOn === "jwt" ? "invalid_jwt"
    : failedOn === "not_configured" ? "server_not_configured"
    : failedOn === "auth_check_error" ? "can_manage_hr_unavailable"
    : !profileReadOk ? "profile_read_failed"                                                       // ← بصمة false-deny مع can_manage_hr=true
    : diag.account_status && diag.account_status !== "active" ? "account_status_" + diag.account_status
    : !heuristicRole ? "role_not_qualifying"
    : "db_can_manage_hr_false";

  log("HR_AUTH_CHECK", {
    route: routeTag, user_id: uid,
    staff_role: diag.staff_role, account_type: diag.account_type, account_status: diag.account_status,
    can_manage_hr: g.ok ? g.can : null, can_manage_rpc_ok: g.ok, profile_read_ok: profileReadOk,
    decision: canManage ? "allow" : "deny", failed_on: failedOn, deny_reason: denyReason,
  });

  if (canManage) return { ok: true, uid, diag, profileReadOk };
  return { ok: false, status, error, failedOn: failedOn as HrAuthFailReason, uid, diag, profileReadOk };
}
